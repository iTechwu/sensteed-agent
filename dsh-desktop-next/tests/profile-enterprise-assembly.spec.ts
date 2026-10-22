/** Real ordinary graph plus the contract for an explicit, sealed enterprise adapter. */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import { loadNextProfile, NEXT_PACKAGE, NextProfiles, readNextProfilePatches } from '../src/profiles.ts'
import { readHubRuntimeTarget } from '../../dsh-plugin-desktop/src/hub-runtime-target.ts'
import type { HubSyncTarget } from '../../dsh-plugin-desktop/src/hub-sync-verifier.ts'
import { loadNextHubIntegration } from './next-hub-integration-contract.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'profile-next-enterprise-graph-'))
  roots.push(home)
  const manager = new NextProfiles(home)
  return { home, profileDirectory: manager.ensure('desktop'), installAnchor: NEXT_PACKAGE }
}
// Local protocol fixture, never a deployment target or target-proof claim.
const target: HubSyncTarget = { sensteedVersion: '2.0.19-next', harnessVersion: '0.2.1-rc.2', cordisVersion: '4.0.5', os: 'darwin', arch: 'arm64', nodeVersion: '22.19.0', nodeAbi: '127', libc: null, hostCapabilities: [], hostBuildDigest: createHash('sha256').update('unit-test-only-next-base').digest('hex') }
const supervisor = { request: vi.fn(async () => {}), waitRendererHealthy: vi.fn(async () => {}) }

it('retains the actual ordinary Next graph, user composition and official frontend packages', () => {
  const f = fixture()
  writeFileSync(join(f.profileDirectory, 'cordis.patch.yml'), '- insert:\n    - id: ordinary-custom\n      name: user-custom\n')
  const profile = loadNextProfile(f.profileDirectory, f.home)
  const initial = composeEntries([...profile.layers.map(layer => layer.patches), profile.patches])
  const reloaded = composeEntries([readNextProfilePatches(f.profileDirectory, f.home, [])])
  for (const entries of [initial, reloaded]) {
    expect(entries.some(row => row.name === 'dsh-desktop-next')).toBe(true)
    expect(entries.some(row => row.name === 'user-custom')).toBe(true)
    expect(entries.some(row => row.name === '@dofe/dsh-sensteed-product')).toBe(false)
  }
  const manifest = JSON.parse(readFileSync(NEXT_PACKAGE, 'utf8')) as { dependencies: Record<string, string> }
  expect(manifest.dependencies['@deepseek-ai/dsh-client-ui-renderer']).toBe(manifest.dependencies['@deepseek-ai/dsh'])
  expect(manifest.dependencies['@deepseek-ai/dsh-client-ui-layout']).toBe(manifest.dependencies['@deepseek-ai/dsh'])
})

it('keeps ordinary mode on runProfile and requires no enterprise target or supervisor', async () => {
  const { nextHubBootPlan } = await loadNextHubIntegration()
  const f = fixture(), plan = await nextHubBootPlan({ ...f, mode: 'standard' })
  expect(plan.runner).toBe('runProfile')
  expect(composeEntries([[...plan.patches]]).some(row => row.name === '@dofe/dsh-sensteed-product')).toBe(false)
})

it('refuses enterprise mode before boot unless launcher supplies both target and supervisor', async () => {
  const { nextHubBootPlan } = await loadNextHubIntegration()
  const f = fixture()
  await expect(nextHubBootPlan({ ...f, mode: 'enterprise', supervisor })).rejects.toThrow(/TARGET/u)
  await expect(nextHubBootPlan({ ...f, mode: 'enterprise', target })).rejects.toThrow(/SUPERVISOR/u)
})

it('mounts the shared product and Host gates on initial and reloaded sealed enterprise graphs', async () => {
  const { nextHubBootPlan } = await loadNextHubIntegration()
  const f = fixture()
  writeFileSync(join(f.profileDirectory, 'cordis.patch.yml'), '- insert:\n    - id: unsealed-user-carrier\n      name: unsealed-user-plugin\n')
  const plan = await nextHubBootPlan({ ...f, mode: 'enterprise', target, supervisor })
  expect(plan.runner).toBe('sealed')
  for (const [phase, entries] of [['initial', composeEntries([[...plan.patches]])], ['reload', composeEntries([[...await plan.readPatches()]])]] as const) {
    for (const name of ['@dofe/dsh-sensteed-product', '@dofe/dsh-sensteed-product/dofe-host-auth', '@dofe/dsh-sensteed-product/dofe-host-capabilities', 'dsh-desktop-next']) {
      expect(entries.some(row => row.name === name), `${phase}: ${name}`).toBe(true)
    }
    expect(entries.some(row => row.name === 'unsealed-user-plugin')).toBe(false)
  }
})

it('never manufactures a Hub target for a development checkout', async () => {
  expect(await readHubRuntimeTarget({ isPackaged: false, appPath: '/not/a/sealed/app', resourcesPath: '/not/a/sealed/resources', sensteedVersion: '2.0.19-next' })).toBeUndefined()
})
