import { describe, expect, it, vi } from 'vitest'
import { requestDofeAuth } from '../src/dofe-auth-network.ts'

const discovery = 'https://user.hozonauto.com/api/.well-known/openid-configuration'
const token = 'https://user.hozonauto.com/api/oauth/token'

describe('native SSO transport', () => {
  it('refreshes the system route on every attempt so disabling a dead proxy recovers without restart', async () => {
    let configuredProxy = true
    let cachedProxy = true
    const refreshSystemProxy = vi.fn(async () => { cachedProxy = configuredProxy })
    const request = vi.fn(async () => {
      if (cachedProxy) throw new Error('net::ERR_PROXY_CONNECTION_FAILED')
      return new Response('{}')
    })
    const network = { refreshSystemProxy, request }
    await expect(requestDofeAuth(network, discovery, {})).rejects.toThrow('ERR_PROXY_CONNECTION_FAILED')
    configuredProxy = false
    expect((await requestDofeAuth(network, discovery, {})).status).toBe(200)
    expect(refreshSystemProxy).toHaveBeenCalledTimes(2)
  })

  it('preserves token bodies, bearer headers and cancellation while refusing redirects and cookies', async () => {
    const request = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}'))
    const signal = new AbortController().signal
    const body = 'grant_type=refresh_token&refresh_token=fixture'
    await requestDofeAuth({ request }, token, { method: 'POST', body, signal, headers: { accept: 'application/json' }, redirect: 'follow' })
    expect(request).toHaveBeenCalledWith(token, expect.objectContaining({ body, signal, redirect: 'error', credentials: 'omit', cache: 'no-store' }))
    await requestDofeAuth({ request }, 'https://ai.hozonauto.com/api/auth/desktop/provision-key', {
      method: 'POST', headers: { authorization: 'Bearer fixture' },
    })
    expect(request.mock.calls[1]?.[1].headers).toEqual({ authorization: 'Bearer fixture' })
  })

  it.each(['https://other.example/api/oauth/token', token + '?redirect=evil', 'http://127.0.0.1/callback'])('rejects foreign endpoints: %s', async url => {
    const request = vi.fn()
    await expect(requestDofeAuth({ request }, url, { method: 'POST' })).rejects.toThrow('Unsupported')
    expect(request).not.toHaveBeenCalled()
  })

  it('does not send a cancelled request or change an explicit proxy policy', async () => {
    const request = vi.fn(async () => new Response('{}'))
    await expect(requestDofeAuth({ request }, discovery, { signal: AbortSignal.abort() })).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
    await requestDofeAuth({ request }, discovery, {})
    expect(request).toHaveBeenCalledOnce()
  })
})
