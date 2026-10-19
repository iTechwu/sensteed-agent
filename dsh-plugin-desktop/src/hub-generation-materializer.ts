import{hubNodeIncluded,verifyHubNodeMetadata,verifyHubNodeDependencies}from'./hub-plugin-graph.ts'
/** Private, link-free materialization. Never executes install hooks or uses a public registry. */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync, openSync, fsyncSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { load, JSON_SCHEMA } from 'js-yaml'
import { HubGenerationStore, type HubGenerationDescriptor } from './hub-generation-store.ts'
import type { HubGenerationPlan } from './hub-generation-verifier.ts'
import { hubGenerationConsumptionData, type VerifiedHubGenerationConsumption } from './hub-generation-client.ts'
import type { HubReleaseTrust } from './hub-sync-verifier.ts'
import { hubSyncDigest } from './hub-sync-verifier.ts'
import { verifyHubGenerationDownloads } from './hub-generation-downloads.ts'
import { readHubPluginArchive } from './hub-plugin-archive.ts'
import { HUB_RELEASE_EVIDENCE_FILE,verifyHubGenerationContent } from './hub-generation-content.ts'
import { unpackSkillArchive, fileManifestDigest } from './hub-skill-archive.mjs'
import type { HubHostClient, HubHostContext } from './hub-host-client.ts'
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
function path(value:string):void {
 if(!value || value.length>1000 || value!==value.normalize('NFC') || value.split('/').some(p=>!p||p==='.'||p==='..'||/[\\<>:"|?*\x00-\x1f\x7f]/u.test(p)||/[. ]$/u.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(p)))throw new Error('Unsafe materialized path')
}
function dataOnly(value:unknown,seen=new Set<object>(),depth=0):void {
 if(depth>32)throw new Error('Activation configuration is too deep')
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return
 if(typeof value!=='object'||seen.has(value))throw new Error('Activation configuration is not data only')
 seen.add(value)
 for(const [key,child]of Object.entries(value)){
  if(['__proto__','prototype','constructor','__jsExpr'].includes(key))throw new Error('Executable activation marker')
  dataOnly(child,seen,depth+1)
 }
}
export async function materializeHubGeneration(options:{
 readonly store:HubGenerationStore;readonly generationId:string;readonly plan:Readonly<HubGenerationPlan>;
 readonly proof:VerifiedHubGenerationConsumption;readonly downloads:unknown;readonly trust:HubReleaseTrust;
 readonly client:HubHostClient;readonly context:HubHostContext
}):Promise<HubGenerationDescriptor>{
 const {store,plan,proof}=options,authority=hubGenerationConsumptionData(proof)
 if(authority.planId!==plan.planId||authority.planDigest!==plan.planDigest)throw new Error('Materializer operation mismatch')
 for(const key of ['origin','tenantId','actorRef','deviceId','profileId'] as const)if(store.identity[key]!==plan[key])throw new Error('Materializer identity mismatch')
 const downloads=verifyHubGenerationDownloads(options.downloads,plan,proof,options.trust),root=store.generationDirectory(options.generationId)
 if(existsSync(root))throw new Error('Generation staging directory already exists')
 mkdirSync(root,{mode:0o700})
 const files:Record<string,string>={},packages:HubGenerationDescriptor['packages'][number][]=[],entries:{id:string;packageName:string;config:Record<string,unknown>}[]=[],skills:{name:string;path:string;sha256:string}[]=[]
 const portable=new Set<string>();let total=0
 const put=(relative:string,bytes:Buffer)=>{
  path(relative);const folded=relative.toLowerCase()
  if(portable.has(folded)||Object.keys(files).length>=20000||(total+=bytes.length)>2*1024*1024*1024)throw new Error('Materialized file collision or limit')
  portable.add(folded);mkdirSync(join(root,relative,'..'),{recursive:true,mode:0o700})
  const fd=openSync(join(root,relative),'wx',0o600)
  try{writeFileSync(fd,bytes);fsyncSync(fd)}finally{closeSync(fd)}
  files[relative]=sha(bytes)
 }
 for(const row of downloads.manifests){
  hubGenerationConsumptionData(proof)
  const locators=downloads.descriptors.filter(d=>d.kind===row.kind&&d.itemId===row.itemId)
  if(row.kind==='skill'){
   const manifest=row.envelope.manifest
   if(manifest.installName.startsWith('user-local-'))throw new Error('Reserved user skill namespace')
   const d=locators[0]!,bytes=await options.client.generationBytes(options.context,d.downloadId,{bytes:d.bytes,sha256:d.artifactDigest,contentType:d.contentType})
   const unpacked=unpackSkillArchive(bytes)
   if(fileManifestDigest(unpacked)!==manifest.fileManifestDigest)throw new Error('Skill file manifest mismatch')
   const enabled=plan.items.find(i=>i.kind==='skill'&&i.itemId===row.itemId)!.enabled
   const prefix=`${enabled?'skills':'disabled-skills'}/${manifest.installName}`
   for(const [name,content]of Object.entries(unpacked))put(`${prefix}/${name}`,content)
   if(!unpacked['SKILL.md'])throw new Error('Skill entry missing')
   if(enabled)skills.push({name:manifest.installName,path:`${prefix}/SKILL.md`,sha256:sha(unpacked['SKILL.md'])})
  }else{
   const manifest=row.envelope.manifest,rootPrefix=`profile/node_modules/${manifest.npmPackageName}`
   const nodeIds=new Set(manifest.graph.nodes.map(n=>n.nodeId))
   if(nodeIds.size!==manifest.graph.nodes.length||!nodeIds.has('')||nodeIds.size!==manifest.artifacts.length)throw new Error('Closure node coverage mismatch')
   for(const node of manifest.graph.nodes){
    if(node.nodeId!==''){
     path(node.nodeId)
     if(!/^node_modules\/(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/u.test(node.nodeId))throw new Error('Unsupported closure node layout')
    }
    const d=locators.find(d=>d.nodeId===node.nodeId)
    if(!d||d.artifactDigest!==node.sha256||d.bytes!==node.bytes)throw new Error('Closure node evidence mismatch')
    const bytes=await options.client.generationBytes(options.context,d.downloadId,{bytes:d.bytes,sha256:d.artifactDigest,contentType:d.contentType})
    if(`sha512-${createHash('sha512').update(bytes).digest('base64')}`!==node.sri)throw new Error('Closure SRI mismatch')
    const unpacked=readHubPluginArchive(bytes),list=[...unpacked].map(([path,b])=>({path,bytes:b.length,sha256:sha(b)})).sort((a,b)=>a.path<b.path?-1:1)
    if(hubSyncDigest(list)!==node.fileManifestDigest)throw new Error('Closure file manifest mismatch')
    const packageJson=unpacked.get('package.json');if(!packageJson)throw new Error('Closure package manifest missing')
    const pkg=JSON.parse(packageJson.toString('utf8')) as {name?:unknown;version?:unknown}
    if(pkg.name!==node.name||pkg.version!==node.version)throw new Error('Closure package identity mismatch')
    const declarations=pkg as Record<string,unknown>
    verifyHubNodeMetadata(node,declarations)
    if(!hubNodeIncluded(node))continue
    verifyHubNodeDependencies(manifest.graph,node,declarations)
    const prefix=node.nodeId===''?rootPrefix:`${rootPrefix}/${node.nodeId}`
    for(const [name,content]of unpacked)put(`${prefix}/${name}`,content)
    if(node.nodeId===''){
     if(hubSyncDigest(list)!==manifest.root.fileManifestDigest)throw new Error('Root files mismatch')
     if(manifest.root.bundlePatch){
      const patch=unpacked.get(manifest.root.bundlePatch);if(!patch||patch.length>262144)throw new Error('Activation patch missing')
      const value=load(patch.toString('utf8'),{schema:JSON_SCHEMA,json:false});dataOnly(value)
      if(!Array.isArray(value)||value.length!==1)throw new Error('Only one self activation is supported')
      const op=value[0] as {insert?:unknown};if(Object.keys(op).join()!=='insert'||!Array.isArray(op.insert)||op.insert.length!==1)throw new Error('Only one self activation is supported')
      const item=op.insert[0] as {id?:unknown;name?:unknown;config?:unknown}
      if(Object.keys(item).some(k=>!['id','name','config'].includes(k))||typeof item.id!=='string'||item.name!==manifest.npmPackageName||item.config!==undefined&&(!item.config||typeof item.config!=='object'||Array.isArray(item.config)))throw new Error('Foreign activation is forbidden')
      if(plan.items.find(i=>i.kind==='plugin'&&i.itemId===row.itemId)!.enabled)entries.push({id:item.id,packageName:manifest.npmPackageName,config:(item.config??{}) as Record<string,unknown>})
     }else{
      if(!manifest.root.hostEntry)throw new Error('Plugin Host entry missing')
      if(plan.items.find(i=>i.kind==='plugin'&&i.itemId===row.itemId)!.enabled)entries.push({id:`hub-${row.itemId}`,packageName:manifest.npmPackageName,config:{}})
     }
    }
   }
   packages.push({name:manifest.npmPackageName,manifest:`${rootPrefix}/package.json`,releaseId:manifest.releaseId,payloadDigest:manifest.packSetDigest})
  }
 }
 mkdirSync(join(root,'skills'),{recursive:true,mode:0o700});mkdirSync(join(root,'profile'),{recursive:true,mode:0o700})
 put(HUB_RELEASE_EVIDENCE_FILE,Buffer.from(JSON.stringify({manifests:downloads.manifests})))
 hubGenerationConsumptionData(proof)
 const descriptor:HubGenerationDescriptor={schemaVersion:2,identity:store.identity,generationId:options.generationId,packages,skillsRoot:'skills',files,verifiedComposition:{entries,skills}}
 verifyHubGenerationContent(store,plan,options.trust,descriptor)
 return descriptor
}
