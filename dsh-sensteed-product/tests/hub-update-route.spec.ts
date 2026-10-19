import { expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleHubUpdatesRequest } from '../src/hub-update-route.ts'

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

it('retires catalog-based update claims without reading credentials or contacting Hub', async () => {
  const auth = { getDatasourceSession: vi.fn(() => ({ accessToken: 'sso-access', tenantId: 'tenant', operator: 'user' })) }
  const fetcher = vi.fn(async () => Response.json({}))
  const result = response()
  await handleHubUpdatesRequest(request(), result.value, 'http://127.0.0.1:43120', auth, fetcher)
  expect(result.value.statusCode).toBe(410)
  expect(result.body()).toEqual({ error: 'hub_signed_check_required' })
  expect(auth.getDatasourceSession).not.toHaveBeenCalled()
  expect(fetcher).not.toHaveBeenCalled()
})

it('keeps the same-origin guard on the retired endpoint', async () => {
  const req = request(); req.headers.origin = 'https://untrusted.example'
  const result = response()
  await handleHubUpdatesRequest(req, result.value, 'http://127.0.0.1:43120', { getDatasourceSession: () => undefined })
  expect(result.value.statusCode).toBe(403)
})
