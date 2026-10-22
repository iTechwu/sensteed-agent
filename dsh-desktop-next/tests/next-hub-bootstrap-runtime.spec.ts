/** Verify launcher capabilities available before the enterprise product tree mounts. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
const captured = vi.hoisted(() => ({ services: new Map<string, unknown>() }))
vi.mock('@deepseek-ai/dsh-app-boot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@deepseek-ai/dsh-app-boot')>()),
  async boot(
    _name: string,
    _root: string,
    _patches: unknown,
    prepare: (ctx: unknown) => Promise<void>,
  ) {
    const host = {
      loader: {},
      provide(name: string, value: unknown) {
        captured.services.set(name, value)
      },
      inject() {},
      plugin: async () => {},
      effect() {},
      fiber: { dispose: async () => {} },
    }
    await prepare(host)
    return host
  },
}))
vi.mock('@deepseek-ai/dsh-http-proxy', () => ({
  installProxyFromEnvironment: async () => async () => {},
}))
vi.mock('../../dsh-plugin-desktop/src/module-resolution.ts', () => ({
  installProfilePackageResolver: () => () => {},
  selectProfilePackage: () => undefined,
  refreshProfilePackageSelections() {},
  managedProfilePackageUrls: () => [],
}))
vi.mock('../../dsh-plugin-desktop/src/hub-skill-roots.ts', () => ({
  registerHubBootstrapSkillRoots() {},
  registerHubSkillRoots() {},
}))
import { runNextEnterpriseProfile } from '../src/host/hub-boot.ts'
import { loadNextProfile, NEXT_PACKAGE, NextProfiles } from '../src/profiles.ts'

const roots: string[] = []
afterEach(() => {
  captured.services.clear()
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

it('provides the enterprise product with native SSO and mandatory-update launcher capabilities before plugins mount', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-hub-launcher-gate-'))
  roots.push(home)
  const directory = new NextProfiles(home).ensure('desktop'),
    profile = loadNextProfile(directory, home)
  const application = await runNextEnterpriseProfile(
    {
      environment: {} as never,
      profile: 'desktop',
      resolvedProfile: { profile, installAnchor: NEXT_PACKAGE },
      patchFiles: [],
      args: [],
    },
    home,
    {
      target: {
        sensteedVersion: '2.0.19-next',
        harnessVersion: '0.2.1-rc.2',
        cordisVersion: '4.0.5',
        os: 'darwin',
        arch: 'arm64',
        nodeVersion: '22.19.0',
        nodeAbi: '127',
        libc: null,
        hostCapabilities: [],
        hostBuildDigest: 'b'.repeat(64),
      },
      userData: home,
    },
    { request: async () => {}, waitRendererHealthy: async () => {} },
    { openExternal: async () => {}, reportPolicy() {} },
  )
  try {
    expect(
      captured.services.get('desktopRuntime'),
      'SSO openExternal and mandatory-policy currently require desktopRuntime',
    ).toEqual(
      expect.objectContaining({
        openExternal: expect.any(Function),
        reportMandatoryUpdatePolicy: expect.any(Function),
        updates: expect.objectContaining({ releaseChannel: 'next' }),
      }),
    )
  } finally {
    await application.shutdown.shutdown(0)
  }
})
