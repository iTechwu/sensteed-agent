/** Real package-closure audit; no installer or payload is written. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import { collectProductionClosure } from '../scripts/prepare-payload.ts'
import { nextHubBootPlan } from '../src/hub-integration.ts'
import { NEXT_PACKAGE, NextProfiles } from '../src/profiles.ts'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('includes every root package of the real enterprise graph in the actual Next production closure', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-enterprise-closure-')); roots.push(home)
  const profileDirectory = new NextProfiles(home).ensure('desktop')
  const plan = await nextHubBootPlan({ mode: 'enterprise', home, profileDirectory, installAnchor: NEXT_PACKAGE,
    target: { sensteedVersion: '2.0.19-next', harnessVersion: '0.2.1-rc.2', cordisVersion: '4.0.5', os: 'darwin', arch: 'arm64', nodeVersion: '22.19.0', nodeAbi: '127', libc: null, hostCapabilities: [], hostBuildDigest: 'b'.repeat(64) },
    supervisor: { request: async () => {}, waitRendererHealthy: async () => {} } })
  const names = new Set(['dsh-desktop-next', ...collectProductionClosure(dirname(NEXT_PACKAGE)).map(row => row.name)])
  for (const row of composeEntries([plan.patches])) {
    if (typeof row.name !== 'string' || row.name.startsWith('cordis:')) continue
    const parts = row.name.split('/'), name = parts[0]!.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
    expect(names.has(name), `missing runtime root ${name}`).toBe(true)
  }
})
