import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, verify } from 'node:crypto'
import { test } from 'node:test'
import { canonicalProofJson, signHubTargetProofResult } from './hub-target-proof-signature.mjs'

test('CI signatures verify over the Hub protocol digest, independent of input property order', () => {
  const keys = generateKeyPairSync('ed25519')
  const result = { status: 'PASS', checks: { realHostLoader: true, negativeControls: true }, runId: 'example' }
  const canonical = '{"checks":{"negativeControls":true,"realHostLoader":true},"runId":"example","status":"PASS"}'
  assert.equal(canonicalProofJson(result), canonical)
  const signature = Buffer.from(signHubTargetProofResult(result, keys.privateKey), 'base64')
  assert.equal(verify(null, createHash('sha256').update(canonical).digest(), keys.publicKey, signature), true)
  assert.equal(verify(null, Buffer.from(canonical), keys.publicKey, signature), false)
})

test('changed proof content or another runner key cannot verify', () => {
  const keys = generateKeyPairSync('ed25519'), other = generateKeyPairSync('ed25519')
  const result = { checks: { realHostLoader: true }, status: 'PASS' }
  const signature = Buffer.from(signHubTargetProofResult(result, keys.privateKey), 'base64')
  const changed = createHash('sha256').update(canonicalProofJson({ ...result, status: 'FAIL' })).digest()
  assert.equal(verify(null, changed, keys.publicKey, signature), false)
  const digest = createHash('sha256').update(canonicalProofJson(result)).digest()
  assert.equal(verify(null, digest, other.publicKey, signature), false)
})

test('non-Ed25519 runner keys are refused', () => {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  assert.throws(() => signHubTargetProofResult({ status: 'PASS' }, keys.privateKey), /Ed25519/)
})

test('canonical proof JSON preserves numeric object key ordering and rejects non-I-JSON inputs', () => {
  assert.equal(canonicalProofJson({ 2: 'two', 10: 'ten', nested: [null, -0, 1e30, '中文😀'] }),
    '{"10":"ten","2":"two","nested":[null,0,1e+30,"中文😀"]}')
  for (const invalid of [NaN, Infinity, undefined, { invalid: undefined }, '\ud800', new Date()]) {
    assert.throws(() => canonicalProofJson(invalid))
  }
})
