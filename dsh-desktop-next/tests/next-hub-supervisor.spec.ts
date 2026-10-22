import { rmSync } from 'node:fs'
import { afterEach, expect, it } from 'vitest'
import { prepareHubHostBoot } from '../../dsh-plugin-desktop/src/hub-host-boot.ts'
import type { HubLoadedEvidence } from '../../dsh-plugin-desktop/src/hub-generation-health.ts'
import { signedNextHubFixture } from './next-hub-signed-fixture.ts'
import { loadNextHubIntegration, type NextHubSupervisorContract, type NextHubSupervisorOptions } from './next-hub-integration-contract.ts'

const roots: string[] = [], owners: NextHubSupervisorContract[] = []
afterEach(async () => { for (const owner of owners.splice(0)) await owner.dispose().catch(() => {}); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
async function fixture() { const f = await signedNextHubFixture(); roots.push(f.root); return f }

it('boots base, activates the real staged pointer, then boots authorized managed content and can return to base', async () => {
  const { NextHubSupervisor } = await loadNextHubIntegration(), f = await fixture(), events: string[] = []
  let health: HubLoadedEvidence = { generationId: f.generationId, entryIds: [], skillNames: [] }
  const lifecycle: NextHubSupervisorOptions['lifecycle'] = {
    async start(input, bind) {
      const label = input ? 'managed' : 'base'
      events.push(`start:${label}`)
      bind({ fiber: { dispose: async () => { events.push(`stop:${label}`) } } })
      if (input) {
        // Exercise the real descriptor, logical Profile and verified composition path.
        const boot = prepareHubHostBoot(input, f.profileDirectory, [{ insert: [{ id: 'next', name: 'dsh-desktop-next' }] }])
        expect(boot.generationId).toBe(f.generationId)
        health = await boot.inspectLoaded({ entries: () => [] }, { list: async () => [] }, `hub-${f.generationId}`)
      }
    },
    async inspectHealth() { events.push('inspect'); return health },
    async waitRendererHealthy(id) { expect(id).toBe(f.generationId); events.push('renderer-healthy') },
  }
  const owner = new NextHubSupervisor({ ...f, lifecycle }); owners.push(owner)
  await owner.start()
  expect(events).toEqual(['start:base'])
  await owner.request(f.activateRequest)
  expect(f.store.readState().phase).toBe('verifying')
  await f.commit()
  await owner.request(f.managedRequest)
  expect(events).toContain('start:managed')
  expect(events).toContain('renderer-healthy')
  // Child readiness never writes a successful receipt; the shared Host manager owns it.
  expect(f.journal.read()?.phase).toBe('COMMITTED')
  expect(f.journal.read()?.pendingReceipt).toBeNull()
  await owner.request({ kind: 'base' })
  expect(events.slice(-2)).toEqual(['stop:managed', 'start:base'])
})

it('does not mutate the staged pointer or start another child when the old child cannot stop', async () => {
  const { NextHubSupervisor } = await loadNextHubIntegration(), f = await fixture()
  let starts = 0, rejectStop = true
  const owner = new NextHubSupervisor({ ...f, lifecycle: {
    async start(_input, bind) { starts++; bind({ fiber: { dispose: async () => { if (rejectStop) throw Error('old child still owns Profile') } } }) },
    async inspectHealth() { return { generationId: f.generationId, entryIds: [], skillNames: [] } }, async waitRendererHealthy() {},
  } }); owners.push(owner)
  await owner.start()
  await expect(owner.request(f.activateRequest)).rejects.toThrow('old child still owns Profile')
  expect(starts).toBe(1)
  expect(f.store.readState().phase).toBe('prepared')
  expect(f.store.readState().active).toBeNull()
  rejectStop = false
})

it('rejects a wrong-target boot lease before stopping the current child', async () => {
  const { NextHubSupervisor } = await loadNextHubIntegration(), f = await fixture(), events: string[] = []
  const owner = new NextHubSupervisor({ ...f, lifecycle: {
    async start(_input, bind) { events.push('start'); bind({ fiber: { dispose: async () => { events.push('stop') } } }) },
    async inspectHealth() { return { generationId: f.generationId, entryIds: [], skillNames: [] } }, async waitRendererHealthy() {},
  } }); owners.push(owner)
  await owner.start(); await owner.request(f.activateRequest); await f.commit()
  const before = [...events]
  const lease = { ...f.lease, authorization: { ...f.lease.authorization, target: { ...f.target, nodeAbi: '999' } } }
  await expect(owner.request({ ...f.managedRequest, lease })).rejects.toThrow()
  expect(events).toEqual(before)
})

it('keeps the generation unconfirmed until renderer health arrives and rolls back after managed startup failure', async () => {
  const { NextHubSupervisor } = await loadNextHubIntegration(), f = await fixture(), renderer = deferred(), events: string[] = []
  let failManaged = false
  const owner = new NextHubSupervisor({ ...f, lifecycle: {
    async start(input, bind) {
      const label = input ? 'managed' : 'base'; events.push(`start:${label}`)
      bind({ fiber: { dispose: async () => { events.push(`stop:${label}`) } } })
      if (input && failManaged) throw Error('managed startup failed')
    },
    async inspectHealth() { return { generationId: f.generationId, entryIds: [], skillNames: [] } },
    async waitRendererHealthy() { await renderer.promise },
  } }); owners.push(owner)
  await owner.start(); await owner.request(f.activateRequest); await f.commit()
  let completed = false
  const opening = owner.request(f.managedRequest).then(() => { completed = true })
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(completed).toBe(false)
  expect(f.journal.read()?.phase).toBe('COMMITTED')
  renderer.resolve(); await opening
  await owner.request({ kind: 'base' })
  failManaged = true
  await expect(owner.request(f.managedRequest)).rejects.toThrow('managed startup failed')
  expect(f.store.readState().active).toBeNull()
  expect(events.slice(-2)).toEqual(['stop:managed', 'start:base'])
  expect(f.journal.read()?.phase).not.toBe('ACTIVATED')
})
