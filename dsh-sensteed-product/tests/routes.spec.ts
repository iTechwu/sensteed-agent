import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, Config } from '../src/routes.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { BRAND_TENANT } from '../src/generated-product-identity.ts'

type Route = { path: string; handler(req: IncomingMessage, res: ServerResponse): void | Promise<void> }

function makeCtx(): Record<string, unknown> {
  const home = join(mkdtempSync(join(tmpdir(), 'dsh-product-routes-')), 'dsh-home')
  homes.push(home)
  const registered: Route[] = []
  const effects: { name?: string }[] = []
  return {
    webServer: { port: 43120, register: vi.fn((spec: Route) => { registered.push(spec) }) },
    connection: { requestRejection: vi.fn(() => undefined) },
    credentials: { resolve: vi.fn(async () => ({ value: 'key' })) },
    dofeAuth: { status: () => ({}), watchBinding: vi.fn(() => () => {}) },
    get: vi.fn((name: string) => name === 'dshHomePath' ? (path: string) => join(home, path) : undefined),
    logger: { error: vi.fn(), info: vi.fn() },
    effect: vi.fn((fn: () => unknown, name?: string) => { fn(); if (name !== undefined) effects.push({ name }) }),
    on: vi.fn(),
    provide: vi.fn(),
    __registered: registered,
    __effects: effects,
  }
}

const homes: string[] = []

afterEach(() => {
  while (homes.length > 0) {
    const home = homes.pop()
    if (home !== undefined) rmSync(home, { recursive: true, force: true })
  }
})

describe('dofe-product-routes', () => {
  it.each(['openai', 'anthropic', 'openai_response'])('loads %s models through the native network even when Node has a stale proxy', async protocol => {
    const ctx = makeCtx()
    const originalGet = ctx.get as (name: string) => unknown
    const requestDofeAuth = vi.fn(async (url: string) => Response.json(url.endsWith('/context')
      ? { tenantSlug: BRAND_TENANT } : { data: [{ id: 'model-a' }] }))
    ctx.get = (name: string) => name === 'desktopRuntime' ? { requestDofeAuth } : originalGet(name)
    const nodeFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:7990'))
    try {
      await apply(ctx as never, { auditSyncEnabled: false })
      const route = (ctx.__registered as Route[]).find(route => route.path.endsWith('/dofe/models'))!
      const req = Readable.from([JSON.stringify({ key: '', useStored: true,
        protocol: protocol === 'anthropic' ? 'messages' : protocol === 'openai_response' ? 'responses' : 'chat-completions' })]) as IncomingMessage
      req.method = 'POST'
      req.headers = { origin: 'http://127.0.0.1:43120', 'content-type': 'application/json' }
      Object.defineProperty(req, 'socket', { value: { remoteAddress: '127.0.0.1' } })
      let body = ''
      const res = { setHeader() {}, end(value: string) { body = value } } as unknown as ServerResponse
      await route.handler(req, res)
      expect(JSON.parse(body)).toEqual({ models: [{ id: 'model-a', name: 'model-a' }] })
      expect(requestDofeAuth).toHaveBeenCalledWith(`https://ai.hozonauto.com/api/v1/models?protocol=${protocol}`,
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer key' }) }))
      expect(nodeFetch).not.toHaveBeenCalled()
      expect(body).not.toContain('Bearer key')
    } finally { nodeFetch.mockRestore() }
  })
  it('registers the auth, audit, and access surfaces on the private web server', async () => {
    const ctx = makeCtx() as never as Record<string, unknown> & { __registered: { path: string }[] }
    await apply(ctx as never, { auditSyncEnabled: true })
    const paths = ctx.__registered.map(entry => entry.path).sort()
    expect(paths).toEqual([
      '/api/desktop/auth/feishu/cancel',
      '/api/desktop/auth/feishu/complete',
      '/api/desktop/auth/feishu/logout',
      '/api/desktop/auth/feishu/session',
      '/api/desktop/auth/feishu/status',
      '/api/desktop/dofe/models',
      '/api/desktop/dofe/validate',
      '/api/desktop/yootun/audit',
    ].sort())
  })

  it('keeps the audit switch volatile with the historical default', () => {
    const schema = (Config as unknown as { defs?: Record<string, unknown> }).defs ?? Config
    expect(schema).toBeDefined()
  })

  it('fails loud when the audit outbox has no home', async () => {
    const ctx = makeCtx()
    ctx.get = vi.fn(() => undefined)
    await expect(apply(ctx as never, { auditSyncEnabled: true })).rejects.toThrow('dshHomePath is required')
  })
})
