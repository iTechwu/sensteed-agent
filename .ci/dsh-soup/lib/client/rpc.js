/** Resolve the host origin the same-origin plugin endpoints live under. */
export function hostBase({ location = globalThis.location } = {}) {
  const origin = location && location.origin
  return origin !== undefined && origin !== 'null' && origin !== '' ? origin : 'http://dsh.internal'
}

/** Browser-side bridge for the host's same-origin JSON RPC endpoint. */
export var REQUEST_TIMEOUT_MS = 30000
export function createRpc({ translate, location = globalThis.location, fetch = globalThis.fetch }) {
  return function rpc(action, args) {
    return fetch(new URL('/api/dsh-soup', hostBase()), {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      headers: { 'content-type': 'application/json', 'x-dsh-soup': '1' },
      body: JSON.stringify({ action, args: args || {} }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).then((response) => response.json().catch(() => ({ ok: false, error: translate('explorer.hostBadResponse') })))
      .catch((error) => ({ ok: false, error: translate('explorer.hostUnreachable', { reason: String(error?.message || error) }) }))
  }
}

if (typeof window !== 'undefined') window.__DSH_SOUP_RPC__ = { createRpc }
