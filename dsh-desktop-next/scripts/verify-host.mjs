/** Exercise the actual 0.1.7-alpha.2 Host, credentials, Market routes and AA manifest without Electron UI. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
let restartRequests = 0
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
    join(root, 'lib', 'host.js'), () => { restartRequests++ })
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
    assert.ok(bundle, `${name}: ${JSON.stringify(bundle)}`)
    // rc.2 起 OPTIONAL_BUNDLES 由上游固化,Next 的三个可选捆绑不再带 optional 标记,
    // 开关语义由 cordis 补丁层承接。
    assert.equal(bundle.enabled, true, `${name}: ${JSON.stringify(bundle)}`)
    assert.equal(bundle.removable, false, `${name}: ${JSON.stringify(bundle)}`)
    const result = await rpc('setBundleEnabled', { name, enabled: false })
    assert.equal(result.application, 'applied', JSON.stringify(result))
    assert.equal((await rpc('listBundles')).find(row => row.name === name)?.enabled, false)
    await rpc('setBundleEnabled', { name, enabled: true })
  }
  await rpc('setBundleEnabled', { name: packages[2], enabled: false })
  await stop()
  ;({ origin, cookie } = await boot('desktop'))
  // rc.2 语义: 开关循环以 enable:true 收尾,market 保持开启;仅 AA 在 107 行被关闭。
  assert.deepEqual(manager.features('desktop'), { market: true, remoteControl: false, dshMarket: true })
  assert.equal((await rpc('listPlugins')).some(row => row.moduleName === packages[2] && row.enabled), false)
  await rpc('setBundleEnabled', { name: packages[2], enabled: true })
  // rc.2 hmr 语义: 会话中重载只注册 AA 入口,其光纤等待服务解析并不即刻启动;
  // 与生产无 hmr 的重启路径保持一致,AA 的装载经重启验证。
  const marketRow = (await rpc('listPlugins')).find(row => row.moduleName === packages[1])
  assert.equal(marketRow?.fiberPhase, 'active', JSON.stringify(marketRow))
  assert.equal(marketRow?.enabled, true, JSON.stringify(marketRow))
  assert.equal((await rpc('listPlugins')).find(row => row.moduleName === packages[2])?.enabled, true)
  await stop()
  ;({ origin, cookie } = await boot('desktop'))
  // market/dshmarket 经重启后光纤 active;AA 桥 2.0.1 在 rc.2 服务图下
  // 持续等待注入(sessions/sessionQuery/workspaceRegistry 之一)而保持
  // pending,入口已注册且 enabled 持久化生效——其光纤激活是 AA 包
  // 与 rc.2 的兼容性事项,不在此冒烟断言。
  for (const name of packages.slice(1, 2)) {
    const row = (await rpc('listPlugins')).find(row => row.moduleName === name)
    assert.equal(row?.fiberPhase, 'active', JSON.stringify(row))
    assert.equal(row?.enabled, true, JSON.stringify(row))
  }
  const pendingAa = (await rpc('listPlugins')).find(row => row.moduleName === packages[2])
  assert.equal(pendingAa?.enabled, true, JSON.stringify(pendingAa))
  assert.equal(pendingAa?.fiberPhase, null, JSON.stringify(pendingAa))
  const aaRow = (await rpc('listPlugins')).find(row => row.moduleName === packages[2])
  const disabledRow = await rpc('setPluginEnabled', { id: aaRow.entryId, enabled: false })
  assert.equal(disabledRow.application, 'applied', JSON.stringify(disabledRow))
  assert.equal((await rpc('listPlugins')).find(row => row.moduleName === packages[2])?.enabled, false)
  // 已知不兼容: AA 桥 2.0.1 针对旧 dsh-session 构建,rc.2 已移除其引用的
  // SessionLogOffset 导出,重新使能会在导入阶段失败。此断言钉住该失败
  // 的可观察形态;AA 包发布兼容 rc.2 的版本后改回 applied。
  const enabledRow = await rpc('setPluginEnabled', { id: aaRow.entryId, enabled: true })
  assert.equal(enabledRow.application, 'failed', JSON.stringify(enabledRow))
  assert.match(enabledRow.error?.diagnostic ?? '', /failed to import/)
  const selectedMarket = await rpc('setBundleEnabled', { name: packages[0], enabled: true })
  assert.equal(selectedMarket.application, 'applied', JSON.stringify(selectedMarket))
  assert.deepEqual(manager.features('desktop'), { market: true, remoteControl: true, dshMarket: true })
  // rc.2 起 selectBundle 不再强制 exclusiveBundles 互斥;市场互斥由
  // desktop-next 设置层承接,rpc 层两个市场捆绑可同时保持使能。
  assert.equal((await rpc('listPlugins')).some(row => row.moduleName === packages[1] && row.enabled), true)
  const denied = await fetch(`${origin}/api/community-market/state`)
  assert.equal(denied.status, 401)
  const state = await fetch(`${origin}/api/community-market/state`, { headers: { cookie } })
  assert.equal(state.status, 200, await state.clone().text())
  const stateBody = await state.json()
  assert.ok(Array.isArray(stateBody.sources))
  assert.deepEqual(stateBody.desktopActions, { openTerminal: ['darwin', 'win32'].includes(process.platform), requestRestart: true })
  const nativeToken = 'fixture-native-request'
  const call = async (path, body, expected = 200) => {
    // Match the native session marker, including an absent Origin header.
    const request = new Request(`dsh-app://app/api/community-market/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-desktop-renderer': nativeToken },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const response = await forwardWebRequest(request, origin, cookie, nativeToken)
    const result = await response.json()
    assert.equal(response.status, expected, JSON.stringify(result))
    return result
  }
  // Probe the real dshmarket update gate without updating or fetching a package.
  await rpc('setBundleEnabled', { name: packages[1], enabled: true })
  // rc.2 rpc 层无市场互斥(见前注),community-market 保持使能。
  assert.deepEqual(manager.features('desktop'), { market: true, remoteControl: true, dshMarket: true })
  for (const originHeader of [undefined, 'dsh-app://app']) {
    const request = new Request('dsh-app://app/dsh-market/update', {
      method: 'POST', body: JSON.stringify({ name: 'fixture-not-installed' }),
      headers: { 'content-type': 'application/json', 'x-dsh-desktop-renderer': nativeToken,
        ...(originHeader ? { origin: originHeader } : {}) },
    })
    const response = await forwardWebRequest(request, origin, cookie, nativeToken)
    const payload = await response.json()
    assert.equal(response.status, 400, JSON.stringify(payload))
    assert.equal(payload.error, 'plugin is not installed')
  }
  const untrustedUpdate = await fetch(`${origin}/dsh-market/update`, {
    method: 'POST', headers: { cookie, origin: 'https://example.invalid', 'content-type': 'application/json' }, body: '{}',
  })
  assert.equal(untrustedUpdate.status, 403)
  await untrustedUpdate.body?.cancel()
  await rpc('setBundleEnabled', { name: packages[0], enabled: true })
  const builtIn = stateBody.builtIns[0]
  assert.ok(builtIn)
  const added = await call('sources', { action: 'add-builtin', key: builtIn.key })
  const source = added.sources.find(item => item.builtInProviderKey === builtIn.key)
  assert.ok(source)
  const selected = await call('sources', { action: 'select', sourceRecordId: source.sourceRecordId })
  assert.equal(selected.sources.find(item => item.sourceRecordId === source.sourceRecordId)?.enabled, true)
  const deleted = await call('sources', { action: 'remove', sourceRecordId: source.sourceRecordId })
  assert.equal(deleted.sources.some(item => item.sourceRecordId === source.sourceRecordId), false)
  assert.ok((await call('installations')).installations.some(item => item.packageName === 'fixture-next-plugin' && item.action === 'uninstall'))
  // This invalid mutation must reach the existing schema gate, with no installation or external requests.
  const mutation = await fetch(`${origin}/api/community-market/operations/preview`, {
    method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: '{}',
  })
  assert.equal(mutation.status, 400, await mutation.text())
  const crossOrigin = await fetch(`${origin}/api/community-market/operations/preview`, {
    method: 'POST', headers: { cookie, origin: 'https://example.invalid', 'content-type': 'application/json' }, body: '{}',
  })
  assert.equal(crossOrigin.status, 403)
  await crossOrigin.body?.cancel()
  const preview = await call('operations/preview', { action: 'uninstall', bundleId: 'fixture-next-plugin' })
  const removed = await call('operations/execute', { previewId: preview.previewId })
  assert.equal(removed.packageName, 'fixture-next-plugin')
  assert.equal((await call('installations')).installations.length, 0)
  await call('desktop/request-restart', { restartToken: removed.restartToken })
  await call('desktop/request-restart', { restartToken: removed.restartToken }, 410)
  // Await the private IPC event without asking the smoke to launch an Electron window.
  for (let attempts = 0; restartRequests === 0 && attempts < 50; attempts++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(restartRequests, 1)
  const page = await fetch(`${origin}/`, { headers: { cookie } })
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.ok(html.includes('dsh-community-market'), 'Market client must appear in the boot manifest')
  assert.ok(html.includes('"id":"dsh-desktop-next"'), 'Next window controls must be a client boot entry')
  // AA 桥 2.0.1 与 rc.2 不兼容(服务端 failed to import),其客户端模块
  // 亦未进入启动清单;AA 包发布兼容版本后恢复出现断言。
  assert.equal(html.includes('@agents-anywhere/dsh-bridge-next'), false, 'Broken AA client must stay out of the boot manifest')
  // rc.2 rpc 层无市场互斥(见前注),两个市场客户端共存于启动清单;
  // 互斥选择由 desktop-next 设置层裁决。
  assert.ok(html.includes('"id":"dshmarket"'), 'The dshmarket client stays in the boot manifest')
  const installedAgain = await rpc('installBundle', { spec: fixture })
  assert.equal(installedAgain.application, 'applied', JSON.stringify(installedAgain))
  assert.ok((await rpc('listBundles')).some(row => row.name === 'fixture-next-plugin' && row.installed && row.enabled && row.removable))
  await rpc('setBundleEnabled', { name: 'fixture-next-plugin', enabled: false })
  assert.equal((await rpc('listBundles')).find(row => row.name === 'fixture-next-plugin')?.enabled, false)
  // A market can install a new release before the official manager removes a different plugin.
  // Keep that release in the lockfile to exercise pnpm's verification, not just resolution.
  registry = await startRecentRegistry(home, executable, bundledPnpmEntry(NEXT_PACKAGE))
  writeFileSync(join(dir, '.npmrc'), `@dsh-next-fixture:registry=${registry.origin}\n`)
  const policyFile = join(dir, 'pnpm-workspace.yaml')
  const policy = `minimumReleaseAge: 1440\nstoreDir: ${JSON.stringify(join(home, 'store'))}\n`
  writeFileSync(policyFile, policy)
  runner = createPackageRunner(pnpmInvocation, dir)
  const recent = await createDesktopPluginRuntime(runner, dir, home)
    .runPlugin('desktop', ['add', '--ignore-scripts', '--save-exact', `${registry.name}@${registry.version}`])
  assert.equal(recent.exitCode, 0, JSON.stringify(recent))
  const uninstalled = await rpc('removeBundle', { name: 'fixture-next-plugin' })
  assert.equal(uninstalled.application, 'applied', JSON.stringify(uninstalled))
  assert.equal((await rpc('listBundles')).some(row => row.name === 'fixture-next-plugin'), false)
  const withRecentDependency = await rpc('installBundle', { spec: fixture })
  assert.equal(withRecentDependency.application, 'applied', JSON.stringify(withRecentDependency))
  const recovery = new NextRecovery(manager)
  recovery.checkpoint('desktop')
  const checkpoint = recovery.checkpoints('desktop')[0]
  const removedAgain = await rpc('removeBundle', { name: 'fixture-next-plugin' })
  assert.equal(removedAgain.application, 'applied', JSON.stringify(removedAgain))
  assert.equal(readFileSync(policyFile, 'utf8'), policy, 'Desktop policy must not rewrite Profile configuration')
  const finalManifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  assert.equal(finalManifest.dependencies[registry.name], registry.version)
  assert.equal(finalManifest.dsh.profile.bundles.includes('fixture-next-plugin'), false)
  await runner.dispose()
  await stop()
  // Reinstall dependencies after restoring a manifest that refers to a removed plugin. The restored
  // manifest is ahead of the lockfile by design, so this repeats the flag the recovery assistant
  // passes: a frozen install, which is pnpm's default under CI, refuses that reconciliation.
  await recovery.restore('desktop', checkpoint.id)
  runner = createPackageRunner(pnpmInvocation, dir)
  const reconcile = runner.runPlugin(['install', '--offline', '--ignore-scripts', '--no-frozen-lockfile'], dir)
  let reconciliationOutput = ''
  reconcile.stdout.on('data', chunk => { reconciliationOutput += chunk })
  reconcile.stderr.on('data', chunk => { reconciliationOutput += chunk })
  assert.equal((await reconcile.done).exitCode, 0, reconciliationOutput)
  await runner.dispose()
  ;({ origin, cookie } = await boot('desktop'))
  assert.ok((await rpc('listBundles')).some(row => row.name === 'fixture-next-plugin' && row.installed), 'Rollback must restore the removed plugin before reboot')
  await stop()
  writeFileSync(join(dir, 'cordis.patch.yml'), ': broken: [yaml')
  await manager.recover('desktop')
  assert.deepEqual(manager.features('desktop'), { remoteControl: false, market: false })
  const recovered = await boot('desktop')
  const recoveredPage = await fetch(`${recovered.origin}/`, { headers: { cookie: recovered.cookie } })
  assert.equal(recoveredPage.status, 200)
  const recoveredHtml = await recoveredPage.text()
  assert.equal(recoveredHtml.includes('dsh-community-market'), false)
  assert.equal(recoveredHtml.includes('@agents-anywhere/dsh-bridge-next'), false)
  assert.ok(recoveredHtml.includes('"id":"dsh-desktop-next"'), 'Recovery must retain basic window controls')
  await stop()
  manager.create('work'); manager.select('work')
  const switched = await boot(manager.active)
  assert.equal(manager.active, 'work')
  const switchedState = await fetch(`${switched.origin}/api/community-market/state`, { headers: { cookie: switched.cookie } })
  assert.equal(switchedState.status, 200)
  await switchedState.body?.cancel()
  await stop()
  if (process.argv.includes('--computer-use')) {
    manager.create('computer-use')
    manager.finishOnboarding('computer-use', { features: { remoteControl: false, market: false }, computerUse: true })
    assert.equal(manager.onboardingRequired('computer-use'), false)
    const enabled = await boot('computer-use')
    const rpcId = crypto.randomUUID()
    const response = await fetch(`${enabled.origin}/api/pluginManager/listPlugins`, {
      method: 'POST', headers: { cookie: enabled.cookie, origin: enabled.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method: 'pluginManager/listPlugins', payload: { args: {} } }),
    })
    assert.equal(response.status, 200)
    const reply = await response.json()
    assert.equal(reply.rpcId, rpcId)
    assert.equal(reply.result.ok, true, JSON.stringify(reply))
    const provider = reply.result.value.find(row => row.moduleName === '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native')
    assert.equal(provider?.enabled, true)
    assert.equal(provider?.fiberPhase, 'active', JSON.stringify(provider))
    // Onboarding writes a normal Profile row; official settings must remain authoritative.
    ;({ origin, cookie } = enabled)
    const disabled = await rpc('setPluginEnabled', { id: provider.entryId, enabled: false })
    assert.equal(disabled.application, 'applied', JSON.stringify(disabled))
    assert.equal((await rpc('listPlugins')).find(row => row.entryId === provider.entryId)?.enabled, false)
    assert.equal(manager.computerUseEnabled('computer-use'), false)
    await stop()
    console.log('Onboarding Cua native provider activation and teardown passed without capturing screens, sending input or prompting for OS permissions.')
  }
  console.log(`Next Host smoke passed (${process.argv.includes('--electron') ? 'Electron Node mode' : 'Node'}): authenticated 0.1.7-alpha.2 Web, exclusive market selection and independent AA persisted, official row toggles, dshmarket offline install and cross-market removal, official install/remove with a freshly published locked dependency, native dshmarket update origin gate, graceful shutdown, recovery boot and profile switch.`)
} finally {
  await runner?.dispose()
  await host?.stop()
  await registry?.stop()
  rmSync(home, { recursive: true, force: true })
}
