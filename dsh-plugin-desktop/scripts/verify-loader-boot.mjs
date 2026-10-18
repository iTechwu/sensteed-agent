/** Headless artifact smoke for profile-local and launcher-owned Cordis plugins. */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot } from '@deepseek-ai/dsh-app-boot'
import {
  createLaunchEnvironmentSnapshot,
  DSH_LAUNCH_ENVIRONMENT_KEY,
} from '@deepseek-ai/dsh-launch-environment'
import { installDesktopPnpmRuntime } from '../lib/desktop-runtime-environment.js'
import { installProfilePackageResolver } from '../lib/module-resolution.js'
import { prepareDesktopProfile } from '../lib/profile.js'

const BIN_NAME = 'dsh-plugin-desktop-loader-smoke'
const THIRD_PARTY_NAME = 'sensteed-agent-loader-smoke-plugin'
const THIRD_PARTY_DEPENDENCY_NAME = 'sensteed-agent-loader-smoke-dependency'
const PRODUCT_VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version
const AUTHENTICATION_TOKEN = Buffer.alloc(32, 3).toString('base64url')
let ordinaryBrowserEnabled = false
const BROWSER_ACCESS = Object.freeze({
  get ordinaryBrowserEnabled() { return ordinaryBrowserEnabled },
  rendererHeader: Object.freeze({
    name: 'x-sensteed-agent-renderer',
    value: AUTHENTICATION_TOKEN,
  }),
  authenticatedUrl(baseUrl) {
    const url = new URL(baseUrl)
    url.pathname = '/'
    url.search = ''
    url.searchParams.set('token', AUTHENTICATION_TOKEN)
    return url.href
  },
  setOrdinaryBrowserEnabled(enabled) { ordinaryBrowserEnabled = enabled },
})
const LAN_HTTPS_SNAPSHOT = Object.freeze({
  state: 'inactive',
  actualPort: null,
  addresses: Object.freeze([]),
  caFingerprint: null,
  errorCode: null,
})
const LAN_HTTPS = Object.freeze({
  caCertificate: null,
  attach() {},
  snapshot() { return LAN_HTTPS_SNAPSHOT },
  async setEnabled() { return LAN_HTTPS_SNAPSHOT },
  async stop() { return LAN_HTTPS_SNAPSHOT },
})
const RUNNER_ENVIRONMENT_NAMES = new Set([
  'ELECTRON_RUN_AS_NODE',
  'NPM_CONFIG_RUNTIME',
  'NPM_CONFIG_TARGET',
  'NPM_CONFIG_DISTURL',
])
const home = mkdtempSync(join(tmpdir(), 'sensteed-agent-loader-'))
let ctx
let mounted
let mountedSpec
let releasePackageResolver
let pnpmRuntime
const originalFetch = globalThis.fetch
let authNetworkAttempts = 0
const runnerEnvironment = Object.entries(process.env)
  .filter(([key]) => RUNNER_ENVIRONMENT_NAMES.has(key.toUpperCase()))

try {
  globalThis.fetch = async () => { throw new Error('Loader smoke forbids outbound network') }
  for (const [key] of runnerEnvironment) delete process.env[key]
  const launchEnvironment = createLaunchEnvironmentSnapshot([{
    source: 'process',
    values: { ...(process.env.PATH === undefined ? {} : { PATH: process.env.PATH }) },
  }])
  const launchPath = launchEnvironment.get('PATH')?.value
  const packageRoot = new URL('../', import.meta.url)
  const pnpmBinPath = fileURLToPath(new URL('node_modules/pnpm/bin/pnpm.mjs', packageRoot))
  const electronVersion = JSON.parse(readFileSync(new URL('node_modules/electron/package.json', packageRoot), 'utf8')).version
  pnpmRuntime = installDesktopPnpmRuntime({
    platform: process.platform,
    appExecutable: process.execPath,
    pnpmBinPath,
    electronVersion,
    stateDir: join(home, 'runtime-commands'),
    environment: process.env,
  })
  const prepared = prepareDesktopProfile(undefined, home)
  const thirdPartyLink = join(prepared.profile.dir, 'node_modules', THIRD_PARTY_NAME)
  const thirdPartyDir = join(home, 'linked-plugins', THIRD_PARTY_NAME)
  const thirdPartyDependencyDir = join(
    prepared.profile.dir,
    'node_modules',
    THIRD_PARTY_DEPENDENCY_NAME,
  )
  mkdirSync(join(prepared.profile.dir, 'node_modules'), { recursive: true })
  mkdirSync(thirdPartyDir, { recursive: true })
  mkdirSync(thirdPartyDependencyDir, { recursive: true })
  writeFileSync(join(thirdPartyDependencyDir, 'package.json'), JSON.stringify({
    name: THIRD_PARTY_DEPENDENCY_NAME,
    version: '0.0.0',
    type: 'module',
    exports: './index.js',
  }) + '\n')
  writeFileSync(join(thirdPartyDependencyDir, 'index.js'), 'export const marker = "profile dependency"\n')
  writeFileSync(join(thirdPartyDir, 'package.json'), JSON.stringify({
    name: THIRD_PARTY_NAME,
    version: '0.0.0',
    type: 'module',
    exports: './index.js',
    dependencies: { [THIRD_PARTY_DEPENDENCY_NAME]: '0.0.0' },
  }) + '\n')
  writeFileSync(join(thirdPartyDir, 'index.js'), [
    "import { delimiter } from 'node:path'",
    `import { marker } from '${THIRD_PARTY_DEPENDENCY_NAME}'`,
    'export function apply(ctx) {',
    "  if (marker !== 'profile dependency') throw new Error('linked plugin did not resolve its profile dependency')",
    `  const expected = ${JSON.stringify(pnpmRuntime.pathDir)}`,
    '  const actual = (process.env.PATH ?? \'\').split(delimiter)[0]',
    '  if (actual !== expected) throw new Error(`third-party plugin received ${actual} instead of packaged pnpm PATH ${expected}`)',
    "  const launchPath = ctx.launchEnvironment?.get('PATH')?.value",
    `  if (launchPath !== ${JSON.stringify(launchPath)}) throw new Error('third-party plugin received a mutated launch-environment PATH snapshot')`,
    `  const runnerNames = new Set(${JSON.stringify([...RUNNER_ENVIRONMENT_NAMES])})`,
    "  const leaked = Object.keys(process.env).filter(key => runnerNames.has(key.toUpperCase()))",
    "  if (leaked.length > 0) throw new Error(`third-party plugin received runner-only environment: ${leaked.join(', ')}`)",
    '}',
    '',
  ].join('\n'))
  symlinkSync(thirdPartyDir, thirdPartyLink, 'junction')
  releasePackageResolver = installProfilePackageResolver(prepared.bareModuleBaseUrl)
  const profileRequire = createRequire(prepared.bareModuleBaseUrl)
  const desktopManifest = fileURLToPath(new URL('../package.json', import.meta.url))
  if (profileRequire.resolve('dsh-plugin-desktop/package.json') !== desktopManifest) {
    throw new Error('desktop package manifest did not resolve from the installed launcher')
  }
  const profileDirectoryRequire = createRequire(new URL('.', prepared.bareModuleBaseUrl))
  if (profileDirectoryRequire.resolve('dsh-plugin-desktop/package.json') !== desktopManifest) {
    throw new Error('desktop package manifest did not resolve from the profile directory')
  }

  const runtime = {
    platform: 'darwin',
    async requestDofeAuth() { authNetworkAttempts++; throw new Error('Empty-session auth must not request network') },
    updates: { currentVersion: PRODUCT_VERSION },
    schedule(spec) {
      mountedSpec = spec
      return async () => { await mounted }
    },
    mountScheduled() {
      if (mountedSpec === undefined) return Promise.reject(new Error('desktop shell was not registered'))
      mounted ??= Promise.resolve()
      return mounted
    },
    show() {},
    async requestRestart() {},
    prepareToQuit() {},
    // dofe-managed registers its launcher entry through the native tray.
    registerTrayItem() { return { refresh() {}, dispose() {} } },
  }
  ctx = await boot(
    BIN_NAME,
    prepared.rootConfig,
    [{ insert: [
      { id: 'smoke-credentials', name: '@deepseek-ai/dsh-credentials-local', config: { path: join(home, '.credentials.yaml'), watch: false } },
      { id: 'smoke-config-editor', name: '@deepseek-ai/dsh-config-editor' },
      { id: 'smoke-settings', name: '@deepseek-ai/dsh-settings' },
      // Identity belongs to the actual L0 service, independently from business composition.
      { id: 'dofe-host-auth', name: '@dofe/dsh-sensteed-product/dofe-host-auth' },
      { id: 'dofe-host-capabilities', name: '@dofe/dsh-sensteed-product/dofe-host-capabilities' },
      { id: 'dofe-managed', name: '@dofe/dsh-sensteed-product/dofe-managed' },
      { id: 'desktop-shell', name: 'dsh-plugin-desktop' },
      { id: 'community-market', name: 'dsh-community-market' },
      { id: 'dsh-market', name: 'dshmarket' },
      { id: 'third-party-smoke', name: THIRD_PARTY_NAME },
    ] }],
    (host) => {
      // Packaged Electron does not expose Node's internal ESM loader.
      host.loader.internal = undefined
      host.set('dshHomePath', (...segments) => join(home, ...segments))
      host.provide('profileContext', { name: prepared.profile.name, dir: prepared.profile.dir,
        patchPath: join(prepared.profile.dir, 'cordis.patch.yml'), installAnchor: desktopManifest,
        cwd: home, home, startedBundles: [], overlays: [], telemetryDisabledEnv: '1', readPatches: () => [] })
      host.provide(DSH_LAUNCH_ENVIRONMENT_KEY, launchEnvironment)
      host.provide('desktopBrowserAccess', BROWSER_ACCESS)
      host.provide('desktopLanHttps', LAN_HTTPS)
      host.provide('desktopRuntime', runtime)
      host.provide('webServer', {
        host: '127.0.0.1',
        port: 43120,
        register() { return () => {} },
      })
      host.provide('connection', {
        authenticatedUrl(baseUrl) {
          const url = new URL(baseUrl)
          url.pathname = '/'
          url.search = ''
          url.searchParams.set('token', AUTHENTICATION_TOKEN)
          return url.href
        },
        requestRejection() { return undefined },
      })
      host.provide('webStartup', {})
      host.provide('appExit', () => {})
      // dofe-managed publishes its workflow guidance through this seam.
      host.provide('systemPrompt', { section() {} })
      // The production shell waits for these host services before activation.
      // Keep the loader smoke fixture aligned with the desktop plugin contract.
      host.provide('tools', {
        schemas() { return [] },
        execute() { throw new Error('tools smoke execution is not expected') },
      })
    },
    prepared.bareModuleBaseUrl,
  )
  await runtime.mountScheduled()

  const required = {
    'smoke-credentials': '@deepseek-ai/dsh-credentials-local',
    'smoke-config-editor': '@deepseek-ai/dsh-config-editor',
    'smoke-settings': '@deepseek-ai/dsh-settings',
    'dofe-host-auth': '@dofe/dsh-sensteed-product/dofe-host-auth',
    'dofe-host-capabilities': '@dofe/dsh-sensteed-product/dofe-host-capabilities',
    'dofe-managed': '@dofe/dsh-sensteed-product/dofe-managed',
    'desktop-shell': 'dsh-plugin-desktop',
    'community-market': 'dsh-community-market',
    'dsh-market': 'dshmarket',
    'third-party-smoke': THIRD_PARTY_NAME,
  }
  for (const [id, name] of Object.entries(required)) {
    const entry = ctx.loader.resolve(`include:${id}`)
    if (entry?.options.name !== name || entry.disabled || entry.fiber?.state !== 2) {
      throw new Error(`Required loader smoke entry is not active: ${id} (state ${String(entry?.fiber?.state)})`)
    }
  }
  if (authNetworkAttempts !== 0) throw new Error('Empty-session auth attempted outbound network')
  if (ctx.dofeAuth.getStatus().status !== 'idle') throw new Error('Private empty-session auth did not remain idle')
  if (mountedSpec?.mode !== 'compatibility') {
    throw new Error(`desktop plugin produced an unexpected shell mode: ${String(mountedSpec?.mode)}`)
  }
  const expectedUrl = `http://127.0.0.1:43120/?sensteed-agent-mode=compatibility&sensteed-agent-platform=darwin&sensteed-agent-version=${PRODUCT_VERSION}&sensteed-agent-material=transparent&sensteed-agent-titlebar-inset=36`
  if (mountedSpec?.url !== expectedUrl) {
    throw new Error(`desktop plugin produced an unexpected renderer URL: ${String(mountedSpec?.url)}`)
  }
  const expectedAuthenticationUrl = `http://127.0.0.1:43120/?token=${AUTHENTICATION_TOKEN}`
  if (mountedSpec?.authenticationUrl !== expectedAuthenticationUrl) {
    throw new Error(
      `desktop plugin produced an unexpected authentication URL: ${String(mountedSpec?.authenticationUrl)}`,
    )
  }
  if (mountedSpec?.rendererAccessHeader !== BROWSER_ACCESS.rendererHeader) {
    throw new Error('desktop plugin did not preserve the launcher browser capability')
  }
} finally {
  try {
    await ctx?.fiber.dispose()
  } finally {
    try {
      releasePackageResolver?.()
    } finally {
      try {
        pnpmRuntime?.dispose()
      } finally {
        for (const key of Object.keys(process.env)) {
          if (RUNNER_ENVIRONMENT_NAMES.has(key.toUpperCase())) {
            delete process.env[key]
          }
        }
        for (const [key, value] of runnerEnvironment) process.env[key] = value
        globalThis.fetch = originalFetch
        rmSync(home, { recursive: true, force: true })
      }
    }
  }
}
