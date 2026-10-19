import{inspectSavedHubPlan}from'../src/hub-saved-plan.ts'
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hubGenerationContentDigest, verifyHubGenerationPlan, type HubGenerationPlan, type HubGenerationPlanExpected } from '../src/hub-generation-verifier.ts'
import { hubCanonicalJson, hubSyncDigest, type HubReleaseTrust } from '../src/hub-sync-verifier.ts'
import { HubGenerationStore } from '../src/hub-generation-store.ts'
import { HubExecutionJournal } from '../src/hub-execution-journal.ts'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
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

it('persists operation identity before consume and forbids stale and terminal worker transitions', async () => {
 const f = fixture(), root = realpathSync(mkdtempSync(join(tmpdir(), 'hub-execution-'))); roots.push(root)
 const store = new HubGenerationStore(root, { origin:f.expected.origin,tenantId:f.expected.tenantId,actorRef:f.expected.actorRef,deviceId:f.expected.deviceId,profileId:f.expected.profileId }), journal = new HubExecutionJournal(store)
 const cap = verifyHubGenerationPlan(f.signed(), f.trust, f.expected), first = await journal.begin(cap)
 expect(new HubExecutionJournal(store).read()).toEqual(first)
 await expect(journal.begin(cap)).rejects.toThrow('pending')
 const consuming = await journal.advance(first, 'CONSUMING')
 await expect(journal.advance(first, 'NEEDS_ATTENTION')).rejects.toThrow('Stale')
 await expect(journal.advance(consuming, 'AUTHORIZED')).rejects.toThrow('authorization missing')
 const authorized = await journal.advance(consuming, 'AUTHORIZED', { executionGeneration: '1', executionExpiresAt: new Date(Date.now()+1800000).toISOString() })
 const staged = await journal.advance(authorized, 'STAGED', { descriptorDigest: 'a'.repeat(64) })
 const queued=await journal.queueReceipt(staged,{phase:'STAGED',evidenceDigest:'b'.repeat(64),occurredAt:new Date().toISOString(),errorCode:null})
 expect(new HubExecutionJournal(store).read()?.pendingReceipt).toEqual(queued.pendingReceipt)
 await expect(journal.advance(queued,'COMMITTED')).rejects.toThrow('acknowledgment')
 const acknowledged=await journal.acknowledgeReceipt(queued)
 expect(acknowledged.receiptSeq).toBe(1)
 const rollback = await journal.advance(acknowledged, 'ROLLED_BACK')
 expect(rollback.generationDigest).toBe(f.plan.proposedGenerationDigest)
 await expect(journal.advance(rollback, 'AUTHORIZED')).rejects.toThrow('transition')
 expect(readFileSync(join(store.directory, 'execution.json'), 'utf8')).not.toContain('executionGrant')
})
it('allows a fresh operation after an authorize failure before consumption starts', async () => {
 const f = fixture(), root = realpathSync(mkdtempSync(join(tmpdir(), 'hub-retry-'))); roots.push(root)
 const store = new HubGenerationStore(root, { origin:f.expected.origin,tenantId:f.expected.tenantId,actorRef:f.expected.actorRef,deviceId:f.expected.deviceId,profileId:f.expected.profileId }), journal = new HubExecutionJournal(store)
 const cap = verifyHubGenerationPlan(f.signed(), f.trust, f.expected)
 const failed = await journal.advance(await journal.begin(cap), 'NEEDS_ATTENTION')
 const retried = await journal.begin(cap)
 expect(retried.operationId).not.toBe(failed.operationId)
 const consumed = await journal.advance(retried, 'CONSUMING')
 await journal.advance(consumed, 'NEEDS_ATTENTION')
 await expect(journal.begin(cap)).rejects.toThrow('already pending')
})
it('rejects forged plan capability and journal identity tampering', async () => {
 const f=fixture(), root=realpathSync(mkdtempSync(join(tmpdir(),'hub-execution-'))); roots.push(root)
 const store=new HubGenerationStore(root, { origin:f.expected.origin,tenantId:f.expected.tenantId,actorRef:f.expected.actorRef,deviceId:f.expected.deviceId,profileId:f.expected.profileId }), journal=new HubExecutionJournal(store)
 await expect(journal.begin({} as never)).rejects.toThrow('capability')
 const value=await journal.begin(verifyHubGenerationPlan(f.signed(),f.trust,f.expected))
 writeFileSync(join(store.directory,'execution.json'),JSON.stringify({...value,scope:'f'.repeat(64)}),{mode:0o600})
 expect(()=>journal.read()).toThrow('identity mismatch')
})

it('retains the signed inventory for identity and target-bound recovery without granting execution',async()=>{const f=fixture(),root=realpathSync(mkdtempSync(join(tmpdir(),'hub-inventory-')));roots.push(root);const identity={origin:f.expected.origin,tenantId:f.expected.tenantId,actorRef:f.expected.actorRef,deviceId:f.expected.deviceId,profileId:f.expected.profileId},store=new HubGenerationStore(root,identity),journal=new HubExecutionJournal(store),envelope=f.signed();const record=await journal.begin(verifyHubGenerationPlan(envelope,f.trust,f.expected),randomUUID(),envelope);expect(inspectSavedHubPlan(record,identity,f.expected.target,f.trust).plan.planId).toBe(f.plan.planId);expect(()=>inspectSavedHubPlan(record,{...identity,actorRef:'other'},f.expected.target,f.trust)).toThrow();expect(()=>inspectSavedHubPlan(record,identity,{...f.expected.target,hostBuildDigest:'a'.repeat(64)},f.trust)).toThrow();await expect(journal.saveHealthyInventory()).rejects.toThrow('not healthy');expect(journal.readHealthyInventory()).toBeUndefined()})

it('preserves the acknowledged healthy inventory when the next execution replaces its journal',async()=>{
 const f=fixture(),root=realpathSync(mkdtempSync(join(tmpdir(),'hub-healthy-')));roots.push(root)
 const identity={origin:f.expected.origin,tenantId:f.expected.tenantId,actorRef:f.expected.actorRef,deviceId:f.expected.deviceId,profileId:f.expected.profileId},store=new HubGenerationStore(root,identity),journal=new HubExecutionJournal(store),envelope=f.signed(),cap=verifyHubGenerationPlan(envelope,f.trust,f.expected)
 const stage=store.generationDirectory('g1');mkdirSync(stage,{mode:0o700});mkdirSync(join(stage,'skills'),{mode:0o700})
 await store.prepare({schemaVersion:1,identity,generationId:'g1',packages:[],skillsRoot:'skills',files:{}});await store.activate();await store.markHealthy('g1')
 let record=await journal.begin(cap,randomUUID(),envelope);record=await journal.advance(record,'CONSUMING');record=await journal.advance(record,'AUTHORIZED',{executionGeneration:'1',executionExpiresAt:new Date(Date.now()+1800000).toISOString()});record=await journal.advance(record,'STAGED',{descriptorDigest:store.readState().active!.descriptorDigest});record=await journal.advance(record,'COMMITTED');record=await journal.advance(record,'ACTIVATED')
 record=await journal.queueReceipt(record,{phase:'ACTIVATED',evidenceDigest:'a'.repeat(64),occurredAt:new Date().toISOString(),errorCode:null})
 await expect(journal.saveHealthyInventory()).rejects.toThrow('not healthy');record=await journal.acknowledgeReceipt(record);await journal.saveHealthyInventory()
 expect(journal.readHealthyInventory()).toEqual(record)
 const next=await journal.begin(cap,randomUUID(),envelope);expect(next.operationId).not.toBe(record.operationId);expect(journal.readHealthyInventory()?.operationId).toBe(record.operationId)
 writeFileSync(join(store.directory,'healthy-inventory.json'),JSON.stringify({...record,scope:'f'.repeat(64)}),{mode:0o600});expect(()=>journal.readHealthyInventory()).toThrow('Invalid healthy')
})
