import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { expect, it, vi } from 'vitest'
import { rendererBootReport } from '../src/client/boot-health.ts'
import { DesktopRendererHealthGate } from '../src/renderer-health.ts'
import { HubRendererHealth } from '../src/hub-renderer-health.ts'
import { HubGenerationStore, HUB_GENERATION_ORIGIN } from '../src/hub-generation-store.ts'

it('a real Client Loader apply failure preserves the previous healthy pointer after a valid Host boot', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hub-renderer-rollback-')))
  const host = new Context(), client = new Context()
  try {
    const identity = { origin: HUB_GENERATION_ORIGIN, tenantId: '11111111-1111-4111-8111-111111111111', actorRef: 'actor', deviceId: '22222222-2222-4222-8222-222222222222', profileId: '33333333-3333-4333-8333-333333333333' }
    const store = new HubGenerationStore(root, identity)
    for (const generationId of ['healthy', 'candidate']) {
      const gen = store.generationDirectory(generationId)
      mkdirSync(join(gen, 'skills'), { recursive: true, mode: 0o700 })
      const text = generationId
      writeFileSync(join(gen, 'payload.txt'), text, { mode: 0o600 })
      await store.prepare({ schemaVersion: 2, identity, generationId, packages: [], skillsRoot: 'skills', files: { 'payload.txt': createHash('sha256').update(text).digest('hex') }, verifiedComposition: { entries: [], skills: [] } })
      await store.activate()
      if (generationId === 'healthy') await store.markHealthy(generationId)
    }
    expect(store.readState()).toMatchObject({ phase: 'verifying', active: { generationId: 'candidate' }, previous: { generationId: 'healthy' } })
    await host.plugin(Loader)
    host.loader.builtins.validHost = () => {}
    await host.loader.create({ name: 'cordis:validHost' })
    expect([...host.loader.entries()][0]?.fiber?.state).toBe(2)
    await client.plugin(Loader)
    client.loader.builtins.throwingClient = () => { throw new Error('new Client apply failure') }
    await client.loader.create({ name: 'cordis:throwingClient' })
    expect([...client.loader.entries()][0]?.fiber?.state).toBe(3)
    const receipt = new HubRendererHealth(); receipt.begin('candidate')
    const commit = vi.fn(async () => { receipt.healthy('candidate'); await store.markHealthy('candidate') })
    const gate = new DesktopRendererHealthGate({ commitHealthy: commit })
    const verdict = gate.begin(1_000)
    gate.acceptNativeMount()
    gate.report(await rendererBootReport(client.loader))
    expect(await verdict).toMatchObject({ failureReason: 'renderer-failed' })
    expect(commit).not.toHaveBeenCalled()
    receipt.fail(new Error('new Client failed'))
    await expect(receipt.wait('candidate')).rejects.toThrow('does not match')
    await store.rollback()
    expect(store.readState()).toMatchObject({ phase: 'stable', active: { generationId: 'healthy' }, previous: null })
  } finally {
    await client.fiber.dispose(); await host.fiber.dispose(); rmSync(root, { recursive: true, force: true })
  }
})
