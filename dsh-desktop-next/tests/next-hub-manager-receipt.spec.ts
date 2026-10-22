/** Exercise the shared real manager/journal path that a Next managed Host must wire. */
import { rmSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '../../dsh-plugin-desktop/src/hub-host-service.ts'
import type { HubReleaseTrust } from '../../dsh-plugin-desktop/src/hub-sync-verifier.ts'
const trusted = vi.hoisted(() => ({ value: undefined as HubReleaseTrust | undefined }))
vi.mock('../../dsh-plugin-desktop/src/hub-release-trust.ts', () => ({ readSealedHubReleaseTrust: () => trusted.value }))
import { registerHubGenerationManager } from '../../dsh-plugin-desktop/src/hub-generation-manager.ts'
import { prepareHubHostBoot } from '../../dsh-plugin-desktop/src/hub-host-boot.ts'
import { hubGenerationBootReference } from '../../dsh-plugin-desktop/src/hub-generation-boot.ts'
import { signedNextHubFixture } from './next-hub-signed-fixture.ts'

const roots: string[] = [], cleanup: (() => unknown)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }

it('writes ACTIVATED only after real loaded health and the Next renderer barrier, then preserves a pending receipt until acknowledged', async () => {
  const f = await signedNextHubFixture(); roots.push(f.root); trusted.value = f.trust
  await f.store.activate(); await f.commit()
  const reference = hubGenerationBootReference(f.store, f.profileDirectory)
  const boot = prepareHubHostBoot({ reference, expectedIdentity: f.identity, skillProviderName: `hub-${reference.generationId}` }, f.profileDirectory, [])
  const renderer = deferred(), receipt = deferred(), requests: { kind: string; body: Record<string, unknown> }[] = []
  let onReady = () => {}, inspected = false
  const client = {
    context: async () => f.context, assertCurrent() {}, bindDevice: async () => f.identity.deviceId,
    watchInvalidation: () => () => {}, watchOfflineDenial: () => () => {},
    offlineOwner: async () => ({ operator: f.identity.actorRef, tenantId: f.identity.tenantId }),
    bootAuthorization: async () => f.lease,
    async generationRequest(_context: unknown, request: { kind: string; body: Record<string, unknown> }) {
      requests.push(request)
      if (request.kind === 'consume-status') return { planId: f.plan.planId, operationId: f.activateRequest.operationId, state: 'consumed', authorized: true, executionGeneration: '1', executionExpiresAt: new Date(Date.now() + 1800000).toISOString(), proposedGenerationDigest: f.plan.proposedGenerationDigest }
      if (request.kind === 'receipt') { await receipt.promise; return { ack: true } }
      throw Error(`unexpected request ${request.kind}`)
    },
  }
  const requestsToSupervisor: unknown[] = []
  const scope = {
    hubHostClient: client, skills: { list: async () => [] },
    hubGenerationBoot: { async inspectLoaded(skills: Parameters<typeof boot.inspectLoaded>[1], provider: string) { inspected = true; return await boot.inspectLoaded({ entries: () => [] }, skills, provider) } },
    hubGenerationSupervisor: { async request(input: unknown) { requestsToSupervisor.push(input) }, async waitRendererHealthy(id: string) { expect(id).toBe(f.generationId); await renderer.promise } },
    get: () => undefined,
    provide() {},
    effect(fn: () => () => unknown) { cleanup.push(fn()) },
    inject(_keys: string[], run: (value: unknown) => void) { run({ appReady: { onReady(fn: () => void) { onReady = fn } } }) },
    logger: () => ({ warn: vi.fn() }),
  }
  registerHubGenerationManager({ inject(_keys: string[], run: (value: unknown) => void) { run(scope) } } as never,
    { target: f.target, userData: f.userData, profileDirectory: f.profileDirectory, managed: true })
  onReady()
  await vi.waitFor(() => expect(inspected).toBe(true))
  expect(f.journal.read()?.phase).toBe('COMMITTED')
  expect(requests.some(request => request.kind === 'receipt')).toBe(false)
  renderer.resolve()
  await vi.waitFor(() => expect(requests.some(request => request.kind === 'receipt')).toBe(true))
  expect(f.journal.read()?.phase).toBe('ACTIVATED')
  expect(f.journal.read()?.pendingReceipt?.phase).toBe('ACTIVATED')
  expect(requests.find(request => request.kind === 'receipt')?.body).toMatchObject({ operationId: f.activateRequest.operationId, generationDigest: f.plan.proposedGenerationDigest, phase: 'ACTIVATED' })
  receipt.resolve()
  await vi.waitFor(() => expect(f.journal.readHealthyInventory()?.phase).toBe('ACTIVATED'))
  expect(f.journal.read()?.pendingReceipt).toBeNull()
  expect(requestsToSupervisor).toEqual([])
})
