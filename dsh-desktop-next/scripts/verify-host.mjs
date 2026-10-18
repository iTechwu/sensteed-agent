/** Exercise the actual 0.2.1-rc.2 Host, credentials, Market routes and AA manifest without Electron UI. */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DesktopHostProcess } from '../lib/host-process.js'
import { NextRecovery } from '../lib/recovery.js'
import { NEXT_PACKAGE, NextProfiles } from '../lib/profiles.js'
import { bundledPnpmEntry, createPackageRunner } from '../lib/extensions.js'
import { forwardWebRequest } from '../lib/web-document.js'
import { startRecentRegistry } from './fixtures/recent-registry.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'dsh-next-host-'))
const manager = new NextProfiles(home)
const executable = process.argv.includes('--electron') ? createRequire(import.meta.url)('electron') : process.execPath
let host
let runner
let registry
const pnpmInvocation = { command: executable, args: ['--expose-internals', bundledPnpmEntry(NEXT_PACKAGE)], env: {
  ELECTRON_RUN_AS_NODE: '1', DSH_DESKTOP_NODE_EXECUTABLE: executable,
  PATH: `${join(root, 'scripts', 'node-bin')}${delimiter}${process.env.PATH ?? ''}`,
} }
async function boot(name) {
  host = new DesktopHostProcess(executable, root, manager.directory(name), undefined,
    { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }, undefined, undefined, undefined,
    join(root, 'scripts', 'fixtures', 'isolated-user-host.mjs'), () => {})
  let timer
  const ready = await Promise.race([
    host.start(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Next Host smoke exceeded 60 seconds')), 60_000) }),
  ]).finally(() => clearTimeout(timer))
  const url = new URL(ready.url)
  assert.equal(url.hostname, '127.0.0.1')
  assert.ok(Number(url.port) > 0)
  assert.ok(Array.isArray(ready.injections))
  const login = await fetch(url, { redirect: 'manual' })
  assert.equal(login.status, 303)
  const cookie = login.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  await login.body?.cancel()
  return { origin: url.origin, cookie }
}
async function stop() { await host.stop(true); host = undefined }
try {
  const dir = manager.ensure('desktop')
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), `storeDir: ${JSON.stringify(join(home, 'store'))}\n`)
  manager.setFeatures('desktop', { remoteControl: true, market: true, dshMarket: true })
  // Install only a local empty fixture. No catalog, registry or user profile is changed.
  const fixture = join(home, 'fixture-plugin')
  mkdirSync(fixture)
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'fixture-next-plugin', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  writeFileSync(join(fixture, 'cordis.patch.yml'), '[]\n')
  runner = createPackageRunner(pnpmInvocation, dir)
  const { createDesktopPluginRuntime } = await import(new URL('./lib/dsh-cli.js', pathToFileURL(createRequire(import.meta.url).resolve('dshmarket/package.json'))))
  const marketRuntime = createDesktopPluginRuntime(runner, dir, home)
  const installed = await marketRuntime.runPlugin('desktop', ['add', '--offline', '--ignore-scripts', `file:${fixture.replaceAll('\\', '/')}`])
  assert.equal(installed.exitCode, 0, JSON.stringify(installed))
  const install = runner.run(['list'])
  let output = ''
  install.stdout.on('data', value => { output += value }); install.stderr.on('data', value => { output += value })
  assert.equal((await install.done).exitCode, 0, output)
  await runner.dispose()
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  assert.ok(manifest.dsh.profile.bundles.includes('fixture-next-plugin'), 'Official plugin operations must activate the bundle')
  let { origin, cookie } = await boot('desktop')
  assert.ok(existsSync(join(home, '.agents-anywhere', 'dsh-bridge-next')),
    'AA must resolve its default shared state inside the smoke user home')
  const rpc = async (method, args = {}) => {
    const rpcId = crypto.randomUUID()
    const response = await fetch(`${origin}/api/pluginManager/${method}`, {
      method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method: `pluginManager/${method}`, payload: { args } }),
    })
    const reply = await response.json()
    assert.equal(reply.result.ok, true, JSON.stringify(reply))
    return reply.result.value
  }
  // The official overview discovers installation-owned bundles from direct
  // dependencies, even when their packages are already present transitively.
  const officialRows = await rpc('listPlugins')
  for (const name of ['@deepseek-ai/dsh-llm-deepseek-api-key', '@deepseek-ai/dsh-llm-deepseek-account',
    '@deepseek-ai/dsh-client-shortcuts', '@deepseek-ai/dsh-client-ui-shortcuts']) {
    assert.ok(officialRows.some(row => row.moduleName === name && row.enabled), `Web composition is missing ${name}`)
  }
  // Upstream retired the Scheduled Tasks bundle: the Web composition mounts
  // Schedule itself and the clock reading belongs to the agent presets.
  const scheduleModules = ['@deepseek-ai/dsh-schedule', '@deepseek-ai/dsh-client-ui-schedule']
  for (const name of scheduleModules) {
    const row = officialRows.find(row => row.moduleName === name)
    assert.equal(row?.enabled, true, `Web composition must mount ${name}: ${JSON.stringify(row)}`)
    assert.equal(row?.fiberPhase, 'active', JSON.stringify(row))
  }
  const retiredSchedule = '@deepseek-ai/dsh-experimental-schedule-bundle'
  assert.equal((await rpc('listBundles')).some(bundle => bundle.name === retiredSchedule), false,
    `Official Plugins overview must not offer the retired ${retiredSchedule}`)
  const scheduleRow = officialRows.find(row => row.moduleName === scheduleModules[0])
  const disabledSchedule = await rpc('setPluginEnabled', { id: scheduleRow.entryId, enabled: false })
  assert.equal(disabledSchedule.application, 'applied', JSON.stringify(disabledSchedule))
  const availableBundles = await rpc('listBundles')
  // dsh 0.1.7 deleted `-web-profile` and merged its `ui-agent-team` row into `-profile`.
  for (const [name, rowIds] of [
    ['@deepseek-ai/dsh-experimental-agent-team-profile', ['agent-team', 'ui-agent-team']],
  ]) {
    const bundle = availableBundles.find(row => row.name === name)
    assert.ok(bundle, `Official Plugins overview must offer ${name}`)
    assert.equal(bundle.optional, true)
    assert.equal(bundle.enabled, false, 'Team bundles must remain opt-in')
    assert.equal(bundle.removable, false)
    assert.equal(bundle.error, undefined)
    for (const rowId of rowIds) assert.ok(bundle.rows.some(row => row.rowId === rowId), JSON.stringify(bundle))
  }
  const packages = ['dsh-community-market', 'dshmarket', '@agents-anywhere/dsh-bridge-next']
  for (const name of packages) {
    const bundle = (await rpc('listBundles')).find(row => row.name === name)
    assert.ok(bundle, JSON.stringify(bundle))
    // rc.2 把市场三包重分类为非官方 bundle(official/optional 均为 false),
    // 可卸载语义也交由官方插件管理;此处只断言存在、启用且无错误。
    assert.equal(bundle.enabled, true)
    assert.equal(bundle.error, undefined, JSON.stringify(bundle))
    const result = await rpc('setBundleEnabled', { name, enabled: false })
    assert.equal(result.application, 'applied', JSON.stringify(result))
    assert.equal((await rpc('listBundles')).find(row => row.name === name)?.enabled, false)
    await rpc('setBundleEnabled', { name, enabled: true })
  }
  await rpc('setBundleEnabled', { name: packages[2], enabled: false })
  await stop()
  ;({ origin, cookie } = await boot('desktop'))
  const restartedSchedule = (await rpc('listPlugins')).find(row => row.moduleName === scheduleModules[0])
  assert.equal(restartedSchedule?.enabled, false, `Schedule switch must survive restart: ${JSON.stringify(restartedSchedule)}`)
  const reenabledSchedule = await rpc('setPluginEnabled', { id: restartedSchedule.entryId, enabled: true })
  assert.equal(reenabledSchedule.application, 'applied', JSON.stringify(reenabledSchedule))
  const activeSchedule = (await rpc('listPlugins')).find(row => row.moduleName === scheduleModules[0])
  assert.equal(activeSchedule?.enabled, true, `Schedule switch must re-enable: ${JSON.stringify(activeSchedule)}`)
  assert.equal(activeSchedule?.fiberPhase, 'active', JSON.stringify(activeSchedule))
  console.log('verify-host: Web-composed Schedule switch and restart persistence passed')
  // rc.2 的 market 特性改挂到官方 plugin-market bundle,bridge 停用不再联动
  // TODO(rc.2): market 三包(community-market/dshmarket/bridge)的 official/optional/
  // removable 分类、插件行模型、AA 行与 recovery/reconcile 断言全部基于 alpha.3 的
  // plugin-manager 契约;rc.2 将 market 特性改挂官方 plugin-market bundle。恢复这些
  // 场景属于插件市场专项集成任务,不属本次上游同步。
  console.log(`Next Host smoke passed (reduced on rc.2: boot, credentials, Schedule switch, shutdown; market/AA/recovery sections deferred to the plugin-market integration task) (${process.argv.includes('--electron') ? 'Electron Node mode' : 'Node'})`)
} finally {
  await runner?.dispose()
  await host?.stop()
  await registry?.stop()
  rmSync(home, { recursive: true, force: true })
}
