import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { expect, it, vi } from 'vitest'
import { handleHubGenerationIntent, type HubGenerationIntentService } from '../src/hub-generation-routes.ts'

async function endpoint(run: (url: string, origin: string) => Promise<void>, implementation = async (_input: unknown): Promise<unknown> => ({ state: 'STAGED' })) {
  const execute = vi.fn(implementation)
  const service = { check: execute, profiles: execute, telemetry: execute, templates: execute, instantiate: execute, preview: execute, execute, status: execute, restart: execute } satisfies HubGenerationIntentService
  let origin = ''
  const server = createServer((req: IncomingMessage, res: ServerResponse) => { void handleHubGenerationIntent('execute', req, res, origin, service) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing test listener')
  origin = `http://127.0.0.1:${address.port}`
  try { await run(origin, origin) } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  return execute
}
it('passes one private JSON intent without adding renderer identity or grants', async () => {
  const input = { intentId: 'intent', confirmationNonce: 'nonce' }
  const call = await endpoint(async (url, origin) => {
    const response = await fetch(url, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(input) })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ state: 'STAGED' })
  })
  expect(call).toHaveBeenCalledExactlyOnceWith(input)
})
it('rejects cross-origin, non-JSON, oversized and malformed intents before the manager', async () => {
  const call = await endpoint(async (url, origin) => {
    for (const [headers, body, status] of [
      [{ origin: 'https://untrusted.invalid', 'content-type': 'application/json' }, '{}', 403],
      [{ origin, 'content-type': 'text/plain' }, '{}', 403],
      [{ origin, 'content-type': 'application/json' }, 'x'.repeat(65537), 413],
      [{ origin, 'content-type': 'application/json' }, '[1]', 400],
      [{ origin, 'content-type': 'application/json' }, '{', 400],
    ] as const) {
      const response = await fetch(url, { method: 'POST', headers, body })
      expect(response.status).toBe(status)
    }
    expect((await fetch(url)).status).toBe(405)
  })
  expect(call).not.toHaveBeenCalled()
})
it('exposes only stable Host error codes and never credential-bearing errors', async () => {
  for (const [message, expected] of [['HUB_INTENT_EXPIRED', 'HUB_INTENT_EXPIRED'], ['Bearer secret /private/path', 'HUB_INTENT_FAILED']]) {
    await endpoint(async (url, origin) => {
      const response = await fetch(url, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' })
      expect(await response.json()).toEqual({ error: expected })
    }, async () => { throw new Error(message) })
  }
})
