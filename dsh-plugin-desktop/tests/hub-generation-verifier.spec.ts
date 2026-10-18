import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { generationPlanData, hubGenerationContentDigest, verifyHubGenerationPlan, type HubGenerationPlan, type HubGenerationPlanExpected } from '../src/hub-generation-verifier.ts'
import { hubCanonicalJson, hubSyncDigest, type HubReleaseTrust } from '../src/hub-sync-verifier.ts'

function fixture() {
  const now = Date.now(), keys = generateKeyPairSync('ed25519')
  const trust: HubReleaseTrust = { schemaVersion: 1, keys: { test: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }, revokedKeyIds: [] }
  const item: HubGenerationPlan['items'][number] = { kind: 'skill', itemId: randomUUID(), action: 'install', enabled: true, releaseId: randomUUID(), artifactDigest: '1'.repeat(64), manifestDigest: '2'.repeat(64), channelRevision: 1, lockGraphDigest: null, packSetDigest: null }
  const expected: HubGenerationPlanExpected = { origin: 'https://ai.hozonauto.com/plugins/api', tenantId: randomUUID(), actorRef: 'user@example.com', deviceId: randomUUID(), profileId: randomUUID(), channel: 'stable',
    snapshotId: randomUUID(), snapshotDigest: '3'.repeat(64), observedStateDigest: '4'.repeat(64), expectedActiveGenerationDigest: null, minimumPolicyRevision: 1,
    target: { sensteedVersion: '1.0.0', harnessVersion: '1.0.0', os: 'darwin', arch: 'arm64', nodeVersion: '22.0.0', cordisVersion: '4.0.5', libc: null, nodeAbi: '127', hostCapabilities: [] },
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
describe('aggregate signed execution plan', () => {
  it('binds the complete requested collection and exposes frozen data through an opaque capability', () => {
    const f = fixture(), cap = verifyHubGenerationPlan(f.signed(), f.trust, f.expected, f.now)
    expect(generationPlanData(cap).proposedGenerationDigest).toBe(f.plan.proposedGenerationDigest)
    expect(Object.isFrozen(generationPlanData(cap).items[0])).toBe(true)
    expect(() => generationPlanData({} as never)).toThrow('invalid plan capability')
  })
  it.each(['tenantId', 'actorRef', 'deviceId', 'profileId', 'snapshotId', 'snapshotDigest', 'observedStateDigest', 'channel', 'expectedActiveGenerationDigest'] as const)('rejects another %s even under a valid signature', field => {
    const f = fixture()
    expect(() => verifyHubGenerationPlan(f.signed(), f.trust, { ...f.expected, [field]: randomUUID() }, f.now)).toThrow('binding mismatch')
  })
  it('rejects unsigned mutations, revocation, inner plan digest tampering and foreign protocol domains', () => {
    const f = fixture(), wire = f.signed()
    wire.plan.totalBytes++
    expect(() => verifyHubGenerationPlan(wire, f.trust, f.expected, f.now)).toThrow('digest mismatch')
    expect(() => verifyHubGenerationPlan(f.signed(), { ...f.trust, revokedKeyIds: ['test'] }, f.expected, f.now)).toThrow('untrusted')
    expect(() => verifyHubGenerationPlan({ snapshot: f.plan, signature: f.signed().signature }, f.trust, f.expected, f.now)).toThrow()
  })
  it('rejects expired plans, target drift, policy rollback and unexpected item state', () => {
    const f = fixture()
    expect(() => verifyHubGenerationPlan(f.signed(), f.trust, f.expected, f.now + 300000)).toThrow('lifetime')
    expect(() => verifyHubGenerationPlan(f.signed(), f.trust, { ...f.expected, target: { ...f.expected.target, nodeAbi: '128' } }, f.now)).toThrow('target')
    expect(() => verifyHubGenerationPlan(f.signed(), f.trust, { ...f.expected, minimumPolicyRevision: 2 }, f.now)).toThrow('rollback')
    expect(() => verifyHubGenerationPlan(f.signed(), f.trust, { ...f.expected, requested: [] }, f.now)).toThrow('collection')
    expect(() => verifyHubGenerationPlan(f.signed(), f.trust, { ...f.expected, requested: [{ ...f.expected.requested[0]!, enabled: false }] }, f.now)).toThrow('item mismatch')
  })
  it('rejects signed content digest mismatch and missing plugin closure evidence', () => {
    const f = fixture()
    expect(() => verifyHubGenerationPlan(f.signed({ ...f.plan, proposedGenerationDigest: 'e'.repeat(64) }), f.trust, f.expected, f.now)).toThrow('content digest')
    const plugin = { ...f.plan.items[0]!, kind: 'plugin' as const }
    expect(() => verifyHubGenerationPlan(f.signed({ ...f.plan, items: [plugin] }), f.trust, { ...f.expected, requested: [{ ...f.expected.requested[0]!, kind: 'plugin' }] }, f.now)).toThrow('closure')
  })
  it('defines generation content independently of update action, list ordering, removed items and channel counters', () => {
    const f = fixture(), first = f.plan.items[0]!, second = { ...first, itemId: randomUUID(), enabled: false }
    expect(hubGenerationContentDigest([first, second])).toBe(hubGenerationContentDigest([{ ...second, action: 'retain', channelRevision: 99 }, first]))
    expect(hubGenerationContentDigest([first, { ...second, action: 'uninstall' }])).toBe(hubGenerationContentDigest([first]))
    expect(hubGenerationContentDigest([first])).not.toBe(hubGenerationContentDigest([{ ...first, enabled: false }]))
  })
})
