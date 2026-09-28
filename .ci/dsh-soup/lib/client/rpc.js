/** 共享有界超时策略：所有浏览器侧 fetch 统一 30s 上限，防止挂起占用会话。 */
export const REQUEST_TIMEOUT_MS = 30000

/** Resolve the host origin the same-origin plugin endpoints live under. */
export function hostBase({ location = globalThis.location } = {}) {
  const origin = location && location.origin
  return origin !== undefined && origin !== 'null' && origin !== '' ? origin : 'http://dsh.internal'
}

/** Browser-side bridge for the host's same-origin JSON RPC endpoint. */
export function createRpc({ translate, location = globalThis.location, fetchImpl = globalThis.fetch }) {
  return function rpc(action, args) {
    return fetchImpl(new URL('/api/dsh-soup', hostBase()), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-soup': '1' },
      body: JSON.stringify({ action, args: args || {} }),
    }).then((response) => response.json().catch(() => ({ ok: false, error: translate('explorer.hostBadResponse') })))
      .catch((error) => ({ ok: false, error: translate('explorer.hostUnreachable', { reason: String(error?.message || error) }) }))
  }
}

if (typeof window !== 'undefined') window.__DSH_SOUP_RPC__ = { createRpc }
