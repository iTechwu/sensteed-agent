import { expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleHubUpdatesRequest } from '../src/hub-update-route.ts'
import { HUB_API_ORIGIN } from '../src/hub-update-contract.ts'

function request(): IncomingMessage {
  const req = Readable.from([]) as IncomingMessage
  req.method = 'GET'
  req.headers = { origin: 'http://127.0.0.1:43120' }
  Object.defineProperty(req, 'socket', { value: { remoteAddress: '127.0.0.1' } })
  return req
}

function response() {
  let body = ''
  const headers = new Map<string, string>()
  return {
    value: { get body() { return body }, headers, setHeader(name: string, value: string) { headers.set(name, value) }, end(value: string) { body = value } } as unknown as ServerResponse,
    body: () => JSON.parse(body) as unknown,
  }
}

it('uses the fixed Hub origin and the SSO session, without a Models key', async () => {
  const fetcher = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const urlText = String(url)
    expect(urlText.startsWith(HUB_API_ORIGIN)).toBe(true)
    expect(init?.headers).toEqual({ Authorization: 'Bearer sso-access', Accept: 'application/json' })
    const plugin = urlText.includes('/plugins?')
    return Response.json({ code: 200, msg: 'ok', data: { items: plugin ? [] : [{ skillId: 'skill-1', displayName: 'Skill One', stableVersion: '1.2.0', status: 'active' }], total: 1 } })
  })
  const result = response()
  await handleHubUpdatesRequest(request(), result.value, 'http://127.0.0.1:43120', {
    getDatasourceSession: () => ({ accessToken: 'sso-access', tenantId: 'tenant', operator: 'user' }),
  }, fetcher)
  expect(result.body()).toEqual({ updates: [{ kind: 'skill', itemId: 'skill-1', displayName: 'Skill One', version: '1.2.0' }] })
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it.each([401, 403])('preserves Hub auth rejection %s and returns no body details', async status => {
  const result = response()
  await handleHubUpdatesRequest(request(), result.value, 'http://127.0.0.1:43120', {
    getDatasourceSession: () => ({ accessToken: 'sso-access', tenantId: 'tenant', operator: 'user' }),
  }, vi.fn(async () => new Response('{}', { status })))
  expect((result.value as unknown as { statusCode?: number }).statusCode).toBe(status)
  expect(result.body()).toEqual({ error: 'hub_auth_required' })
})
