import { createHash, sign } from 'node:crypto'

/** RFC 8785 on the same I-JSON domain accepted by the Hub. */
export function canonicalProofJson(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-JSON number')
    return JSON.stringify(value)
  }
  if (typeof value === 'string') {
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i)
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = value.charCodeAt(++i)
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('Invalid Unicode')
      } else if (c >= 0xdc00 && c <= 0xdfff) throw new Error('Invalid Unicode')
    }
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalProofJson).join(',')}]`
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(k => `${canonicalProofJson(k)}:${canonicalProofJson(value[k])}`).join(',')}}`
  }
  throw new Error('Input must be JSON data')
}

/** CI runner protocol signs SHA-256(JCS(result)), as required by HubTargetProofService. */
export function signHubTargetProofResult(result, privateKey) {
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('runner key must be Ed25519')
  const digest = createHash('sha256').update(canonicalProofJson(result)).digest()
  return sign(null, digest, privateKey).toString('base64')
}
