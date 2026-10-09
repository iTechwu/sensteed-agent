/** Login and model setup follow current system proxy/PAC rules, not a boot snapshot. */
const AUTH_ENDPOINTS = new Map([
  ['https://user.hozonauto.com/api/.well-known/openid-configuration', 'GET'],
  ['https://user.hozonauto.com/api/oauth/token', 'POST'],
  ['https://user.hozonauto.com/api/oauth/userinfo', 'GET'],
  ['https://ai.hozonauto.com/api/auth/desktop/provision-key', 'POST'],
  ['https://ai.hozonauto.com/api/internal/auth/context', 'GET'],
  ['https://ai.hozonauto.com/api/v1/models?protocol=openai', 'GET'],
  ['https://ai.hozonauto.com/api/v1/models?protocol=anthropic', 'GET'],
  ['https://ai.hozonauto.com/api/v1/models?protocol=openai_response', 'GET'],
])

export interface DofeAuthNetwork {
  request(url: string, init: RequestInit): Promise<Response>
  /** Absent for an explicitly configured environment proxy, which retains its own policy. */
  refreshSystemProxy?: () => Promise<void>
}

/** Only fixed login and setup endpoints may carry credentials over this private bridge. */
export async function requestDofeAuth(network: DofeAuthNetwork, url: string, init: RequestInit): Promise<Response> {
  if (AUTH_ENDPOINTS.get(url) !== (init.method ?? 'GET').toUpperCase()) {
    throw new Error('Unsupported desktop authentication endpoint or method')
  }
  init.signal?.throwIfAborted()
  await network.refreshSystemProxy?.()
  init.signal?.throwIfAborted()
  return network.request(url, { ...init, redirect: 'error', credentials: 'omit', cache: 'no-store' })
}
