/** Headless artifact smoke for the Electron-backed dsh and pnpm command entries. */

import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { installDesktopPnpmRuntime } from '../lib/desktop-runtime-environment.js'

const packageRoot = new URL('../', import.meta.url)
const desktopCli = fileURLToPath(new URL('lib/desktop-cli.js', packageRoot))
const pnpmCli = fileURLToPath(new URL('node_modules/pnpm/bin/pnpm.mjs', packageRoot))
const dshVersion = JSON.parse(readFileSync(new URL('node_modules/@deepseek-ai/dsh/package.json', packageRoot), 'utf8')).version
const pnpmVersion = JSON.parse(readFileSync(new URL('node_modules/pnpm/package.json', packageRoot), 'utf8')).version
const electronVersion = JSON.parse(readFileSync(new URL('node_modules/electron/package.json', packageRoot), 'utf8')).version
const RUNNER_ENVIRONMENT_NAMES = new Set([
  'ELECTRON_RUN_AS_NODE',
  'NPM_CONFIG_RUNTIME',
  'NPM_CONFIG_TARGET',
  'NPM_CONFIG_DISTURL',
])

function cleanEnvironment() {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    const normalized = key.toUpperCase()
    if (!RUNNER_ENVIRONMENT_NAMES.has(normalized)) env[key] = value
  }
  return env
}

function assertNoRunnerEnvironment(label, env) {
  const leaked = Object.keys(env).filter((key) => {
    return RUNNER_ENVIRONMENT_NAMES.has(key.toUpperCase())
  })
  if (leaked.length > 0) {
    throw new Error(`${label} leaked runner-only environment variables: ${leaked.join(', ')}`)
  }
}

function verifyResult(label, result, expectedOutput) {
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${label} artifact smoke exited ${String(result.status)}: ${result.stderr.trim()}`)
  }
  if (expectedOutput === undefined) return
  const output = result.stdout.trim()
  const matches = expectedOutput instanceof RegExp
    ? expectedOutput.test(output)
    : output === expectedOutput
  if (!matches) {
    throw new Error(`${label} artifact smoke returned ${JSON.stringify(output)} instead of matching ${String(expectedOutput)}`)
  }
}

function runElectronEntry(label, nodeArgs, entry, args, expectedOutput, extraEnvironment = {}) {
  const env = cleanEnvironment()
  Object.assign(env, extraEnvironment)
  env.ELECTRON_RUN_AS_NODE = '1'
  // Electron's RunAsNode dispatcher treats the first positional token as the
  // script entry. The Electron binary rejects --expose-internals in
  // NODE_OPTIONS, so keep this smoke focused on the packaged entry contract.
  const result = spawnSync(electronPath, [entry, ...args], {
    encoding: 'utf8',
    env,
    shell: false,
  })
  verifyResult(label, result, expectedOutput)
}

function environmentValue(env, name) {
  const normalized = name.toUpperCase()
  return Object.entries(env).find(([key]) => key.toUpperCase() === normalized)?.[1]
}

function runPnpm(env, args, cwd) {
  return process.platform === 'win32'
    ? spawnSync(environmentValue(env, 'ComSpec') ?? 'cmd.exe', ['/d', '/s', '/c', `pnpm ${args.join(' ')}`], {
        cwd,
        encoding: 'utf8',
        env,
        shell: false,
      })
    : spawnSync('pnpm', args, {
        cwd,
        encoding: 'utf8',
        env,
        shell: false,
      })
}

function verifyLifecycleEnvironment(stateRoot, installation, env) {
  const project = join(stateRoot, 'lifecycle-project')
  const resultPath = join(project, 'result.json')
  mkdirSync(project)
  writeFileSync(join(project, 'package.json'), JSON.stringify({
    name: 'sensteed-agent-pnpm-lifecycle-smoke',
    version: '0.0.0',
    private: true,
    scripts: { install: 'node lifecycle.mjs' },
  }) + '\n')
  writeFileSync(join(project, 'lifecycle.mjs'), [
    "import { writeFileSync } from 'node:fs'",
    "writeFileSync(new URL('result.json', import.meta.url), JSON.stringify({",
    "  runAsNode: Object.keys(process.env).filter(name => name.toUpperCase() === 'ELECTRON_RUN_AS_NODE'),",
    '  node: process.env.NODE,',
    '  npmNodeExecPath: process.env.npm_node_execpath,',
    '  runtime: process.env.npm_config_runtime,',
    '  target: process.env.npm_config_target,',
    '  disturl: process.env.npm_config_disturl,',
    '}))',
    '',
  ].join('\n'))

  const result = runPnpm(env, ['install', '--offline', '--reporter=silent'], project)
  verifyResult('pnpm lifecycle smoke', result, '')
  const actual = JSON.parse(readFileSync(resultPath, 'utf8'))
  const expected = {
    runAsNode: [],
    node: installation.nodeShimPath,
    npmNodeExecPath: installation.nodeShimPath,
    runtime: 'electron',
    target: electronVersion,
    disturl: 'https://electronjs.org/headers',
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`pnpm lifecycle smoke returned ${JSON.stringify(actual)} instead of ${JSON.stringify(expected)}`)
  }
}

function verifyDesktopPluginInstall(stateRoot, env) {
  const home = join(stateRoot, 'home')
  const profile = join(home, 'profiles', 'desktop')
  const previousStore = join(stateRoot, 'previous-store')
  const plugin = join(stateRoot, 'fixture-plugin')
  mkdirSync(profile, { recursive: true })
  mkdirSync(plugin)
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'desktop', private: true }) + '\n')
  writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  writeFileSync(join(plugin, 'package.json'), JSON.stringify({
    name: 'desktop-cli-store-smoke', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } },
  }) + '\n')
  writeFileSync(join(plugin, 'cordis.patch.yml'), '[]\n')
  verifyResult('existing Desktop Profile store', runPnpm(env, [
    'install', '--offline', '--ignore-scripts', `--store-dir=${process.platform === 'win32' ? `"${previousStore}"` : previousStore}`,
  ], profile))
  const metadata = join(profile, 'node_modules', '.modules.yaml')
  // pnpm 11 writes JSON-compatible YAML; this is pnpm-owned metadata, not a fixture forgery.
  const before = JSON.parse(readFileSync(metadata, 'utf8')).storeDir
  runElectronEntry('installed Desktop plugin add', [], desktopCli, [
    'plugin', 'add', '--offline', '--ignore-scripts', '--save-exact', `file:${plugin}`,
  ], undefined, { ...env, DSH_HOME: home, DSH_DESKTOP_DEFAULT_PROFILE: 'desktop' })
  const after = JSON.parse(readFileSync(metadata, 'utf8')).storeDir
  if (after !== before) throw new Error('Desktop plugin install changed the existing pnpm store')
  const installed = JSON.parse(readFileSync(join(profile, 'node_modules', 'desktop-cli-store-smoke', 'package.json'), 'utf8'))
  if (installed.version !== '1.0.0') throw new Error('Desktop plugin install did not install the fixture')
}

function runPackagedPnpmShim() {
  const stateRoot = mkdtempSync(join(tmpdir(), 'sensteed-agent-pnpm-smoke-'))
  const env = cleanEnvironment()
  let installation
  try {
    installation = installDesktopPnpmRuntime({
      platform: process.platform,
      appExecutable: electronPath,
      pnpmBinPath: pnpmCli,
      electronVersion,
      stateDir: join(stateRoot, 'runtime'),
      environment: env,
    })
    assertNoRunnerEnvironment('pnpm Host PATH installation', env)
    const result = runPnpm(env, ['--version'])
    verifyResult('pnpm PATH shim', result, pnpmVersion)
    verifyLifecycleEnvironment(stateRoot, installation, env)
    verifyDesktopPluginInstall(stateRoot, env)
    assertNoRunnerEnvironment('pnpm Host PATH after child exit', env)
  } finally {
    try {
      installation?.dispose()
      assertNoRunnerEnvironment('pnpm Host PATH disposal', env)
    } finally {
      rmSync(stateRoot, { recursive: true, force: true })
    }
  }
}

function runFlatProfileDshEntry() {
  const root = mkdtempSync(join(tmpdir(), 'sensteed-agent-flat-cli-smoke-'))
  const desktopPackage = join(root, 'node_modules', 'dsh-plugin-desktop')
  try {
    mkdirSync(desktopPackage, { recursive: true })
    cpSync(fileURLToPath(new URL('lib/', packageRoot)), join(desktopPackage, 'lib'), { recursive: true })
    cpSync(fileURLToPath(new URL('package.json', packageRoot)), join(desktopPackage, 'package.json'))
    // Match the actual Desktop production dependency owner, not a stale list
    // of seven imports. Compiled shared chunks (including sealed identity's
    // zod schema) may add imports even to a non-ASAR help smoke.
    const manifest = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8'))
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      const source = realpathSync(fileURLToPath(new URL(`node_modules/${name}/`, packageRoot)))
      const installed = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
      // npm aliases intentionally have a different manifest name; ownership
      // is the declared edge and its installed link, not a global resolver.
      if (typeof installed.name !== 'string') throw new Error(`Invalid installed CLI dependency: ${name}`)
      const target = join(root, 'node_modules', name)
      mkdirSync(dirname(target), { recursive: true })
      symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir')
    }
    // dsh 0.2.0-rc.2 only manages the reserved Desktop Profile after Desktop
    // has initialized it, so give the smoke a private, initialized home.
    const home = join(root, 'home')
    const profile = join(home, 'profiles', 'desktop')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'dsh-profile-desktop', private: true }) + '\n')
    runElectronEntry(
      'flat profile dsh plugin help',
      ['--expose-internals'],
      join(desktopPackage, 'lib', 'desktop-cli.js'),
      ['plugin', '--help'],
      undefined,
      { DSH_DESKTOP_DEFAULT_PROFILE: 'desktop', DSH_HOME: home },
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

runElectronEntry('dsh', ['--expose-internals'], desktopCli, ['--version'], dshVersion)
runFlatProfileDshEntry()
runPackagedPnpmShim()
