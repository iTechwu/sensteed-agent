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
import { createHash } from 'node:crypto'
import { mkdtempSync,realpathSync,rmSync,readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {join} from 'node:path'
import {materializeHubGeneration} from '../src/hub-generation-materializer.ts'
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
it('materializes a signed pure plugin with exact tar files and safe self activation',async()=>{
 const f=fixture(),keys=generateKeyPairSync('ed25519'),item=f.plan.items[0]!,pkg=Buffer.from('{"name":"example-plugin","version":"1.0.0","main":"index.js"}'),source=Buffer.from('export default function apply() {}')
 const contents={'package.json':pkg,'index.js':source},files=Object.entries(contents).map(([path,b])=>({path,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')})).sort((a,b)=>a.path<b.path?-1:1)
 const tarParts:Buffer[]=[]
 for(const [name,b]of Object.entries(contents)){
  const h=Buffer.alloc(512);h.write(`package/${name}`);h.write('0000644\0',100);h.write('0000000\0',108);h.write('0000000\0',116);h.write(b.length.toString(8).padStart(11,'0')+'\0',124);h.write('00000000000\0',136);h.fill(32,148,156);h.write('0',156);h.write('ustar\0',257);h.write('00',263);h.write(h.reduce((s,v)=>s+v,0).toString(8).padStart(6,'0')+'\0 ',148);tarParts.push(h,b,Buffer.alloc((512-b.length%512)%512))
 }
 const archive=(await import('node:zlib')).gzipSync(Buffer.concat([...tarParts,Buffer.alloc(1024)])),sha256=createHash('sha256').update(archive).digest('hex'),sri=`sha512-${createHash('sha512').update(archive).digest('base64')}`,fileDigest=hubSyncDigest(files)
 const node={nodeId:'',name:'example-plugin',version:'1.0.0',sha256,sri,bytes:archive.length,fileManifestDigest:fileDigest,origin:'upload',registryId:'test',engines:{},os:[],cpu:[],libc:[],peerContext:{},hostProvided:false,lockedResolved:null}
 const target={os:'darwin',cpu:'arm64',libc:null,nodeVersion:'22.0.0',sensteedVersion:'1.0.0',cordisVersion:'4.0.5',harnessVersion:'1.0.0'}
 const graph={schemaVersion:'plugin-lock-v1',rootNodeId:'',sourceLockDigest:'a'.repeat(64),target,nodes:[node],edges:[],hostRequirements:[]}
 const packSetDigest=hubSyncDigest([{nodeId:node.nodeId,name:node.name,version:node.version,sha256,sri,bytes:node.bytes,fileManifestDigest:fileDigest}]),artifactRef=randomUUID()
 const manifest={sourceLockGraphDigest:'a'.repeat(64),packSetDigest,schemaVersion:'2.0',kind:'plugin',tenantId:f.plan.tenantId,pluginId:item.itemId,releaseId:item.releaseId,npmPackageName:'example-plugin',exactVersion:'1.0.0',frozenInputDigest:'a'.repeat(64),reviewDigest:'b'.repeat(64),tarballDigest:sha256,sri,lockGraphDigest:hubSyncDigest(graph),graph,artifacts:[{nodeId:'',artifactRef,contentPath:`/plugins/api/skillhub/v1/plugins/artifacts/${artifactRef}/content`,sha256,sri,bytes:archive.length,fileManifestDigest:fileDigest}],root:{name:node.name,version:node.version,sha256,sri,bytes:archive.length,expandedBytes:pkg.length+source.length,files,fileManifestDigest:fileDigest,hostEntry:'index.js',clientEntry:null,bundlePatch:null,capabilities:[],capabilityIds:[]},accessDeclaration:{containsScripts:false,networkHosts:[],fileAccess:'none'},compatibility:{sensteed:'*',testedTargets:[]},issuedAt:new Date().toISOString()}
 const bound={...item,kind:'plugin' as const,manifestDigest:hubSyncDigest(manifest),artifactDigest:sha256,lockGraphDigest:manifest.lockGraphDigest,packSetDigest},plan={...f.plan,items:[bound],proposedGenerationDigest:hubGenerationContentDigest([bound])}
 const expected={...f.expected,requested:[{kind:'plugin' as const,itemId:bound.itemId,action:bound.action,enabled:true}]},cap=verifyHubGenerationPlan(f.signed(plan),f.trust,expected),operationId=randomUUID(),context={tenantId:plan.tenantId,actorRef:plan.actorRef} as never
 const client=new HubGenerationClient({assertCurrent(){},generationRequest:async()=>({planId:plan.planId,operationId,state:'consumed',authorized:true,executionGeneration:'1',executionExpiresAt:new Date(Date.now()+1800000).toISOString(),proposedGenerationDigest:plan.proposedGenerationDigest})} as never,context),proof=await client.consumption(cap,operationId)
 const root=realpathSync(mkdtempSync(join(tmpdir(),'hub-plugin-materialize-')))
 try{
  const store=new HubGenerationStore(root,{origin:plan.origin,tenantId:plan.tenantId,actorRef:plan.actorRef,deviceId:plan.deviceId,profileId:plan.profileId})
  const envelope={manifest,signature:{algorithm:'Ed25519',canonicalization:'RFC8785',keyId:'artifact',payloadDigest:hubSyncDigest(manifest),signature:sign(null,Buffer.from(hubCanonicalJson(manifest)),keys.privateKey).toString('base64')}}
  const descriptor=await materializeHubGeneration({store,generationId:'g1',plan:generationPlanData(cap),proof,downloads:{manifests:[{kind:'plugin',itemId:item.itemId,envelope}],descriptors:[{downloadId:randomUUID(),kind:'plugin',itemId:item.itemId,nodeId:'',artifactDigest:sha256,bytes:archive.length,contentType:'application/gzip',role:'primary'}]},trust:{schemaVersion:1,keys:{artifact:keys.publicKey.export({type:'spki',format:'der'}).toString('base64')},revokedKeyIds:[]},client:{generationBytes:async()=>archive} as never,context})
  expect(descriptor.verifiedComposition?.entries).toEqual([{id:`hub-${item.itemId}`,packageName:'example-plugin',config:{}}]);await store.prepare(descriptor)
  expect(readFileSync(join(store.generationDirectory('g1'),'profile/node_modules/example-plugin/index.js'))).toEqual(source)
 }finally{rmSync(root,{recursive:true,force:true})}
})
