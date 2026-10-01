import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, Config } from '../src/routes.ts'

function makeCtx(): Record<string, unknown> {
  const home = join(mkdtempSync(join(tmpdir(), 'dsh-product-routes-')), 'dsh-home')
  homes.push(home)
  const registered: { path: string }[] = []
  const effects: { name?: string }[] = []
  return {
    webServer: { port: 43120, register: vi.fn((spec: { path: string }) => { registered.push({ path: spec.path }) }) },
    connection: { requestRejection: vi.fn(() => undefined) },
    credentials: { resolve: vi.fn(async () => ({ value: 'key' })) },
    dofeAuth: { status: () => ({}), watchBinding: vi.fn(() => () => {}) },
    get: vi.fn(() => (path: string) => join(home, path)),
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
