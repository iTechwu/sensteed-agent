import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { expect, it } from 'vitest'
import { generationPlanData, hubGenerationContentDigest, verifyHubGenerationPlan, type HubGenerationPlan, type HubGenerationPlanExpected } from '../src/hub-generation-verifier.ts'
import { hubCanonicalJson, hubSyncDigest, type HubReleaseTrust } from '../src/hub-sync-verifier.ts'
import { HubGenerationClient } from '../src/hub-generation-client.ts'
function fixture() {
  const now = Date.now(), keys = generateKeyPairSync('ed25519')
  const trust: HubReleaseTrust = { schemaVersion: 1, keys: { test: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }, revokedKeyIds: [] }
  const item: HubGenerationPlan['items'][number] = { kind: 'skill', itemId: randomUUID(), action: 'install', enabled: true, releaseId: randomUUID(), artifactDigest: '1'.repeat(64), manifestDigest: '2'.repeat(64), channelRevision: 1, lockGraphDigest: null, packSetDigest: null }
  const expected: HubGenerationPlanExpected = { origin: 'https://ai.hozonauto.com/plugins/api', tenantId: randomUUID(), actorRef: 'user@example.com', deviceId: randomUUID(), profileId: randomUUID(), channel: 'stable',
    snapshotId: randomUUID(), snapshotDigest: '3'.repeat(64), observedStateDigest: '4'.repeat(64), expectedActiveGenerationDigest: null, minimumPolicyRevision: 1,
    target: { sensteedVersion: '1.0.0', harnessVersion: '1.0.0', os: 'darwin', arch: 'arm64', nodeVersion: '22.0.0', cordisVersion: '4.0.5', libc: null, nodeAbi: '127', hostCapabilities: [], hostBuildDigest: 'b'.repeat(64) },
    requested: [{ kind: item.kind, itemId: item.itemId, action: item.action, enabled: item.enabled }] }
  const { requested: _requested, minimumPolicyRevision: _revision, ...binding } = expected
  const plan: HubGenerationPlan = { ...binding, schemaVersion: 'hub-generation-plan-v1', planId: randomUUID(), policyRevision: 1, catalogDigest: '5'.repeat(64), proposedGenerationDigest: hubGenerationContentDigest([item]), items: [item], closureDigest: '6'.repeat(64), totalBytes: 20, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 300000).toISOString(), planDigest: '0'.repeat(64) }
  function signed(value = plan) {
    const { planDigest: _old, ...payload } = value
    const final = { ...payload, planDigest: hubSyncDigest(payload) }
    return { plan: final, signature: { algorithm: 'Ed25519', canonicalization: 'RFC8785', keyId: 'test', payloadDigest: hubSyncDigest(final), signature: sign(null, Buffer.from(hubCanonicalJson(final)), keys.privateKey).toString('base64') } }
  }
  return { now, trust, expected, plan, signed }
}


import { zipSync } from 'fflate'
import{gzipSync}from'node:zlib'
import { createHash } from 'node:crypto'
import { mkdtempSync,realpathSync,rmSync,readFileSync,existsSync,mkdirSync,writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {join} from 'node:path'
import {materializeHubGeneration} from '../src/hub-generation-materializer.ts'
import {materializeProofInput,loadProofComposition} from '../src/hub-target-proof-runner.ts'
import {HubGenerationStore} from '../src/hub-generation-store.ts'
import {fileManifestDigest} from '../src/hub-skill-archive.mjs'

it('materializes an authorized signed skill into one sealed descriptor and never activates it',async()=>{
 const f=fixture(),keys=generateKeyPairSync('ed25519'),item=f.plan.items[0]!,content=Buffer.from('---\nname: example\ndescription: Example skill\n---\nContent'),archive=Buffer.from(zipSync({'SKILL.md':content})),sha256=createHash('sha256').update(archive).digest('hex')
 const manifest={schemaVersion:'1.1',fileManifestDigest:fileManifestDigest({'SKILL.md':content}),tenantId:f.plan.tenantId,skillId:item.itemId,releaseId:item.releaseId,kind:'skill',installName:'example',version:'1.0.0',artifact:{sha256,bytes:archive.length,format:'zip'},compatibility:{sensteed:'*',testedTargets:[]},accessDeclaration:{containsScripts:false,networkHosts:[],fileAccess:'none'},issuedAt:new Date().toISOString()}
 const envelope={manifest,signature:{algorithm:'Ed25519',canonicalization:'RFC8785',keyId:'artifact',payloadDigest:hubSyncDigest(manifest),signature:sign(null,Buffer.from(hubCanonicalJson(manifest)),keys.privateKey).toString('base64')}}
 const bound={...item,manifestDigest:hubSyncDigest(manifest),artifactDigest:sha256},plan={...f.plan,items:[bound],proposedGenerationDigest:hubGenerationContentDigest([bound])},cap=verifyHubGenerationPlan(f.signed(plan),f.trust,f.expected),operationId=randomUUID()
 const client=new HubGenerationClient({assertCurrent(){},generationRequest:async()=>({planId:plan.planId,operationId,state:'consumed',authorized:true,executionGeneration:'1',executionExpiresAt:new Date(Date.now()+1800000).toISOString(),proposedGenerationDigest:plan.proposedGenerationDigest})} as never,{tenantId:plan.tenantId,actorRef:plan.actorRef} as never)
 const proof=await client.consumption(cap,operationId),root=realpathSync(mkdtempSync(join(tmpdir(),'hub-materialize-')))
 try{
  const identity={origin:plan.origin,tenantId:plan.tenantId,actorRef:plan.actorRef,deviceId:plan.deviceId,profileId:plan.profileId},store=new HubGenerationStore(root,identity)
  const descriptor=await materializeHubGeneration({store,generationId:'g1',plan:generationPlanData(cap),proof,downloads:{manifests:[{kind:'skill',itemId:item.itemId,envelope}],descriptors:[{downloadId:randomUUID(),kind:'skill',itemId:item.itemId,nodeId:null,artifactDigest:sha256,bytes:archive.length,contentType:'application/zip',role:'primary'}]},trust:{schemaVersion:1,keys:{artifact:keys.publicKey.export({type:'spki',format:'der'}).toString('base64')},revokedKeyIds:[]},client:{generationBytes:async()=>archive} as never,context:{} as never})
  expect(readFileSync(join(store.generationDirectory('g1'),'skills/example/SKILL.md'))).toEqual(content)
  expect(descriptor.verifiedComposition?.skills).toHaveLength(1)
  await store.prepare(descriptor)
  expect(store.readState().phase).toBe('prepared');expect(store.readState().active).toBeNull()
 }finally{rmSync(root,{recursive:true,force:true})}
})
it.each(['matching','target-mismatch','nested-peer','bad-peer','optional-compatible','optional-omitted','optional-lie','optional-metadata-lie','optional-corrupt'])('materializes only exact signed plugin targets and peer topology (%s)',async variant=>{
 const optional=variant.startsWith('optional-'),omitted=optional&&variant!=='optional-compatible',matching=variant!=='target-mismatch',nested=variant==='nested-peer'||variant==='bad-peer'
 const f=fixture(),keys=generateKeyPairSync('ed25519'),item=f.plan.items[0]!,pkg=Buffer.from(JSON.stringify({name:'example-plugin',version:'1.0.0',main:'index.js',...(nested?{dependencies:{parent:'1.0.0'}}:optional?{dependencies:{'optional-child':'2.0.0'},optionalDependencies:{'optional-child':'1.0.0'}}:{})})),source=Buffer.from(variant==='optional-compatible'?'import child from \"optional-child\"; export default function apply() { if (!child) throw Error(\"missing child\") }':'export default function apply() {}')
 const contents={'package.json':pkg,'index.js':source},files=Object.entries(contents).map(([path,b])=>({path,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')})).sort((a,b)=>a.path<b.path?-1:1)
 function pack(contents:Record<string,Buffer>){const tarParts:Buffer[]=[]
 for(const [name,b]of Object.entries(contents)){
  const h=Buffer.alloc(512);h.write(`package/${name}`);h.write('0000644\0',100);h.write('0000000\0',108);h.write('0000000\0',116);h.write(b.length.toString(8).padStart(11,'0')+'\0',124);h.write('00000000000\0',136);h.fill(32,148,156);h.write('0',156);h.write('ustar\0',257);h.write('00',263);h.write(h.reduce((s,v)=>s+v,0).toString(8).padStart(6,'0')+'\0 ',148);tarParts.push(h,b,Buffer.alloc((512-b.length%512)%512))
 }
 return gzipSync(Buffer.concat([...tarParts,Buffer.alloc(1024)]))}
 const archive=pack(contents),sha256=createHash('sha256').update(archive).digest('hex'),sri=`sha512-${createHash('sha512').update(archive).digest('base64')}`,fileDigest=hubSyncDigest(files)
 const node={nodeId:'',name:'example-plugin',version:'1.0.0',sha256,sri,bytes:archive.length,fileManifestDigest:fileDigest,origin:'upload',registryId:'test',engines:{},os:[] as string[],cpu:[] as string[],libc:[] as string[],peerContext:{},hostProvided:false,lockedResolved:null}
 const target={os:'darwin',cpu:matching?'arm64':'x64',libc:null,nodeVersion:'22.0.0',sensteedVersion:'1.0.0',cordisVersion:'4.0.5',harnessVersion:'1.0.0'}
 const graph={schemaVersion:'plugin-lock-v1',rootNodeId:'',sourceLockDigest:'a'.repeat(64),target,nodes:[node],edges:[],hostRequirements:[]}
 const archives=new Map([['',archive]])
 const edges:{from:string;name:string;requested:string;kind:'prod'|'peer'|'optional';peerOptional:boolean;to:string;selection:'included'|'omitted';reason:null|'TARGET_OS_MISMATCH'}[]=[];graph.edges=edges as never[]
 if(nested){
  for(const [nodeId,name,declarations]of [
   ['node_modules/parent','parent',{dependencies:{consumer:'1.0.0',peerlib:'1.0.0'}}],
   ['node_modules/parent/node_modules/consumer','consumer',{peerDependencies:{peerlib:'1.0.0'}}],
   ['node_modules/parent/node_modules/peerlib','peerlib',{}],
  ]as const){
   const files={'package.json':Buffer.from(JSON.stringify({name,version:'1.0.0',...declarations})),'index.js':Buffer.from('export default {}')},bytes=pack(files),sha256=createHash('sha256').update(bytes).digest('hex'),sri=`sha512-${createHash('sha512').update(bytes).digest('base64')}`,fileManifestDigest=hubSyncDigest(Object.entries(files).map(([path,b])=>({path,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')})).sort((a,b)=>a.path<b.path?-1:1))
   graph.nodes.push({...node,nodeId,name,sha256,sri,bytes:bytes.length,fileManifestDigest});archives.set(nodeId,bytes)
  }
  for(const [from,name,to,kind]of [['','parent','node_modules/parent','prod'],['node_modules/parent','consumer','node_modules/parent/node_modules/consumer','prod'],['node_modules/parent','peerlib','node_modules/parent/node_modules/peerlib','prod'],['node_modules/parent/node_modules/consumer','peerlib',variant==='bad-peer'?'node_modules/parent':'node_modules/parent/node_modules/peerlib','peer']]as const)edges.push({from,name,to,kind,requested:'1.0.0',peerOptional:false,selection:'included',reason:null})
 }
 if(optional){
  const nodeId='node_modules/optional-child',files={'package.json':Buffer.from(JSON.stringify({name:'optional-child',version:'1.0.0',os:omitted?['linux']:['!win32','any']})),'index.js':Buffer.from('export default {}')},bytes=pack(files),sha256=createHash('sha256').update(bytes).digest('hex'),sri=`sha512-${createHash('sha512').update(bytes).digest('base64')}`,fileManifestDigest=hubSyncDigest(Object.entries(files).map(([path,b])=>({path,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')})).sort((a,b)=>a.path<b.path?-1:1))
  graph.nodes.push({...node,nodeId,name:'optional-child',sha256,sri,bytes:bytes.length,fileManifestDigest,os:variant==='optional-metadata-lie'?['win32']:omitted?['linux']:['!win32','any']});archives.set(nodeId,variant==='optional-corrupt'?Buffer.from('corrupt'):bytes)
  edges.push({from:'',name:'optional-child',to:nodeId,kind:'optional',requested:'1.0.0',peerOptional:false,selection:omitted?'omitted':'included',reason:omitted?'TARGET_OS_MISMATCH':null})
 }
 const finalGraph=optional?{...graph,schemaVersion:'plugin-lock-v2',nodes:graph.nodes.map(n=>({...n,selection:n.nodeId&&omitted?'omitted':'included',reason:n.nodeId&&omitted?'TARGET_OS_MISMATCH':null,os:variant==='optional-lie'&&n.nodeId?[]:n.os}))}:graph
 const packSetDigest=hubSyncDigest(graph.nodes.map(n=>({nodeId:n.nodeId,name:n.name,version:n.version,sha256:n.sha256,sri:n.sri,bytes:n.bytes,fileManifestDigest:n.fileManifestDigest})).sort((a,b)=>a.nodeId<b.nodeId?-1:a.nodeId>b.nodeId?1:0)),artifactRef=randomUUID()
 const manifest={sourceLockGraphDigest:'a'.repeat(64),packSetDigest,schemaVersion:'2.0',kind:'plugin',tenantId:f.plan.tenantId,pluginId:item.itemId,releaseId:item.releaseId,npmPackageName:'example-plugin',exactVersion:'1.0.0',frozenInputDigest:'a'.repeat(64),reviewDigest:'b'.repeat(64),tarballDigest:sha256,sri,lockGraphDigest:hubSyncDigest(finalGraph),graph:finalGraph,artifacts:graph.nodes.map(n=>({nodeId:n.nodeId,artifactRef,contentPath:`/plugins/api/skillhub/v1/plugins/artifacts/${artifactRef}/content`,sha256:n.sha256,sri:n.sri,bytes:n.bytes,fileManifestDigest:n.fileManifestDigest})),root:{name:node.name,version:node.version,sha256,sri,bytes:archive.length,expandedBytes:pkg.length+source.length,files,fileManifestDigest:fileDigest,hostEntry:'index.js',clientEntry:null,bundlePatch:null,capabilities:[],capabilityIds:[]},accessDeclaration:{containsScripts:false,networkHosts:[],fileAccess:'none'},compatibility:{sensteed:'*',testedTargets:[]},issuedAt:new Date().toISOString()}
 const bound={...item,kind:'plugin' as const,manifestDigest:hubSyncDigest(manifest),artifactDigest:sha256,lockGraphDigest:manifest.lockGraphDigest,packSetDigest},plan={...f.plan,items:[bound],proposedGenerationDigest:hubGenerationContentDigest([bound])}
 const expected={...f.expected,requested:[{kind:'plugin' as const,itemId:bound.itemId,action:bound.action,enabled:true}]},cap=verifyHubGenerationPlan(f.signed(plan),f.trust,expected),operationId=randomUUID(),context={tenantId:plan.tenantId,actorRef:plan.actorRef} as never
 const client=new HubGenerationClient({assertCurrent(){},generationRequest:async()=>({planId:plan.planId,operationId,state:'consumed',authorized:true,executionGeneration:'1',executionExpiresAt:new Date(Date.now()+1800000).toISOString(),proposedGenerationDigest:plan.proposedGenerationDigest})} as never,context),proof=await client.consumption(cap,operationId)
 const root=realpathSync(mkdtempSync(join(tmpdir(),'hub-plugin-materialize-')))
 try{
  const store=new HubGenerationStore(root,{origin:plan.origin,tenantId:plan.tenantId,actorRef:plan.actorRef,deviceId:plan.deviceId,profileId:plan.profileId})
  const envelope={manifest,signature:{algorithm:'Ed25519',canonicalization:'RFC8785',keyId:'artifact',payloadDigest:hubSyncDigest(manifest),signature:sign(null,Buffer.from(hubCanonicalJson(manifest)),keys.privateKey).toString('base64')}}
  if(optional){
   const inputDir=join(root,'proof-input'),proofRoot=join(root,'proof-output');mkdirSync(inputDir);mkdirSync(proofRoot)
   const artifacts=graph.nodes.map((n,i)=>{const path=`${i}.tgz`;writeFileSync(join(inputDir,path),archives.get(n.nodeId)!);return {nodeId:n.nodeId,sha256:n.sha256,bytes:n.bytes,contentType:'application/gzip',path}})
   const target=plan.target,now=Date.now(),job={schemaVersion:'hub-target-proof-job-v1',kind:'plugin',releaseId:manifest.releaseId,target,runnerId:'test-runner',runId:randomUUID(),nonce:'b'.repeat(64),tenantId:plan.tenantId,artifactDigest:manifest.tarballDigest,manifestDigest:hubSyncDigest(manifest),lockGraphDigest:manifest.lockGraphDigest,packSetDigest:manifest.packSetDigest,targetDigest:hubSyncDigest(target),hostBuildDigest:target.hostBuildDigest,policyVersion:'host-loader-proof-v1',issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+1800000).toISOString(),proofExpiresAt:new Date(now+86400000).toISOString()}
   const input={job,envelope,artifacts},trust={schemaVersion:1 as const,keys:{artifact:keys.publicKey.export({type:'spki',format:'der'}).toString('base64')},revokedKeyIds:[]}
   if(['optional-lie','optional-metadata-lie','optional-corrupt'].includes(variant))expect(()=>materializeProofInput(input,trust,inputDir,proofRoot)).toThrow()
   else{const result=materializeProofInput(input,trust,inputDir,proofRoot);expect((await loadProofComposition(result.composition)).entryIds).toEqual(['proof-candidate']);expect(existsSync(join(proofRoot,'node_modules/example-plugin/node_modules/optional-child/package.json'))).toBe(!omitted)}
  }
  const materializing=materializeHubGeneration({store,generationId:'g1',plan:generationPlanData(cap),proof,downloads:{manifests:[{kind:'plugin',itemId:item.itemId,envelope}],descriptors:graph.nodes.map(n=>({downloadId:randomUUID(),kind:'plugin',itemId:item.itemId,nodeId:n.nodeId,artifactDigest:n.sha256,bytes:n.bytes,contentType:'application/gzip',role:n.nodeId?'dependency':'primary'}))},trust:{schemaVersion:1,keys:{artifact:keys.publicKey.export({type:'spki',format:'der'}).toString('base64')},revokedKeyIds:[]},client:{generationBytes:async(_c:unknown,_id:string,e:{sha256:string})=>archives.get(graph.nodes.find(n=>n.sha256===e.sha256)!.nodeId)!} as never,context})
  if(!matching){await expect(materializing).rejects.toThrow('target mismatch');return}
  if(variant==='bad-peer'){await expect(materializing).rejects.toThrow();return}
  if(['optional-lie','optional-metadata-lie','optional-corrupt'].includes(variant)){await expect(materializing).rejects.toThrow();return}
  const descriptor=await materializing
  expect(descriptor.verifiedComposition?.entries).toEqual([{id:`hub-${item.itemId}`,packageName:'example-plugin',config:{}}]);await store.prepare(descriptor)
  expect(readFileSync(join(store.generationDirectory('g1'),'profile/node_modules/example-plugin/index.js'))).toEqual(source)
  if(optional)expect(existsSync(join(store.generationDirectory('g1'),'profile/node_modules/example-plugin/node_modules/optional-child/package.json'))).toBe(!omitted)
 }finally{rmSync(root,{recursive:true,force:true})}
})
