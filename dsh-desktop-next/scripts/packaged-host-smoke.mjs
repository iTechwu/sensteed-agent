/** Boot the real Host from one packaged Next archive and stop it; no window, no user data. */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.argv[2]
if (!root) throw new Error('packaged-host-smoke: expected the packaged application root')
const { NextDesktopRuntime } = await import(pathToFileURL(join(root, 'lib', 'desktop-runtime.js')).href)
const home = mkdtempSync(join(tmpdir(), 'dsh-next-packaged-smoke-'))
let failures = 0
// The payload of this CPU sits beside the archive, where the packaged shell selects it.
const runtime = new NextDesktopRuntime({ root, home, primaryRuntime: join(dirname(root), 'runtime', process.arch, 'primary-runtime'), executable: process.execPath, addresses: () => [],
  certificate: async () => { throw new Error('The packaged smoke must not request system key storage or expose a LAN listener') },
  onFailure: () => { failures += 1 }, onChange() {}, onRestart() {}, onTerminal() {}, onNotification() {},
})
try {
  runtime.initialize()
  runtime.profiles.ensure('desktop')
  // The Community Market bundle loads from the archive; remote control stays off because the
  // bridge shares its state directory with the user's other editions.
  runtime.profiles.setFeatures('desktop', { market: true, remoteControl: false })
  await runtime.start()
  const state = runtime.state()
  if (state.phase !== 'ready' || failures !== 0) throw new Error(`Packaged Host did not reach ready: phase=${state.phase} failure=${state.failure}`)
  const auth = runtime.auth
  if (!auth) throw new Error('Packaged Host reported ready without native credentials')
  // Only the native capability passes the request gate; a bare loopback browser request is refused.
  const response = await fetch(new URL(auth.url).origin)
  if (response.status !== 403) throw new Error(`Packaged Host exposed the application to ordinary browsers: HTTP ${String(response.status)}`)
  await response.body?.cancel()
  // Diagnostics export runs a worker thread from the archive.
  const report = join(home, 'diagnostics.json')
  await runtime.diagnostics.exportTo(report, { ...state, platform: process.platform, version: 'smoke', updates: null, trayAvailable: false, notificationsAvailable: false, onboarding: false })
  if (!existsSync(report)) throw new Error('Packaged diagnostics export produced no file')
  console.log(`Packaged Next Host booted from ${root}: profile ${state.selected}, loopback ${new URL(auth.url).origin}, diagnostics export ok`)
} finally {
  await runtime.close()
  rmSync(home, { recursive: true, force: true })
}
