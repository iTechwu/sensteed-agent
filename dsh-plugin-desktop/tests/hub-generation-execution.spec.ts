import {expect,it,vi}from'vitest'
const calls=vi.hoisted(()=>({materialize:vi.fn(async()=>{throw new Error('download failed')})}))
vi.mock('../src/hub-generation-materializer.ts',()=>({materializeHubGeneration:calls.materialize}))
import {HubGenerationExecution}from'../src/hub-generation-execution.ts'
import {HubGenerationStore}from'../src/hub-generation-store.ts'
import {HubExecutionJournal}from'../src/hub-execution-journal.ts'
import {HubGenerationClient}from'../src/hub-generation-client.ts'
import {generationPlanData,hubGenerationContentDigest,type HubGenerationPlanExpected}from'../src/hub-generation-verifier.ts'
import {hubCanonicalJson,hubSyncDigest}from'../src/hub-sync-verifier.ts'
import {generateKeyPairSync,randomUUID,sign}from'node:crypto'
import{mkdtempSync,realpathSync,rmSync}from'node:fs'
import{tmpdir}from'node:os'
import{join}from'node:path'
it('recovers unknown consume with same operation and reports download rollback without changing active',async()=>{
 const now=Date.now(),keys=generateKeyPairSync('ed25519'),identity={origin:'https://ai.hozonauto.com/plugins/api' as const,tenantId:randomUUID(),actorRef:'test',deviceId:randomUUID(),profileId:randomUUID()}
 const expected:HubGenerationPlanExpected={...identity,channel:'stable',target:{sensteedVersion:'1.0.0',harnessVersion:'1.0.0',os:'darwin',arch:'arm64',nodeVersion:'22.0.0',cordisVersion:'4.0.5',libc:null,nodeAbi:'127',hostCapabilities:[],hostBuildDigest:'b'.repeat(64)},snapshotId:randomUUID(),snapshotDigest:'a'.repeat(64),observedStateDigest:'b'.repeat(64),expectedActiveGenerationDigest:null,minimumPolicyRevision:0,requested:[]}
 const{requested:_r,minimumPolicyRevision:_p,...binding}=expected
 const payload={...binding,schemaVersion:'hub-generation-plan-v1',planId:randomUUID(),policyRevision:0,catalogDigest:'c'.repeat(64),proposedGenerationDigest:hubGenerationContentDigest([]),items:[],closureDigest:hubSyncDigest([]),totalBytes:0,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+300000).toISOString()}
 const plan={...payload,planDigest:hubSyncDigest(payload)},trust={schemaVersion:1 as const,keys:{test:keys.publicKey.export({type:'spki',format:'der'}).toString('base64')},revokedKeyIds:[]}
 const envelope={plan,signature:{algorithm:'Ed25519',canonicalization:'RFC8785',keyId:'test',payloadDigest:hubSyncDigest(plan),signature:sign(null,Buffer.from(hubCanonicalJson(plan)),keys.privateKey).toString('base64')}}
 let operationId='';const receipts:unknown[]=[],ops:string[]=[]
 const host={assertCurrent(){},async generationRequest(_ctx:unknown,op:{kind:string;body:Record<string,unknown>}){
  ops.push(op.kind)
  if(op.kind==='prepare')return envelope
  if(op.kind==='authorize')return{executionGrant:randomUUID(),expiresAt:payload.expiresAt}
  if(op.kind==='consume'){operationId=op.body.operationId as string;throw new Error('unknown')}
  if(op.kind==='consume-status')return{planId:plan.planId,operationId,state:'consumed',authorized:true,executionGeneration:'1',executionExpiresAt:new Date(now+1800000).toISOString(),proposedGenerationDigest:plan.proposedGenerationDigest}
  if(op.kind==='receipt'){receipts.push(op.body);return{ack:true}}
  return{manifests:[],descriptors:[]}
 }}
 const root=realpathSync(mkdtempSync(join(tmpdir(),'hub-exec-')))
 try{
  const store=new HubGenerationStore(root,identity),ctx={tenantId:identity.tenantId,actorRef:identity.actorRef} as never,client=new HubGenerationClient(host as never,ctx),cap=await client.prepare(expected,trust,randomUUID())
  await expect(new HubGenerationExecution(store,client,host as never,ctx,trust).stage(cap)).rejects.toThrow('download failed')
  const record=new HubExecutionJournal(store).read()!
  expect(record.phase).toBe('ROLLED_BACK');expect(record.operationId).toBe(operationId);expect(record.pendingReceipt).toBeNull()
  expect(store.readState().active).toBeNull();expect(ops.filter(x=>x==='consume')).toHaveLength(1)
  expect(receipts).toEqual([expect.objectContaining({operationId,generationDigest:generationPlanData(cap).proposedGenerationDigest,phase:'ROLLED_BACK',previousGenerationDigest:null})])
 }finally{rmSync(root,{recursive:true,force:true})}
})
