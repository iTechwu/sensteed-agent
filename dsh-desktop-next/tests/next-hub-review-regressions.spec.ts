/** Independent adversarial regressions against the real Next integration. */
import { rmSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { NextHubSupervisor } from '../src/hub-integration.ts'
import { signedNextHubFixture } from './next-hub-signed-fixture.ts'

const roots: string[] = [], cleanups: (() => Promise<void>)[] = []
afterEach(async () => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0)) await cleanup(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }

it('bounds the parent renderer barrier so a child timeout cannot strand queued base recovery', async () => {
  const f = await signedNextHubFixture(); roots.push(f.root)
  const renderer = deferred(), entered = deferred()
  const owner = new NextHubSupervisor({ ...f, rendererTimeoutMs: 10, lifecycle: {
    async start(_input, bind) { bind({ fiber: { dispose: async () => {} } }) },
    async waitRendererHealthy() { entered.resolve(); await renderer.promise },
    async inspectHealth() { return { generationId: f.generationId, entryIds: [], skillNames: [] } },
  } })
  cleanups.push(async () => { renderer.resolve(); await owner.dispose() })
  await owner.start(); await owner.request(f.activateRequest); await f.commit()
  let settled = false
  const managed = owner.request(f.managedRequest).finally(() => { settled = true })
  void managed.catch(() => {})
  await entered.promise
  try { await vi.waitFor(() => expect(settled, 'parent must time out independently of the now-disconnected child').toBe(true), { timeout: 2000 }) }
  finally { renderer.resolve(); await managed.catch(() => {}) }
})
