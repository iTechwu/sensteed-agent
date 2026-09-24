import { execSync, fork, type Serializable } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { prepareDesktopProfile } from '../src/profile.ts'
import { desktopReleaseUserDataLocations } from '../src/profile-channel-admission.ts'
import { installDesktopPnpmRuntime } from '../src/desktop-runtime-environment.ts'
import { HostRpc } from '../src/host-rpc.ts'
import { bindNativeRuntime, runtimeSnapshot } from '../src/host-runtime-bridge.ts'
import type { DesktopRuntime, DesktopShellSpec } from '../src/runtime.ts'

/** Diagnostic-only: list every process holding a TCP listener on one port. */
function portListeners(port: string | number): string {
  const out = execSync(`lsof -nP -iTCP:${String(port)} -sTCP:LISTEN || true`, { encoding: 'utf8' })
  return out.trim() === '' ? `(nothing listening on ${String(port)})` : out.trim()
}

it.each(['disabled', 'missing', 'installed'] as const)('boots a separate Web Host with client plugins (AA provider: %s)', async aaProvider => {
  const aaRequested = aaProvider !== 'disabled'
  const aaEnabled = aaProvider === 'installed'
  const home = mkdtempSync(join(tmpdir(), 'dsh-isolated-host-'))
  const token = Buffer.alloc(32, 7).toString('base64url')
  let child: ReturnType<typeof fork> | undefined
  let rpc: HostRpc | undefined
  let releaseNative: (() => Promise<void>) | undefined
  let shell: DesktopShellSpec | undefined
  let pnpm: ReturnType<typeof installDesktopPnpmRuntime> | undefined
  let stderr = ''
  let stdoutLog = ''
  try {
    writeFileSync(join(home, 'settings.yaml'), 'sensteed-agent:\n  mode: advanced\nagent-presets:\n  default: minimal\n')
    const initial = prepareDesktopProfile('1', home, 'win32')
    if (aaEnabled) {
      // AA is an optional Profile package. Exercise its real bundle/Loader
      // lifecycle without requiring a separately installed Connector or login.
      const provider = join(initial.profile.dir, 'node_modules', '@agents-anywhere', 'dsh-bridge-next')
      mkdirSync(join(provider, 'lib', 'bundled-connector'), { recursive: true })
      writeFileSync(join(provider, 'package.json'), JSON.stringify({
        name: '@agents-anywhere/dsh-bridge-next', version: '99.0.0', type: 'module', exports: './index.js',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }))
      writeFileSync(join(provider, 'cordis.patch.yml'), '- insert:\n    - id: agents-anywhere-bridge-next\n      name: "@agents-anywhere/dsh-bridge-next"\n')
      writeFileSync(join(provider, 'lib', 'bundled-connector', 'pyproject.toml'), '[project]\nname = "isolated-aa-fixture"\n')
      writeFileSync(join(provider, 'index.js'), 'export function apply(ctx) { ctx.provide("agentsAnywhereRuntime", {}); ctx.provide("agentsAnywhereOnboarding", {}) }\n')
    }
    const prepared = prepareDesktopProfile('1', home, 'win32', undefined, undefined, undefined, { aaEnabled: aaRequested })
    expect(prepared.aaEnabled).toBe(aaEnabled)
    if (aaProvider === 'missing') expect(prepared.aaFailure).toBeTruthy()
    else expect(prepared.aaFailure).toBeUndefined()
    // dsh 0.1.7 imports the home settings document during every first boot and
    // reconciles profile patches, which restarts the Web server with the
    // command-line port winning over the composed row. The row default and the
    // command line must therefore agree — keep the composed default (43120) on
    // both sides instead of the pre-0.1.7 `prepared.port = 0` ephemeral trick;
    // any other port here makes the scheduled shell spec stale after the
    // import restart and the first renderer fetch hits a closed port.
    expect(prepared.port).toBe(43_120)
    const plugin = join(prepared.profile.dir, 'node_modules', 'isolated-client-fixture')
    mkdirSync(plugin, { recursive: true })
    writeFileSync(join(plugin, 'package.json'), JSON.stringify({ name: 'isolated-client-fixture', version: '1.0.0', type: 'module',
      exports: { '.': './index.js', './client': './client.js', './package.json': './package.json' }, dsh: { client: { platform: 'web' } } }))
    writeFileSync(join(plugin, 'index.js'), 'export function apply() {}\n')
    writeFileSync(join(plugin, 'client.js'), 'export function apply(ctx) { ctx.provide("isolatedClientFixture", true) }\n')
    prepared.patches.push({ insert: [{ id: 'isolated-client-fixture', name: 'isolated-client-fixture' }] })
    // The boot-time settings import reconciles through the launcher's
    // `readPatches`, which re-prepares the profile from disk. Persist the
    // fixture row into the profile patch layer so it survives that
    // recomposition instead of living only in this in-memory document.
    writeFileSync(join(prepared.profile.dir, 'cordis.patch.yml'),
      '- insert:\n    - id: isolated-client-fixture\n      name: isolated-client-fixture\n')
    const packageRoot = new URL('../', import.meta.url)
    const pnpmBinPath = fileURLToPath(new URL('node_modules/pnpm/bin/pnpm.mjs', packageRoot))
    const electronVersion = JSON.parse(readFileSync(new URL('node_modules/electron/package.json', packageRoot), 'utf8')).version
    pnpm = installDesktopPnpmRuntime({ platform: process.platform, appExecutable: process.execPath, pnpmBinPath,
      electronVersion, stateDir: join(home, 'runtime'), environment: process.env })
    child = fork(fileURLToPath(new URL('./fixtures/isolated-host/child.mjs', import.meta.url)), [], {
      // dsh 0.1.7's HMR service refuses to mount without the internal loader
      // seam; the production supervisor (src/host-process.ts) passes the same
      // flag, and the boot-time settings import depends on the HMR entry to
      // reconcile profile patches without dropping the web server.
      execArgv: ['--expose-internals'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'advanced',
    })
    child.stdout?.on('data', data => { stdoutLog += String(data) })
    child.stderr?.on('data', data => { stderr += String(data) })
    const [ready] = await once(child, 'message')
    expect(ready).toEqual({ ready: true })
    const worker = child
    // The child boots a real pnpm-managed profile; on a loaded machine that
    // install alone can exceed 30s wall time and abort an otherwise healthy
    // boot. The RPC budget stays far below the enclosing vitest timeout.
    rpc = new HostRpc({ send: data => worker.send(data as Serializable),
      listen: receive => { worker.on('message', receive); return () => { worker.off('message', receive) } },
    }, 120_000)
    child.on('exit', () => rpc?.close(stderr || 'worker exited'))
    const runtime = {
      platform: 'win32', windowsBuild: 22631, locale: 'en',
      updates: { isPackaged: false, canDownload: false, currentVersion: '2.0.7-beta.1', statePath: join(home, 'updates') },
      schedule(spec: DesktopShellSpec) { shell = spec; return async () => {} },
      registerTrayItem() { return { refresh() {}, dispose() {} } },
      setLocalePreference() {}, setThemeSource() {},
      // dsh 0.1.7's settings import schedules a generation restart through the
      // native bridge after reconciling the imported document; the bridge
      // attaches its own error logging to the returned promise.
      requestRestart: async () => {}, requestRecoveryRestart: async () => {},
    } as unknown as DesktopRuntime
    releaseNative = bindNativeRuntime(rpc, runtime)
    rpc.handle('certificate', () => ({ failureCode: 'test-disabled' }))
    rpc.handle('quit', () => {})
    const result = await rpc.call<{ pid: number; services: { aaRuntime: boolean; aaOnboarding: boolean } }>('boot', [{
      prepared, profilePreferences: { mode: 'advanced', openBrowser: false, networkExposure: 'loopback',
        macosMaterial: 'auto', windowsMaterial: 'auto', market: 'disabled', notifications: { enabled: false }, aaEnabled: aaRequested },
      homeDir: home, activeProfileName: prepared.profile.name, pluginManagementStatePath: join(home, 'plugins.json'),
      selectionStatePath: join(home, 'selection.json'), marketUserDataDir: join(home, 'userdata'),
      releaseUserDataLocations: desktopReleaseUserDataLocations(home, join(home, 'userdata')),
      launchEnvironmentLayers: [],
      // Empty is what the supervisor sends when the machine has no system proxy, so the Host still
      // installs its outbound policy here and resolves every probe to a direct connection.
      desktopProxyOverlay: {},
      desktopPnpmBootstrap: { activeProfileName: prepared.profile.name, activeProfileDir: prepared.profile.dir, homeDir: home,
        appExecutable: process.execPath, pnpmBinPath, electronVersion, nodeBinDir: pnpm.nodeBinDir,
        nodeShimPath: pnpm.nodeShimPath, clearEnvironmentPath: pnpm.clearEnvironmentPath,
        dshBootstrapPath: fileURLToPath(new URL('../lib/desktop-cli.js', import.meta.url)) },
      logDirectory: join(home, 'logs'),
    }, runtimeSnapshot(runtime), token])
    expect(result.pid).toBe(child.pid)
    expect(result.pid).not.toBe(process.pid)
    expect(shell).toBeDefined()
    const spec = shell!
    const headers = { [spec.rendererAccessHeader.name]: spec.rendererAccessHeader.value }
    const unauthorized = await fetch(spec.url, { headers })
    await unauthorized.body?.cancel()
    expect(unauthorized.status).toBe(401)
    const authentication = await fetch(spec.authenticationUrl, { headers, redirect: 'manual' })
    await authentication.body?.cancel()
    expect(authentication.status).toBe(303)
    const cookie = authentication.headers.get('set-cookie')!.split(';')[0]!
    const response = await fetch(spec.url, { headers: { ...headers, Cookie: cookie } })
    expect(response.status).toBe(200)
    const html = await response.text()
    const match = html.match(/(?:window\.__DSH_BOOT__|globalThis\["__DSH_BOOT__"\]) = (\{.*?\})<\/script>/u)
    expect(match).not.toBeNull()
    const graph = JSON.parse(match![1]!) as { entries: { id: string; url: string }[] }
    const pluginEntry = graph.entries.find(entry => entry.id === 'isolated-client-fixture')
    expect(pluginEntry).toBeDefined()
    const bundle = await fetch(new URL(pluginEntry!.url, spec.url), { headers: { ...headers, Cookie: cookie } })
    expect(bundle.status).toBe(200)
    expect(await bundle.text()).toContain('isolatedClientFixture')
    expect(html).toContain('dsh-plugin-desktop')
    await expect.poll(async () => (await rpc!.call<{ services: { aaRuntime: boolean; aaOnboarding: boolean } }>('status')).services, { timeout: 3000 })
      .toEqual({ aaRuntime: aaEnabled, aaOnboarding: aaEnabled })
    await rpc.call('stop')
    await expect(fetch(spec.url, { headers })).rejects.toThrow()
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause
    const probeUrl = shell ? `${shell.url} (auth=${shell.authenticationUrl})` : 'spec missing'
    let listeners = 'lsof unavailable'
    try {
      const probePort = shell ? new URL(shell.url).port : ''
      const all = child?.pid === undefined ? '' : execSync(`lsof -nP -a -p ${String(child.pid)} -iTCP -sTCP:LISTEN || true`, { encoding: 'utf8' })
      listeners = `${portListeners(probePort)}\nchild listeners:\n${all.trim() === '' ? `(child holds no TCP listener)` : all.trim()}`
    } catch { /* diagnostic only */ }
    let hostLogs = '(no host logs read)'
    try {
      const logsRoot = join(home, 'logs')
      const files = execSync(`find ${JSON.stringify(logsRoot)} -type f 2>/dev/null | head -8`, { encoding: 'utf8' }).trim()
      hostLogs = files === '' ? '(logs dir empty)' : files.split('\n').map(file => `\n--- ${file} ---\n${readFileSync(file, 'utf8').slice(-12_000)}`).join('')
    } catch { /* diagnostic only */ }
    throw new Error(`${error instanceof Error ? error.stack : String(error)}\ncause=${String(cause)}\nurl=${probeUrl}\nlisteners:\n${listeners}\nexit=${String(child?.exitCode ?? child?.signalCode)}\nstdout:\n${stdoutLog}\nstderr:\n${stderr}\nhost logs:\n${hostLogs}`)
  } finally {
    await releaseNative?.()
    rpc?.close()
    if (child && child.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit }
    pnpm?.dispose()
    rmSync(home, { recursive: true, force: true })
  }
}, 180_000)
