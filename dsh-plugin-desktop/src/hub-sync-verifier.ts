/** Desktop L0 trust boundary. A verified catalog snapshot is NOT an execution grant. */
import { createHash, createPublicKey, verify } from 'node:crypto'
import { z } from 'zod'
import type { HubGenerationIdentity } from './hub-generation-store.ts'

export const HUB_SYNC_ORIGIN = 'https://ai.hozonauto.com/plugins/api' as const
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
const version = z.string().max(120).regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/u)
export const HubSyncTargetSchema = z.strictObject({
  sensteedVersion: version, harnessVersion: version, os: z.enum(['darwin', 'win32', 'linux']),
  arch: z.enum(['x64', 'arm64']), nodeVersion: version, cordisVersion: version,
  libc: z.enum(['glibc', 'musl']).nullable(), nodeAbi: z.string().regex(/^\d{1,4}$/u),
  hostBuildDigest: digest,
  hostCapabilities: z.array(z.string().regex(/^[a-z][a-z0-9.-]{0,79}$/u)).max(128),
})
const entry = z.strictObject({
  kind: z.enum(['skill', 'plugin']), itemId: z.uuid(), displayName: z.string().max(160), identity: z.string().max(214),
  initialInstall: z.boolean(), required: z.boolean(), offlineBootstrap: z.boolean(), enabled: z.boolean(),
  releaseId: z.uuid().nullable(), version: z.string().max(120).nullable(), artifactDigest: digest.nullable(),
  channelRevision: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(),
  disposition: z.enum(['CURRENT', 'INSTALL', 'UPDATE', 'AVAILABLE', 'USER_REMOVED', 'UNPUBLISHED',
    'INCOMPATIBLE', 'UNVERIFIED_TARGET', 'ACCESS_DENIED', 'REVOKED', 'EVIDENCE_UNAVAILABLE', 'CHANNEL_ROLLBACK_BLOCKED']),
  reason: z.string().max(500).nullable(),
  accessDeclaration: z.strictObject({ containsScripts: z.boolean(), networkHosts: z.array(z.string().max(253)).max(50), fileAccess: z.enum(['none', 'user-selected', 'workspace', 'system']) }).nullable().optional(),
})
export const HubSyncSnapshotSchema = z.strictObject({
  schemaVersion: z.literal('hub-sync-v1'), snapshotId: z.uuid(), origin: z.literal(HUB_SYNC_ORIGIN),
  tenantId: z.uuid(), actorRef: z.string().min(1).max(128), deviceId: z.uuid(), profileId: z.uuid(),
  channel: z.enum(['stable', 'beta']), policyRevision: z.number().int().nonnegative(),
  observedStateDigest: digest, catalogDigest: digest, target: HubSyncTargetSchema,
  entries: z.array(entry).max(256), issuedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
})
export const HubReleaseSignatureSchema = z.strictObject({
  algorithm: z.literal('Ed25519'), canonicalization: z.literal('RFC8785'), keyId: z.string().min(1).max(120),
  payloadDigest: digest, signature: z.string().max(88),
})
const signedSchema = z.strictObject({ snapshot: HubSyncSnapshotSchema, signature: HubReleaseSignatureSchema })
export type HubSyncSnapshot = z.infer<typeof HubSyncSnapshotSchema>
export type HubSyncTarget = z.infer<typeof HubSyncTargetSchema>
export interface HubReleaseTrust { readonly schemaVersion: 1; readonly keys: Readonly<Record<string, string>>; readonly revokedKeyIds: readonly string[] }
export interface HubSyncExpected extends HubGenerationIdentity {
  readonly channel: 'stable' | 'beta'
  readonly observedStateDigest: string
  readonly target: HubSyncTarget
  readonly minimumPolicyRevision: number
}
declare const verifiedSnapshot: unique symbol
/** Unforgeable within the runtime; never serialize this capability across Host RPC. */
export interface VerifiedHubSyncSnapshot { readonly [verifiedSnapshot]: true }
const verified = new WeakMap<VerifiedHubSyncSnapshot, Readonly<HubSyncSnapshot>>()
function fail(message: string): never { throw new Error(`Hub sync: ${message}`) }

/** RFC8785 over I-JSON, matching Hub. Rejects exotic values and malformed UTF-16. */
export function hubCanonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('non-JSON number'); return JSON.stringify(value) }
  if (typeof value === 'string') {
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i)
      if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) fail('invalid Unicode') }
      else if (code >= 0xdc00 && code <= 0xdfff) fail('invalid Unicode')
    }
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) fail('sparse array is not I-JSON')
    return `[${value.map(hubCanonicalJson).join(',')}]`
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${hubCanonicalJson(key)}:${hubCanonicalJson(record[key])}`).join(',')}}`
  }
  return fail('non-JSON payload')
}
export function hubSyncDigest(value: unknown): string { return createHash('sha256').update(hubCanonicalJson(value)).digest('hex') }
function canonicalBase64(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) fail('invalid base64')
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) fail('noncanonical base64')
  return bytes
}
export function freezeHubValue<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeHubValue(child); Object.freeze(value) }
  return value
}
/** Cryptographic check only. Callers must separately parse and bind their protocol domain. */
export function verifyHubReleaseSignature(payload: unknown, signatureValue: unknown, trust: HubReleaseTrust): void {
  const signature = HubReleaseSignatureSchema.parse(signatureValue)
  const bytes = Buffer.from(hubCanonicalJson(payload))
  if (bytes.length > 1024 * 1024) fail('signed payload too large')
  if (trust.schemaVersion !== 1 || !Object.hasOwn(trust.keys, signature.keyId) || trust.revokedKeyIds.includes(signature.keyId)) fail('untrusted signing key')
  if (signature.payloadDigest !== hubSyncDigest(payload)) fail('payload digest mismatch')
  const keyBytes = canonicalBase64(trust.keys[signature.keyId]!)
  if (keyBytes.length > 1024) fail('invalid public key size')
  const key = createPublicKey({ key: keyBytes, type: 'spki', format: 'der' })
  const signatureBytes = canonicalBase64(signature.signature)
  if (key.asymmetricKeyType !== 'ed25519' || signatureBytes.length !== 64 || !verify(null, bytes, key, signatureBytes)) fail('invalid signature')
}
export function verifyHubSyncSnapshot(value: unknown, trust: HubReleaseTrust, expected: HubSyncExpected, now = Date.now()): VerifiedHubSyncSnapshot {
  const { snapshot, signature } = signedSchema.parse(value)
  verifyHubReleaseSignature(snapshot, signature, trust)
  for (const field of ['origin', 'tenantId', 'actorRef', 'deviceId', 'profileId', 'channel', 'observedStateDigest'] as const) {
    if (snapshot[field] !== expected[field]) fail(`${field} binding mismatch`)
  }
  if (hubSyncDigest(snapshot.target) !== hubSyncDigest(HubSyncTargetSchema.parse(expected.target))) fail('target binding mismatch')
  if (!Number.isSafeInteger(expected.minimumPolicyRevision) || expected.minimumPolicyRevision < 0 || snapshot.policyRevision < expected.minimumPolicyRevision) fail('policy revision rollback')
  const issued = Date.parse(snapshot.issuedAt), expiry = Date.parse(snapshot.expiresAt)
  if (!Number.isFinite(now) || issued > now + 30_000 || expiry <= now || expiry <= issued || expiry - issued > 5 * 60_000) fail('expired or invalid snapshot lifetime')
  const identities = new Set<string>()
  for (const item of snapshot.entries) {
    const identity = `${item.kind}:${item.itemId}`
    if (identities.has(identity)) fail('duplicate content identity')
    identities.add(identity)
    if (item.required && !item.initialInstall) fail('contradictory required flag')
    if (item.offlineBootstrap && (item.kind !== 'skill' || !item.required)) fail('invalid offline mirror')
    if (['CURRENT', 'INSTALL', 'UPDATE'].includes(item.disposition) && (!item.releaseId || !item.version || !item.artifactDigest || item.channelRevision < 1 || item.bytes < 1)) fail('incomplete ready release')
  }
  const capability = Object.freeze({}) as VerifiedHubSyncSnapshot
  verified.set(capability, freezeHubValue(snapshot))
  return capability
}
export function hubSyncSnapshotData(value: VerifiedHubSyncSnapshot): Readonly<HubSyncSnapshot> {
  const result = verified.get(value)
  if (!result) return fail('invalid snapshot capability')
  return result
}
