import { afterEach, expect, it, vi } from 'vitest'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HubGenerationStore, type HubGenerationDescriptor } from '../src/hub-generation-store.ts'
import { HubExecutionJournal, type HubExecutionRecord } from '../src/hub-execution-journal.ts'
import { resolveHubHostIdentity } from '../src/hub-host-identity.ts'
import { HubHostClient, type HubSsoSession } from '../src/hub-host-client.ts'
import { hubGenerationContentDigest, verifyHubGenerationPlan } from '../src/hub-generation-verifier.ts'
import { hubCanonicalJson, hubSyncDigest } from '../src/hub-sync-verifier.ts'
import { loadHubOfflineBoot, saveHubOfflineBoot } from '../src/hub-offline-boot.ts'
import { registerHubGenerationManager } from '../src/hub-generation-manager.ts'
import { readSealedHubReleaseTrust } from '../src/hub-release-trust.ts'
import { HUB_RELEASE_EVIDENCE_FILE } from '../src/hub-generation-content.ts'
vi.mock('../src/hub-release-trust.ts',()=>({readSealedHubReleaseTrust:vi.fn()}))

const roots:string[]=[]
afterEach(()=>{vi.useRealTimers();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
const fileDigest=(value:string)=>createHash('sha256').update(value).digest('hex')
async function fixture(phase:'STAGED'|'COMMITTED'|'ACTIVATED',prepared=false,pendingReceipt=true){
 const userData=realpathSync(mkdtempSync(join(tmpdir(),'hub-reconnect-')));roots.push(userData)
 const profileDirectory=join(userData,'profile');mkdirSync(profileDirectory,{mode:0o700})
 const owner={operator:'verified-owner',tenantId:randomUUID()},tenantId=randomUUID(),workspaceId=randomUUID()
 const identity=await resolveHubHostIdentity(userData,profileDirectory,{assertCurrent(){},bindDevice:async()=>randomUUID()} as never,{tenantId,actorRef:owner.operator,workspaceId,permissions:[],revision:0})
 const store=new HubGenerationStore(userData,identity),journal=new HubExecutionJournal(store),keys=generateKeyPairSync('ed25519')
 const trust={schemaVersion:1 as const,keys:{test:keys.publicKey.export({type:'spki',format:'der'}).toString('base64')},revokedKeyIds:[]}
 const target={sensteedVersion:'1.0.0',harnessVersion:'1.0.0',os:'darwin' as const,arch:'arm64' as const,nodeVersion:'22.0.0',cordisVersion:'4.0.5',libc:null,nodeAbi:'127',hostCapabilities:[],hostBuildDigest:'b'.repeat(64)}
 const signature=(value:unknown)=>({algorithm:'Ed25519',canonicalization:'RFC8785',keyId:'test',payloadDigest:hubSyncDigest(value),signature:sign(null,Buffer.from(hubCanonicalJson(value)),keys.privateKey).toString('base64')})
 const itemId=randomUUID(),now=Date.now()
 function release(version:string,previousGenerationDigest:string|null){
  const content=`# example ${version}`,manifest={schemaVersion:'1.1',kind:'skill',tenantId,skillId:itemId,releaseId:randomUUID(),installName:'example',version,artifact:{sha256:fileDigest(`archive ${version}`),bytes:100,format:'zip'},fileManifestDigest:hubSyncDigest([{path:'SKILL.md',bytes:Buffer.byteLength(content),sha256:fileDigest(content)}]),compatibility:{sensteed:'*',testedTargets:[]},accessDeclaration:{containsScripts:false,networkHosts:[],fileAccess:'none'},issuedAt:new Date(now).toISOString()}
  // Each version carries distinct signed manifest, content, artifact and generation identity.
  const item={kind:'skill' as const,itemId,releaseId:manifest.releaseId,action:previousGenerationDigest===null?'install' as const:'update' as const,enabled:true,artifactDigest:manifest.artifact.sha256,manifestDigest:hubSyncDigest(manifest),channelRevision:previousGenerationDigest===null?1:2,lockGraphDigest:null,packSetDigest:null}
  const expected={...identity,target,channel:'stable' as const,snapshotId:randomUUID(),snapshotDigest:'a'.repeat(64),observedStateDigest:'b'.repeat(64),expectedActiveGenerationDigest:previousGenerationDigest,minimumPolicyRevision:1,requested:[{kind:item.kind,itemId,action:item.action,enabled:true}]}
  const {minimumPolicyRevision:_floor,requested:_requested,...binding}=expected
  const payload={...binding,schemaVersion:'hub-generation-plan-v1',planId:randomUUID(),policyRevision:1,catalogDigest:'c'.repeat(64),proposedGenerationDigest:hubGenerationContentDigest([item]),items:[item],closureDigest:hubSyncDigest([]),totalBytes:100,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+300000).toISOString()}
  const plan={...payload,planDigest:hubSyncDigest(payload)},envelope={plan,signature:signature(plan)}
  function descriptor(generationId:string):HubGenerationDescriptor{
   const root=store.generationDirectory(generationId);mkdirSync(join(root,'skills','example'),{recursive:true,mode:0o700})
   const evidence=JSON.stringify({manifests:[{kind:'skill',itemId,envelope:{manifest,signature:signature(manifest)}}]})
   writeFileSync(join(root,'skills','example','SKILL.md'),content,{mode:0o600});writeFileSync(join(root,HUB_RELEASE_EVIDENCE_FILE),evidence,{mode:0o600})
   return{schemaVersion:2,identity,generationId,skillsRoot:'skills',packages:[],files:{'skills/example/SKILL.md':fileDigest(content),[HUB_RELEASE_EVIDENCE_FILE]:fileDigest(evidence)},verifiedComposition:{entries:[],skills:[{name:'example',path:'skills/example/SKILL.md',sha256:fileDigest(content)}]}}
  }
  return{plan,envelope,expected,descriptor,cap:verifyHubGenerationPlan(envelope,trust,expected)}
 }
 async function begin(candidate:ReturnType<typeof release>,generationId:string){
  let record=await journal.begin(candidate.cap,randomUUID(),candidate.envelope)
  record=await journal.advance(record,'CONSUMING');record=await journal.advance(record,'AUTHORIZED',{executionGeneration:'1',executionExpiresAt:new Date(now+1800000).toISOString()})
  await store.prepare(candidate.descriptor(generationId))
  return await journal.advance(record,'STAGED',{descriptorDigest:store.readState().pending!.descriptorDigest})
 }
 async function queue(record:HubExecutionRecord,ack:boolean){
  record=await journal.queueReceipt(record,{phase:record.phase as 'STAGED'|'COMMITTED'|'ACTIVATED',evidenceDigest:hubSyncDigest({phase:record.phase}),occurredAt:new Date(now).toISOString(),errorCode:null})
  return ack?await journal.acknowledgeReceipt(record):record
 }
 const a=release('1.0.0',null)
 let record=await queue(await begin(a,'healthy-a'),true)
 await store.activate();record=await queue(await journal.advance(record,'COMMITTED'),true)
 await store.markHealthy('healthy-a');await queue(await journal.advance(record,'ACTIVATED'),true);await journal.saveHealthyInventory()
 const authorization={schemaVersion:'hub-generation-boot-v1',...identity,target,generationDigest:a.plan.proposedGenerationDigest,contentDigest:a.plan.proposedGenerationDigest,policyRevision:1,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+86400000).toISOString()},lease={authorization,signature:signature(authorization)}
 let session:HubSsoSession|undefined,onBinding=()=>{},serverActive=a.plan.proposedGenerationDigest,failRollback=false,ambiguousRollback:Record<string,unknown>|undefined
 const calls:{path:string;body:Record<string,unknown>}[]=[],receipts:Record<string,unknown>[]=[],transportErrors:unknown[]=[]
 let b:ReturnType<typeof release>,failed:HubExecutionRecord,statusChecked=false
 const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  try{
   expect(new Headers(init?.headers).get('authorization')).toBe('Bearer unit-test-session')
   const path=new URL(String(url)).pathname,body=init?.body?JSON.parse(String(init.body)) as Record<string,unknown>:{}
   calls.push({path,body})
   let data:unknown
   if(path.endsWith('/me'))data={tenantId,workspace:{ssoTeam:{id:workspaceId}},permissions:[]}
   else if(path.endsWith('/consume-status')){
    expect(body).toEqual({deviceId:identity.deviceId,profileId:identity.profileId,planDigest:b.plan.planDigest,expectedActiveGenerationDigest:a.plan.proposedGenerationDigest,operationId:failed.operationId})
    expect(path).toContain(b.plan.planId);statusChecked=true
    data={planId:b.plan.planId,operationId:failed.operationId,state:'consumed',authorized:Date.now()<now+1800000,executionGeneration:'1',executionExpiresAt:new Date(now+1800000).toISOString(),proposedGenerationDigest:b.plan.proposedGenerationDigest}
   }else if(path.endsWith('/installation-reports')){
    expect(statusChecked).toBe(true)
    expect(body).toMatchObject({deviceId:identity.deviceId,profileId:identity.profileId,planId:b.plan.planId,planDigest:b.plan.planDigest,operationId:failed.operationId,executionGeneration:'1',generationDigest:b.plan.proposedGenerationDigest,previousGenerationDigest:a.plan.proposedGenerationDigest})
    receipts.push(body)
    if(body.phase==='ROLLED_BACK'&&failRollback){failRollback=false;ambiguousRollback=body;return new Response(null,{status:503})}
    if(body.phase==='ROLLED_BACK')serverActive=a.plan.proposedGenerationDigest
    else if(body.phase==='COMMITTED'||body.phase==='ACTIVATED')serverActive=b.plan.proposedGenerationDigest
    data={ack:true}
   }else if(path.endsWith('/boot-authorization')){
    // Server refuses A until the B execution has been reconciled.
    expect(body.generationDigest).toBe(serverActive)
    const currentAuthorization={...authorization,generationDigest:serverActive,contentDigest:serverActive}
    data={authorization:currentAuthorization,signature:signature(currentAuthorization)}
   }else throw Error(`Unexpected Hub path: ${path}`)
   return Response.json({code:200,data})
  }catch(error){transportErrors.push(error);throw error}
 })
 const client=new HubHostClient({getDatasourceSession:()=>session,getOfflineIdentity:async()=>owner,watchBinding:fn=>{onBinding=fn;return()=>{}}},fetcher)
 const options={userData,profileDirectory,client,target,trust}
 await saveHubOfflineBoot({...options,store,lease})
 b=release('2.0.0',a.plan.proposedGenerationDigest)
 record=await begin(b,'candidate-b')
 if(phase==='STAGED')record=await queue(record,!pendingReceipt)
 else{
  record=await queue(record,true);await store.activate();record=await journal.advance(record,'COMMITTED')
  if(phase==='COMMITTED')record=await queue(record,!pendingReceipt)
  else{record=await queue(record,true);await store.markHealthy('candidate-b');record=await queue(await journal.advance(record,'ACTIVATED'),!pendingReceipt);if(!pendingReceipt)await journal.saveHealthyInventory();serverActive=b.plan.proposedGenerationDigest}
 }
 if(phase==='STAGED'&&!prepared)await store.activate()
 failed=record
 vi.mocked(readSealedHubReleaseTrust).mockReturnValue(trust)
 let ready=()=>{},manager!:{restart(input:unknown):Promise<unknown>;preview(input:unknown):Promise<unknown>};const cleanup:(()=>void)[]=[],request=vi.fn()
 const scope={hubHostClient:client,hubGenerationSupervisor:{request},provide:(_key:string,value:unknown)=>{manager=value as typeof manager},effect:(fn:()=>()=>void)=>cleanup.push(fn()),inject:(_keys:string[],fn:(v:unknown)=>void)=>fn({appReady:{onReady:(fn:()=>void)=>{ready=fn}}}),logger:()=>({warn:()=>{}})}
 registerHubGenerationManager({inject:(_keys:string[],fn:(v:unknown)=>void)=>fn(scope)} as never,options)
 return{a,b,failed,store,journal,options,request,calls,receipts,transportErrors,fetcher,ready,now,get manager(){return manager},get ambiguousRollback(){return ambiguousRollback},positiveReceived(received:boolean){serverActive=received?b.plan.proposedGenerationDigest:a.plan.proposedGenerationDigest},failRollback(){failRollback=true},reconnect(notify=true){session={...owner,accessToken:'unit-test-session'};if(notify)onBinding()},dispose(){cleanup.forEach(fn=>fn());client.dispose()}}
}

it.each(['STAGED','COMMITTED','ACTIVATED'] as const)('reconciles an offline-restored A before requesting fresh authority when B journal is %s',async phase=>{
 const f=await fixture(phase)
 try{
  expect(f.a.plan.proposedGenerationDigest).not.toBe(f.b.plan.proposedGenerationDigest)
  expect(f.a.plan.items[0]!.releaseId).not.toBe(f.b.plan.items[0]!.releaseId)
  f.ready();await vi.waitFor(()=>expect(f.request).toHaveBeenCalledOnce())
  expect(f.store.readState()).toMatchObject({phase:'stable',active:{generationId:'healthy-a'}})
  expect(f.journal.read()).toEqual(f.failed);expect(f.fetcher).not.toHaveBeenCalled()
  f.reconnect();await vi.waitFor(()=>expect(f.request).toHaveBeenCalledTimes(2))
  expect(f.transportErrors).toEqual([])
  const {seq:_seq,previousGenerationDigest:_previous,...pending}=f.failed.pendingReceipt!
  expect(f.receipts).toHaveLength(2)
  expect(f.receipts[0]).toMatchObject({...pending,seq:f.failed.receiptSeq,previousGenerationDigest:f.a.plan.proposedGenerationDigest})
  expect(f.receipts[1]).toMatchObject({phase:'ROLLED_BACK',seq:f.failed.receiptSeq+1,previousGenerationDigest:f.a.plan.proposedGenerationDigest})
  expect(f.calls.filter(c=>!c.path.endsWith('/me')).map(c=>c.path.split('/').pop())).toEqual(['consume-status','installation-reports','installation-reports','boot-authorization'])
  expect(f.journal.read()).toMatchObject({phase:'ROLLED_BACK',operationId:f.failed.operationId,receiptSeq:f.failed.receiptSeq+2,pendingReceipt:null})
  expect(f.request.mock.calls[1]![0]).toMatchObject({kind:'managed',generationDigest:f.a.plan.proposedGenerationDigest})
  expect((await loadHubOfflineBoot(f.options))?.generationDigest).toBe(f.a.plan.proposedGenerationDigest)
  f.reconnect();await vi.waitFor(()=>expect(f.request).toHaveBeenCalledTimes(3))
  expect(f.receipts).toHaveLength(2);expect(f.journal.read()?.phase).toBe('ROLLED_BACK')
 }finally{f.dispose()}
})
it.each([false,true])('keeps prepared B awaiting restart consent while booting healthy A after reconnect (pending receipt: %s)',async pendingReceipt=>{
 const f=await fixture('STAGED',true,pendingReceipt)
 try{
  f.ready();await vi.waitFor(()=>expect(f.request).toHaveBeenCalledOnce())
  f.reconnect();await vi.waitFor(()=>expect(f.request).toHaveBeenCalledTimes(2))
  expect(f.transportErrors).toEqual([]);expect(f.receipts).toHaveLength(pendingReceipt?1:0)
  if(pendingReceipt)expect(f.receipts[0]).toMatchObject(f.failed.pendingReceipt!)
  expect(f.journal.read()).toMatchObject({phase:'STAGED',operationId:f.failed.operationId,pendingReceipt:null})
  expect(f.store.readState()).toMatchObject({phase:'prepared',active:{generationId:'healthy-a'},pending:{generationId:'candidate-b',descriptorDigest:f.failed.descriptorDigest}})
  expect(f.request.mock.calls[1]![0]).toMatchObject({kind:'managed',generationDigest:f.a.plan.proposedGenerationDigest})
  await expect(f.manager.restart({operationId:f.failed.operationId})).resolves.toMatchObject({state:'RESTARTING'})
  expect(f.request).toHaveBeenLastCalledWith({kind:'activate',identity:f.store.identity,operationId:f.failed.operationId})
 }finally{f.dispose()}
})
it('atomically persists rollback and replays its exact receipt after an ambiguous send',async()=>{
 const f=await fixture('ACTIVATED')
 try{
  f.ready();await vi.waitFor(()=>expect(f.request).toHaveBeenCalledOnce())
  f.failRollback();f.reconnect();await vi.waitFor(()=>expect(f.ambiguousRollback).toBeDefined())
  const pending=f.journal.read()!
  expect(pending).toMatchObject({phase:'ROLLED_BACK',pendingReceipt:{phase:'ROLLED_BACK',seq:f.failed.receiptSeq+1}})
  await vi.waitFor(()=>expect(f.request).toHaveBeenCalledTimes(2))
  await expect(f.journal.begin(f.b.cap,randomUUID(),f.b.envelope)).rejects.toThrow('already pending')
  await expect(f.manager.preview({channel:'stable',requested:[]})).rejects.toThrow('HUB_OPERATION_PENDING')
  expect(f.journal.read()).toEqual(pending)
  f.reconnect();await vi.waitFor(()=>expect(f.request).toHaveBeenCalledTimes(3))
  expect(f.transportErrors).toEqual([])
  expect(f.receipts.filter(r=>r.phase==='ROLLED_BACK')).toEqual([f.ambiguousRollback,f.ambiguousRollback])
  expect(f.journal.read()).toMatchObject({phase:'ROLLED_BACK',pendingReceipt:null,receiptSeq:f.failed.receiptSeq+2})
 }finally{f.dispose()}
})
it.each([[false,true],[true,false],[true,true]] as const)('reconciles expired consumed B with failure-only authority (pending positive: %s, server received: %s)',async(pendingReceipt,received)=>{
 const f=await fixture('ACTIVATED',false,pendingReceipt)
 try{
  f.ready();await vi.waitFor(()=>expect(f.request).toHaveBeenCalledOnce())
  f.positiveReceived(received)
  vi.setSystemTime(f.now+3600000)
  f.reconnect();await vi.waitFor(()=>expect(f.request).toHaveBeenCalledTimes(2))
  expect(f.transportErrors).toEqual([])
  expect(f.receipts).toHaveLength(1)
  expect(f.receipts[0]).toMatchObject({phase:'ROLLED_BACK',seq:f.failed.receiptSeq+(pendingReceipt?1:0)})
  expect(f.journal.read()).toMatchObject({phase:'ROLLED_BACK',pendingReceipt:null})
  expect(f.request.mock.calls[1]![0]).toMatchObject({kind:'managed',generationDigest:f.a.plan.proposedGenerationDigest})
 }finally{f.dispose()}
})
it('refuses to discard prepared content after a store revision or descriptor change',async()=>{
 const f=await fixture('STAGED',true)
 try{
  const state=f.store.readState()
  await expect(f.store.discardPrepared(state.revision+1,f.failed.descriptorDigest!)).rejects.toThrow('recovery state changed')
  await expect(f.store.discardPrepared(state.revision,'f'.repeat(64))).rejects.toThrow('recovery state changed')
  expect(f.store.readState()).toEqual(state)
 }finally{f.dispose()}
})
it.each([false,true])('cancels an expired prepared B without abandoning healthy A (pending positive: %s)',async pendingReceipt=>{
 const f=await fixture('STAGED',true,pendingReceipt)
 try{
  f.ready();await vi.waitFor(()=>expect(f.request).toHaveBeenCalledOnce())
  vi.setSystemTime(f.now+3600000)
  f.reconnect();await vi.waitFor(()=>expect(f.request).toHaveBeenCalledTimes(2))
  expect(f.transportErrors).toEqual([])
  expect(f.receipts).toHaveLength(1);expect(f.receipts[0]).toMatchObject({phase:'ROLLED_BACK',errorCode:'HUB_EXECUTION_EXPIRED'})
  expect(f.store.readState()).toMatchObject({phase:'stable',active:{generationId:'healthy-a'},pending:null})
  expect(f.journal.read()).toMatchObject({phase:'ROLLED_BACK',pendingReceipt:null})
  // The old execution and prepared pointer no longer block another preview/stage.
  vi.setSystemTime(f.now)
  await expect(f.journal.begin(f.b.cap,randomUUID(),f.b.envelope)).resolves.toMatchObject({phase:'PLANNED'})
 }finally{f.dispose()}
})
it.each([false,true])('recovers online after activation before the pending STAGED receipt was acknowledged (expired: %s)',async expired=>{
 const f=await fixture('STAGED')
 try{
  if(expired)vi.setSystemTime(f.now+3600000)
  f.reconnect(false);f.ready();await vi.waitFor(()=>expect(f.request).toHaveBeenCalledOnce())
  expect(f.transportErrors).toEqual([])
  expect(f.journal.read()).toMatchObject({phase:expired?'ROLLED_BACK':'COMMITTED',pendingReceipt:null})
  expect(f.receipts.map(r=>r.phase)).toEqual(expired?['ROLLED_BACK']:['STAGED','COMMITTED'])
  expect(f.request.mock.calls[0]![0]).toMatchObject({kind:'managed',generationDigest:expired?f.a.plan.proposedGenerationDigest:f.b.plan.proposedGenerationDigest})
 }finally{f.dispose()}
})
