import { verifyHubManifestRequirements } from './hub-manifest-requirements.ts'
/** Bind extracted files and activation rows back to signed release evidence on every boot. */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { load, JSON_SCHEMA } from 'js-yaml'
import { HubGenerationDownloadsSchema } from './hub-artifact-schemas.ts'
import { hubSyncDigest, verifyHubReleaseSignature, type HubReleaseTrust } from './hub-sync-verifier.ts'
import { hubNodeIncluded, verifyHubPluginGraph } from './hub-plugin-graph.ts'
import type { HubGenerationPlan } from './hub-generation-verifier.ts'
import type { HubGenerationDescriptor, HubGenerationStore } from './hub-generation-store.ts'
export const HUB_RELEASE_EVIDENCE_FILE='.hub-release-manifests.json'
const evidenceSchema=HubGenerationDownloadsSchema.pick({manifests:true})
export function verifyHubGenerationContent(store:HubGenerationStore,plan:Readonly<HubGenerationPlan>,trust:HubReleaseTrust,descriptor=store.activeDescriptor()):void{
 if(!descriptor||descriptor.schemaVersion!==2||!descriptor.verifiedComposition)throw new Error('Hub boot requires signed release content evidence')
 const root=store.generationDirectory(descriptor.generationId),evidencePath=join(root,HUB_RELEASE_EVIDENCE_FILE)
 if(!Object.hasOwn(descriptor.files,HUB_RELEASE_EVIDENCE_FILE)||statSync(evidencePath).size>2*1024*1024)throw new Error('Hub signed release content evidence missing or oversized')
 const evidence=evidenceSchema.parse(JSON.parse(readFileSync(evidencePath,'utf8'))),active=plan.items.filter(i=>i.action!=='uninstall'),seen=new Set<string>(),covered=new Set([HUB_RELEASE_EVIDENCE_FILE])
 const entries:NonNullable<HubGenerationDescriptor['verifiedComposition']>['entries'][number][]=[],skills:NonNullable<HubGenerationDescriptor['verifiedComposition']>['skills'][number][]=[],packages:HubGenerationDescriptor['packages'][number][]=[]
 if(evidence.manifests.length!==active.length)throw new Error('Hub boot release collection mismatch')
 function listing(prefix:string,exclude:readonly string[]=[]){
  return Object.entries(descriptor!.files).filter(([path])=>path.startsWith(`${prefix}/`)&&!exclude.some(child=>path.startsWith(`${child}/`))).map(([path,sha256])=>{
   covered.add(path);return {path:path.slice(prefix.length+1),bytes:statSync(join(root,path)).size,sha256}
  }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)
 }
 for(const row of evidence.manifests){
  const key=`${row.kind}:${row.itemId}`,item=active.find(i=>`${i.kind}:${i.itemId}`===key),manifest=row.envelope.manifest
  if(!item||seen.has(key))throw new Error('Hub boot foreign release');seen.add(key)
  verifyHubReleaseSignature(manifest,row.envelope.signature,trust)
  if(manifest.tenantId!==plan.tenantId||manifest.releaseId!==item.releaseId||hubSyncDigest(manifest)!==item.manifestDigest)throw new Error('Hub boot release binding mismatch')
  if(row.kind==='skill'){
   const m=row.envelope.manifest,prefix=`${item.enabled?'skills':'disabled-skills'}/${m.installName}`,files=listing(prefix)
   if(m.skillId!==item.itemId||m.artifact.sha256!==item.artifactDigest||hubSyncDigest(files)!==m.fileManifestDigest)throw new Error('Hub boot skill signed file manifest mismatch')
   const skillPath=`${prefix}/SKILL.md`,sha256=descriptor.files[skillPath]
   if(!sha256)throw new Error('Hub boot skill entry missing')
   if(item.enabled)skills.push({name:m.installName,path:skillPath,sha256})
  }else{
   const m=row.envelope.manifest,prefix=`profile/node_modules/${m.npmPackageName}`
   if(m.pluginId!==item.itemId||m.tarballDigest!==item.artifactDigest||m.lockGraphDigest!==item.lockGraphDigest||m.packSetDigest!==item.packSetDigest||hubSyncDigest(m.graph)!==m.lockGraphDigest)throw new Error('Hub boot plugin closure binding mismatch')
   verifyHubPluginGraph(m.graph)
   const included=m.graph.nodes.filter(hubNodeIncluded),prefixes=included.map(n=>n.nodeId?`${prefix}/${n.nodeId}`:prefix)
   for(const [index,node]of included.entries()){
    const files=listing(prefixes[index]!,prefixes.filter(p=>p.startsWith(`${prefixes[index]!}/`)))
    if(hubSyncDigest(files)!==node.fileManifestDigest)throw new Error('Hub boot plugin signed file manifest mismatch')
   }
   packages.push({name:m.npmPackageName,manifest:`${prefix}/package.json`,releaseId:m.releaseId,payloadDigest:m.packSetDigest})
   if(item.enabled){
    if(m.root.bundlePatch){
     const patchPath=`${prefix}/${m.root.bundlePatch}`
     if(!Object.hasOwn(descriptor.files,patchPath)||statSync(join(root,patchPath)).size>262144)throw new Error('Hub boot activation patch missing')
     const value=load(readFileSync(join(root,patchPath),'utf8'),{schema:JSON_SCHEMA,json:false}) as unknown
     if(!Array.isArray(value)||value.length!==1)throw new Error('Hub boot activation mismatch')
     const op=value[0] as {insert?:unknown}
     if(!op||Object.keys(op).join()!=='insert'||!Array.isArray(op.insert)||op.insert.length!==1)throw new Error('Hub boot activation mismatch')
     const row=op.insert[0] as {id?:unknown;name?:unknown;config?:unknown}
     if(!row||Object.keys(row).some(k=>!['id','name','config'].includes(k))||typeof row.id!=='string'||row.name!==m.npmPackageName)throw new Error('Hub boot activation mismatch')
     entries.push({id:row.id,packageName:m.npmPackageName,config:(row.config??{}) as Record<string,unknown>})
    }else entries.push({id:`hub-${row.itemId}`,packageName:m.npmPackageName,config:{}})
   }
  }
 }
 verifyHubManifestRequirements(evidence.manifests,plan)
 if([...covered].sort().join('\0')!==Object.keys(descriptor.files).sort().join('\0')||hubSyncDigest(packages)!==hubSyncDigest(descriptor.packages)||hubSyncDigest({entries,skills})!==hubSyncDigest(descriptor.verifiedComposition))throw new Error('Hub boot unsigned layout or activation mismatch')
}
