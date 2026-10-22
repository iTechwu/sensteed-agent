/** Local cryptographic and filesystem fixtures only; no deployed artifact or trusted target proof. */
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HubGenerationStore, HUB_GENERATION_ORIGIN } from '../../dsh-plugin-desktop/src/hub-generation-store.ts'
import { HubExecutionJournal } from '../../dsh-plugin-desktop/src/hub-execution-journal.ts'
import { hubGenerationContentDigest, verifyHubGenerationPlan, type HubGenerationPlanExpected } from '../../dsh-plugin-desktop/src/hub-generation-verifier.ts'
import { hubCanonicalJson, hubSyncDigest, type HubReleaseTrust, type HubSyncTarget } from '../../dsh-plugin-desktop/src/hub-sync-verifier.ts'
import { resolveHubHostIdentity } from '../../dsh-plugin-desktop/src/hub-host-identity.ts'
import { HUB_RELEASE_EVIDENCE_FILE, verifyHubGenerationContent } from '../../dsh-plugin-desktop/src/hub-generation-content.ts'

export async function signedNextHubFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'next-hub-signed-local-')))
  const profileDirectory = join(root, 'enterprise-profile')
  mkdirSync(profileDirectory, { mode: 0o700 })
  const now = Date.now(), keys = generateKeyPairSync('ed25519')
  const trust: HubReleaseTrust = { schemaVersion: 1, keys: { 'local-test': keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }, revokedKeyIds: [] }
  const target: HubSyncTarget = { sensteedVersion: '2.0.19-next', harnessVersion: '0.2.1-rc.2', cordisVersion: '4.0.5', os: 'darwin', arch: 'arm64', nodeVersion: '22.19.0', nodeAbi: '127', libc: null, hostCapabilities: [], hostBuildDigest: createHash('sha256').update('local-test-next-base').digest('hex') }
  const context = { tenantId: randomUUID(), actorRef: 'next-local-user', workspaceId: randomUUID(), permissions: [], revision: 1 }
  const identity = await resolveHubHostIdentity(root, profileDirectory, { assertCurrent() {}, async bindDevice() { return randomUUID() } } as never, context)
  const store = new HubGenerationStore(root, identity), journal = new HubExecutionJournal(store)
  const expected: HubGenerationPlanExpected = { ...identity, target, channel: 'stable', snapshotId: randomUUID(), snapshotDigest: hubSyncDigest('snapshot'), observedStateDigest: hubSyncDigest([]), expectedActiveGenerationDigest: null, minimumPolicyRevision: 1, requested: [] }
  const { requested: _requested, minimumPolicyRevision: _minimum, ...binding } = expected
  const payload = { ...binding, schemaVersion: 'hub-generation-plan-v1', planId: randomUUID(), policyRevision: 1, catalogDigest: hubSyncDigest('catalog'), proposedGenerationDigest: hubGenerationContentDigest([]), items: [], closureDigest: hubSyncDigest([]), totalBytes: 0, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 300000).toISOString() }
  const plan = { ...payload, planDigest: hubSyncDigest(payload) }
  const signature = (value: unknown) => ({ algorithm: 'Ed25519', canonicalization: 'RFC8785', keyId: 'local-test', payloadDigest: hubSyncDigest(value), signature: sign(null, Buffer.from(hubCanonicalJson(value)), keys.privateKey).toString('base64') })
  const envelope = { plan, signature: signature(plan) }, cap = verifyHubGenerationPlan(envelope, trust, expected)
  const generationId = randomUUID(), generation = store.generationDirectory(generationId)
  mkdirSync(join(generation, 'skills'), { recursive: true, mode: 0o700 })
  const evidence = JSON.stringify({ manifests: [] })
  writeFileSync(join(generation, HUB_RELEASE_EVIDENCE_FILE), evidence, { mode: 0o600 })
  const state = await store.prepare({ schemaVersion: 2, identity, generationId, packages: [], skillsRoot: 'skills', files: { [HUB_RELEASE_EVIDENCE_FILE]: createHash('sha256').update(evidence).digest('hex') }, verifiedComposition: { entries: [], skills: [] } })
  let record = await journal.begin(cap, randomUUID(), envelope)
  record = await journal.advance(record, 'CONSUMING')
  record = await journal.advance(record, 'AUTHORIZED', { executionGeneration: '1', executionExpiresAt: new Date(now + 1800000).toISOString() })
  record = await journal.advance(record, 'STAGED', { descriptorDigest: state.pending!.descriptorDigest })
  const authorization = { schemaVersion: 'hub-generation-boot-v1', ...identity, target, generationDigest: plan.proposedGenerationDigest, contentDigest: plan.proposedGenerationDigest, policyRevision: 1, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString() }
  const lease = { authorization, signature: signature(authorization) }
  const managedRequest = { kind: 'managed' as const, identity, generationDigest: plan.proposedGenerationDigest, lease }
  return {
    root, userData: root, profileDirectory, target, trust, identity, context, store, journal, generationId, plan, lease, managedRequest,
    activateRequest: { kind: 'activate' as const, identity, operationId: record.operationId },
    async commit() { record = await journal.advance(journal.read()!, 'COMMITTED'); verifyHubGenerationContent(store, plan as never, trust); return record },
  }
}
