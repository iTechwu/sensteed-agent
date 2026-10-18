import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { generationPlanData, hubGenerationContentDigest, verifyHubGenerationPlan, type HubGenerationPlan, type HubGenerationPlanExpected } from '../src/hub-generation-verifier.ts'
import { hubCanonicalJson, hubSyncDigest, type HubReleaseTrust } from '../src/hub-sync-verifier.ts'
import { HubGenerationClient, hubGenerationConsumptionData } from '../src/hub-generation-client.ts'
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

it('uses only verified plan identities and recovers consume with exactly the same operation', async () => {
 const f=fixture(), cap=verifyHubGenerationPlan(f.signed(),f.trust,f.expected), operationId=randomUUID()
 const wire=vi.fn(async (_context:unknown, op:{kind:string}) => {
   if(op.kind==='prepare')return f.signed()
   if(op.kind==='authorize')return { executionGrant:randomUUID(),expiresAt:f.plan.expiresAt }
   return {planId:f.plan.planId,operationId,state:'consumed',authorized:true,executionGeneration:'1',executionExpiresAt:new Date(Date.now()+1800000).toISOString(),proposedGenerationDigest:f.plan.proposedGenerationDigest}
 })
 const context={tenantId:f.expected.tenantId,actorRef:f.expected.actorRef,workspaceId:randomUUID(),permissions:[],revision:0}
 const client=new HubGenerationClient({assertCurrent:vi.fn(),generationRequest:wire} as never,context)
 expect(generationPlanData(await client.prepare(f.expected,f.trust,randomUUID())).planId).toBe(f.plan.planId)
 const grant=await client.authorize(cap)
 expect((await client.consume(cap,grant,operationId)).authorized).toBe(true)
 expect((await client.status(cap,operationId)).executionGeneration).toBe('1')
 const proof=await client.consumption(cap,operationId)
 expect(hubGenerationConsumptionData(proof)).toMatchObject({operationId,planDigest:generationPlanData(cap).planDigest})
 expect(()=>hubGenerationConsumptionData({} as never)).toThrow('capability')
 expect(wire.mock.calls.at(-1)?.[1]).toMatchObject({kind:'consume-status',planId:f.plan.planId,body:{operationId}})
 await expect(client.status(cap,'../../other')).rejects.toThrow()
 await expect(client.authorize({} as never)).rejects.toThrow('capability')
})
it('rejects another operation and an authorized expired status', async () => {
 const f=fixture(),cap=verifyHubGenerationPlan(f.signed(),f.trust,f.expected),operationId=randomUUID()
 const status={planId:f.plan.planId,operationId:randomUUID(),state:'consumed',authorized:true,executionGeneration:'1',executionExpiresAt:new Date(Date.now()+1800000).toISOString(),proposedGenerationDigest:f.plan.proposedGenerationDigest}
 const wire=vi.fn(async()=>status)
 const client=new HubGenerationClient({assertCurrent:vi.fn(),generationRequest:wire} as never,{tenantId:f.expected.tenantId,actorRef:f.expected.actorRef} as never)
 await expect(client.status(cap,operationId)).rejects.toThrow('binding mismatch')
 status.operationId=operationId;status.executionExpiresAt=new Date(Date.now()-1000).toISOString()
 await expect(client.status(cap,operationId)).rejects.toThrow('status invalid')
})
it('recovers an expired signed plan only with fresh consumed operation authority', async () => {
 const f=fixture(),operationId=randomUUID(),now=Date.now()
 const envelope=f.signed({...f.plan,issuedAt:new Date(now-600000).toISOString(),expiresAt:new Date(now-300000).toISOString()})
 const status={planId:f.plan.planId,operationId,state:'consumed',authorized:true,executionGeneration:'9',executionExpiresAt:new Date(now+1800000).toISOString(),proposedGenerationDigest:f.plan.proposedGenerationDigest}
 const wire=vi.fn(async()=>status),assertCurrent=vi.fn()
 const client=new HubGenerationClient({assertCurrent,generationRequest:wire} as never,{tenantId:f.expected.tenantId,actorRef:f.expected.actorRef} as never)
 const recovery=await client.consumptionForRecovery(envelope,f.trust,f.expected,operationId)
 expect(hubGenerationConsumptionData(recovery.proof).executionGeneration).toBe('9')
 expect(()=>generationPlanData(recovery.plan as never)).toThrow('capability')
 assertCurrent.mockImplementation(()=>{throw new Error('identity changed')})
 expect(()=>hubGenerationConsumptionData(recovery.proof)).toThrow('identity changed')
 assertCurrent.mockImplementation(()=>undefined);status.authorized=false
 await expect(client.consumptionForRecovery(envelope,f.trust,f.expected,operationId)).rejects.toThrow('not authorized')
})
it('recovers an expired consumed operation only as failure reporting authority', async () => {
 const f=fixture(),operationId=randomUUID(),envelope=f.signed(),cap=verifyHubGenerationPlan(envelope,f.trust,f.expected)
 const status={planId:f.plan.planId,operationId,state:'consumed',authorized:false,executionGeneration:'9',executionExpiresAt:new Date(Date.now()-1000).toISOString(),proposedGenerationDigest:f.plan.proposedGenerationDigest}
 const wire=vi.fn(async(_context:unknown,op:{kind:string})=>op.kind==='receipt'?{ack:true}:status),assertCurrent=vi.fn()
 const client=new HubGenerationClient({assertCurrent,generationRequest:wire} as never,{tenantId:f.expected.tenantId,actorRef:f.expected.actorRef} as never)
 await expect(client.consumptionForRecovery(envelope,f.trust,f.expected,operationId)).rejects.toThrow('not authorized')
 const {proof}=await client.failureConsumptionForRecovery(envelope,f.trust,f.expected,operationId)
 expect(()=>hubGenerationConsumptionData(proof)).toThrow('cannot authorize execution')
 await expect(client.downloads(cap,proof)).rejects.toThrow('cannot authorize execution')
 const receipt={seq:0,previousGenerationDigest:null,evidenceDigest:'a'.repeat(64),occurredAt:new Date().toISOString(),errorCode:null}
 for(const phase of ['STAGED','COMMITTED','ACTIVATED'] as const)await expect(client.receipt(proof,{...receipt,phase})).rejects.toThrow('cannot report successful execution')
 await expect(client.receipt(proof,{...receipt,phase:'ROLLED_BACK'})).resolves.toBeUndefined()
 await expect(client.receipt(proof,{...receipt,phase:'NEEDS_ATTENTION'})).resolves.toBeUndefined()
 status.operationId=randomUUID()
 await expect(client.failureConsumptionForRecovery(envelope,f.trust,f.expected,operationId)).rejects.toThrow('not authorized')
 status.operationId=operationId;assertCurrent.mockImplementation(()=>{throw Error('identity changed')})
 await expect(client.receipt(proof,{...receipt,phase:'ROLLED_BACK'})).rejects.toThrow('identity changed')
})
