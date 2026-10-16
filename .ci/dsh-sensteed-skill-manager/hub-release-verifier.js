import { createPublicKey, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import semver from 'semver'
import { jcs, sha256, MAX_ARCHIVE_BYTES } from './skill-archive.js'
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
export const DIGEST = /^[a-f0-9]{64}$/u
export const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
export const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-beta(\.[1-9]\d*)?)?$/u
export function hubFailure(code, message = '企业技能校验失败，请刷新后重新确认。') { return Object.assign(new Error(message), { code }) }
export function requireValue(value, code = 'HUB_INVALID_RESPONSE') { if (!value) throw hubFailure(code) }
function exact(value, fields) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...fields].sort().join('|') }
function base64(value) { return typeof value === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value) && Buffer.from(value, 'base64').toString('base64') === value }
export function trustedKeys() {
  try { return JSON.parse(readFileSync(new URL('./trusted-release-keys.json', import.meta.url), 'utf8')) }
  catch { throw hubFailure('HUB_TRUST_UNAVAILABLE', '企业技能信任配置缺失，暂时无法安装。') }
}
export function verifyRelease(signed, trust = trustedKeys(), hostVersion) {
  requireValue(exact(signed, ['manifest', 'signature']))
  const m = signed.manifest, s = signed.signature
  requireValue(exact(m, ['schemaVersion','tenantId','skillId','releaseId','kind','installName','version','artifact','fileManifestDigest','compatibility','accessDeclaration','source','issuedAt']))
  requireValue(m.schemaVersion === '1.1' && m.kind === 'skill' && [m.tenantId,m.skillId,m.releaseId].every(v => UUID.test(v))
    && typeof m.installName === 'string' && m.installName.length <= 80 && NAME.test(m.installName) && VERSION.test(m.version)
    && DIGEST.test(m.fileManifestDigest) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/u.test(m.issuedAt) && Number.isFinite(Date.parse(m.issuedAt)))
  requireValue(exact(m.artifact, ['sha256','bytes','format']) && m.artifact.format === 'zip' && DIGEST.test(m.artifact.sha256)
    && Number.isSafeInteger(m.artifact.bytes) && m.artifact.bytes >= 22 && m.artifact.bytes <= MAX_ARCHIVE_BYTES)
  requireValue(exact(m.compatibility, ['sensteed','testedTargets']) && typeof m.compatibility.sensteed === 'string' && m.compatibility.sensteed.length <= 120
    && Array.isArray(m.compatibility.testedTargets) && m.compatibility.testedTargets.length === 0)
  const a = m.accessDeclaration
  requireValue(exact(a, ['containsScripts','networkHosts','fileAccess']) && typeof a.containsScripts === 'boolean'
    && Array.isArray(a.networkHosts) && a.networkHosts.length <= 50 && a.networkHosts.every(v => typeof v === 'string' && v.length <= 253)
    && ['none','user-selected','workspace','system'].includes(a.fileAccess) && exact(m.source,['kind']) && m.source.kind === 'upload')
  requireValue(exact(s, ['algorithm','canonicalization','keyId','payloadDigest','signature']) && s.algorithm === 'Ed25519' && s.canonicalization === 'RFC8785'
    && typeof s.keyId === 'string' && s.keyId.length > 0 && s.keyId.length <= 120 && DIGEST.test(s.payloadDigest) && base64(s.signature) && Buffer.from(s.signature,'base64').length === 64)
  requireValue(trust?.schemaVersion === 1 && trust.keys && Array.isArray(trust.revokedKeyIds) && Object.hasOwn(trust.keys,s.keyId)
    && !trust.revokedKeyIds.includes(s.keyId), 'HUB_UNTRUSTED_KEY')
  const payload = Buffer.from(jcs(m))
  requireValue(sha256(payload) === s.payloadDigest, 'HUB_SIGNATURE_INVALID')
  try {
    requireValue(base64(trust.keys[s.keyId]), 'HUB_UNTRUSTED_KEY')
    const key = createPublicKey({key: Buffer.from(trust.keys[s.keyId], 'base64'), format: 'der', type: 'spki'})
    requireValue(key.asymmetricKeyType === 'ed25519' && verify(null,payload,key,Buffer.from(s.signature,'base64')), 'HUB_SIGNATURE_INVALID')
  } catch { throw hubFailure('HUB_SIGNATURE_INVALID') }
  if (hostVersion !== undefined) requireValue(semver.valid(hostVersion) && semver.validRange(m.compatibility.sensteed)
    && semver.satisfies(hostVersion,m.compatibility.sensteed,{includePrerelease:true}), 'HUB_INCOMPATIBLE_HOST')
  return m
}
// Installation-plan digest deliberately uses the platform's sorted JSON contract.
export function planDigest(plan) { const content = {...plan}; delete content.planDigest; return sha256(jcs(content)) }
export function verifyPlan(plan, expected) {
  requireValue(exact(plan,['tenantId','actorRef','deviceId','policyRevision','planId','action','skillId','releaseId','version','artifactDigest','installName','target','requiresReload','expiresAt','planDigest','observedStateDigest']))
  requireValue(UUID.test(plan.planId) && DIGEST.test(plan.planDigest) && planDigest(plan) === plan.planDigest
    && Number.isSafeInteger(plan.policyRevision) && plan.policyRevision > 0 && typeof plan.requiresReload === 'boolean'
    && Number.isFinite(Date.parse(plan.expiresAt)) && Date.parse(plan.expiresAt) > Date.now()
    && exact(plan.target,['kind','hostScopeId']))
  for (const [key,value] of Object.entries(expected)) requireValue(jcs(plan[key]) === jcs(value), 'HUB_PLAN_MISMATCH')
  return plan
}
