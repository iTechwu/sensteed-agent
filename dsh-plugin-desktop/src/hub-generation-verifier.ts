/** L0 aggregate plan authority; catalog observations cannot mint this capability. */
import { z } from 'zod'
import type { HubGenerationIdentity } from './hub-generation-store.ts'
import { HUB_SYNC_ORIGIN, HubSyncTargetSchema, HubReleaseSignatureSchema, hubSyncDigest, freezeHubValue, verifyHubReleaseSignature, type HubReleaseTrust, type HubSyncTarget } from './hub-sync-verifier.ts'

const digest = z.string().regex(/^[a-f0-9]{64}$/u)
const itemSchema = z.strictObject({
  kind: z.enum(['skill', 'plugin']), itemId: z.uuid(),
  action: z.enum(['retain', 'install', 'update', 'uninstall']), enabled: z.boolean(),
  releaseId: z.uuid(), artifactDigest: digest, manifestDigest: digest,
  channelRevision: z.number().int().nonnegative(), lockGraphDigest: digest.nullable(), packSetDigest: digest.nullable(),
})
export const HubGenerationPlanSchema = z.strictObject({
  schemaVersion: z.literal('hub-generation-plan-v1'), planId: z.uuid(), origin: z.literal(HUB_SYNC_ORIGIN),
  tenantId: z.uuid(), actorRef: z.string().min(1).max(128), deviceId: z.uuid(), profileId: z.uuid(),
  target: HubSyncTargetSchema, channel: z.enum(['stable', 'beta']), snapshotId: z.uuid(), snapshotDigest: digest,
  policyRevision: z.number().int().nonnegative(), catalogDigest: digest, observedStateDigest: digest,
  expectedActiveGenerationDigest: digest.nullable(), proposedGenerationDigest: digest,
  items: z.array(itemSchema).max(256), closureDigest: digest, totalBytes: z.number().int().nonnegative(),
  issuedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), planDigest: digest,
})
const signedSchema = z.strictObject({ plan: HubGenerationPlanSchema, signature: HubReleaseSignatureSchema })
export type HubGenerationPlan = z.infer<typeof HubGenerationPlanSchema>
export type HubGenerationPlanItem = z.infer<typeof itemSchema>
export interface HubGenerationPlanExpected extends HubGenerationIdentity {
  readonly channel: 'stable' | 'beta'
  readonly target: HubSyncTarget
  readonly snapshotId: string
  readonly snapshotDigest: string
  readonly observedStateDigest: string
  readonly expectedActiveGenerationDigest: string | null
  readonly minimumPolicyRevision: number
  readonly requested: readonly Pick<HubGenerationPlanItem, 'kind' | 'itemId' | 'action' | 'enabled'>[]
}
declare const verifiedPlan: unique symbol
export interface VerifiedHubGenerationPlan { readonly [verifiedPlan]: true }
const plans = new WeakMap<VerifiedHubGenerationPlan, Readonly<HubGenerationPlan>>()
function fail(message: string): never { throw new Error(`Hub generation plan: ${message}`) }
const identity = (item: {kind: string; itemId: string}): string => `${item.kind}:${item.itemId}`
/** Semantic content identity, separate from the local descriptor/layout digest. */
export function hubGenerationContentDigest(items: readonly HubGenerationPlanItem[]): string {
  const active = items.filter(item => item.action !== 'uninstall').map(item => ({
    kind: item.kind, itemId: item.itemId, releaseId: item.releaseId, artifactDigest: item.artifactDigest,
    manifestDigest: item.manifestDigest, lockGraphDigest: item.lockGraphDigest, packSetDigest: item.packSetDigest, enabled: item.enabled,
  })).sort((a, b) => identity(a) < identity(b) ? -1 : identity(a) > identity(b) ? 1 : 0)
  return hubSyncDigest({ schemaVersion: 'hub-generation-content-v1', items: active })
}
function checkedPlan(value: unknown, trust: HubReleaseTrust, expected: HubGenerationPlanExpected, now: number, recovery: boolean): Readonly<HubGenerationPlan> {
  const { plan, signature } = signedSchema.parse(value)
  verifyHubReleaseSignature(plan, signature, trust)
  const { planDigest, ...unsignedDigest } = plan
  if (planDigest !== hubSyncDigest(unsignedDigest)) fail('plan digest mismatch')
  for (const field of ['origin', 'tenantId', 'actorRef', 'deviceId', 'profileId', 'channel', 'snapshotId', 'snapshotDigest', 'observedStateDigest', 'expectedActiveGenerationDigest'] as const) {
    if (plan[field] !== expected[field]) fail(`${field} binding mismatch`)
  }
  if (hubSyncDigest(plan.target) !== hubSyncDigest(HubSyncTargetSchema.parse(expected.target))) fail('target binding mismatch')
  if (!Number.isSafeInteger(expected.minimumPolicyRevision) || expected.minimumPolicyRevision < 0 || plan.policyRevision < expected.minimumPolicyRevision) fail('policy revision rollback')
  const issued = Date.parse(plan.issuedAt), expires = Date.parse(plan.expiresAt)
  if (!Number.isFinite(now) || issued > now + 30_000 || !recovery && expires <= now || expires <= issued || expires - issued > 300_000) fail('expired or invalid plan lifetime')
  const requested = new Map(expected.requested.map(item => [identity(item), item]))
  if (requested.size !== expected.requested.length || requested.size !== plan.items.length) fail('requested collection mismatch')
  const seen = new Set<string>()
  for (const item of plan.items) {
    const key = identity(item), request = requested.get(key)
    if (seen.has(key) || !request || item.action !== request.action || item.enabled !== request.enabled) fail('requested item mismatch')
    seen.add(key)
    if (item.kind === 'plugin' ? !item.lockGraphDigest || !item.packSetDigest : item.lockGraphDigest !== null || item.packSetDigest !== null) fail('closure evidence mismatch')
    if (item.action !== 'uninstall' && item.channelRevision < 1) fail('invalid active channel revision')
  }
  if (plan.proposedGenerationDigest !== hubGenerationContentDigest(plan.items)) fail('generation content digest mismatch')
  return freezeHubValue(plan)
}
/** Observation only, used to bind a fresh server operation-status query after restart. */
export function inspectHubGenerationPlanForRecovery(value: unknown, trust: HubReleaseTrust, expected: HubGenerationPlanExpected, now = Date.now()): Readonly<HubGenerationPlan> {
  return checkedPlan(value, trust, expected, now, true)
}
export function verifyHubGenerationPlan(value: unknown, trust: HubReleaseTrust, expected: HubGenerationPlanExpected, now = Date.now()): VerifiedHubGenerationPlan {
  const plan = checkedPlan(value, trust, expected, now, false)
  const capability = Object.freeze({}) as VerifiedHubGenerationPlan
  plans.set(capability, plan)
  return capability
}
export function generationPlanData(value: VerifiedHubGenerationPlan): Readonly<HubGenerationPlan> {
  const plan = plans.get(value)
  if (!plan) return fail('invalid plan capability')
  return plan
}
