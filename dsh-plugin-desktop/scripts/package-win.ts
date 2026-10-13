/** Build an unsigned Windows x64 artifact on a native Windows host. */

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareFsExtForElectron } from './prepare-fs-ext.ts'
import { electronBuilderEnvironment } from './electron-builder-environment.ts'
import { refreshBundledForPackaging } from './refresh-bundled-cli.ts'
import { dereferencePlatformPackageLinks, ensureHoistedPlatformPackage } from './windows-koffi-runtime.ts'

/**
 * Remove the published tarball's residual nested `node_modules/.bin` from the
 * AA bridge's installed copy in place. The dangling bin links make the Windows
 * archive walker silently drop the whole package while the dependency tree
 * itself resolves fine, so the packaged-runtime verifier then fails on a
 * missing package.json. Pruning only the nested directory keeps the pnpm
 * junction and the sibling-store resolution of `@dataiku/uv` intact.
 */
export function pruneBridgeDependencyResidue(
  desktopRoot: string,
  linkPath = 'node_modules/@agents-anywhere/dsh-bridge-next',
): void {
  const link = join(desktopRoot, linkPath)
  let real
  try {
    real = realpathSync(join(link, 'node_modules'))
  } catch {
    return
  }
  if (!real.includes(`${join('node_modules', '.pnpm')}${sep}`)) return
  rmSync(real, { recursive: true, force: true })
}

const WINDOWS_SIGNING_KEYS = [
  'CSC_IDENTITY_AUTO_DISCOVERY',
  'CSC_KEY_PASSWORD',
  'CSC_LINK',
  'CSC_NAME',
  'WIN_CSC_KEY_PASSWORD',
  'WIN_CSC_LINK',
] as const

const WINDOWS_COMPRESSION_LEVELS = new Set(['store', 'normal', 'maximum'])

/**
 * Read an optional electron-builder compression override for unsigned CI
 * artifacts. Compression dominates the Windows job while the smoke artifacts
 * are never published, so CI may select `store`; release builds leave the
 * variable unset and keep `build.win.compression`.
 * @param environment - Environment of the packaging process.
 * @returns The override, or `undefined` to keep the package configuration.
 */
export function windowsCompressionOverride(
  environment: NodeJS.ProcessEnv,
): string | undefined {
  const value = environment.DSH_WINDOWS_PACKAGE_COMPRESSION
  if (value === undefined || value === '') return undefined
  if (!WINDOWS_COMPRESSION_LEVELS.has(value)) {
    throw new Error(
      `DSH_WINDOWS_PACKAGE_COMPRESSION must be store, normal, or maximum; received ${JSON.stringify(value)}`,
    )
  }
  return value
}

/** Injectable native Windows packaging boundary used by focused tests. */
export interface WindowsPackageOptions {
  /** Environment inherited by the packaging command. */
  readonly env: NodeJS.ProcessEnv
  /** Platform executing the package build. */
  readonly platform: NodeJS.Platform
  /** Node architecture executing the package build. */
  readonly arch: string
  /** Node version executing the package build. */
  readonly nodeVersion: string
  /** Repository root containing the pnpm workspace. */
  readonly workspaceRoot: string
  /** Desktop package root containing electron-builder configuration. */
  readonly desktopRoot: string
  /** Absolute native Windows command interpreter. */
  readonly commandShell: string
  /** Absolute electron-builder CLI module. */
  readonly builderCli: string
  /** Prepare platform-specific native runtime dependencies before packaging. */
  readonly prepareRuntime: () => void
  /** Absolute packaged-installer verification script. */
  readonly verifier: string
  /** Additional per-artifact verifiers run after the shared builder pass. */
  readonly extraVerifiers?: readonly string[]
  /** Node executable used to run package-local scripts. */
  readonly nodeExecutable: string
  /** Execute one packaging command. */
  readonly run: (
    command: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
  ) => void
  /** Report non-secret packaging progress. */
  readonly log: (message: string) => void
  /** Refresh the bundled skills/plugins before the check gate. */
  readonly refreshBundled: () => void
  /** Optional JSON report used by CI to retain phase timings after the job. */
  readonly timingReportPath?: string
}

/**
 * Remove all certificate discovery and secret variables from an unsigned build.
 * @param environment - Environment that may contain Windows signing configuration.
 * @returns A copy suitable for checks and unsigned packaging.
 */
export function withoutWindowsSigningSecrets(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const sanitized = { ...environment }
  const signingKeys = new Set<string>(WINDOWS_SIGNING_KEYS)
  for (const key of Object.keys(sanitized)) {
    if (signingKeys.has(key.toUpperCase())) delete sanitized[key]
  }
  return sanitized
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): void {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
  }
}

type WindowsPackagingPhase = 'prepare-dir' | 'installer' | 'portable'

function recordPhaseTiming(
  options: WindowsPackageOptions,
  phase: WindowsPackagingPhase,
  status: 'success' | 'failed',
  startedAt: number,
): void {
  const reportPath = options.timingReportPath
  if (reportPath === undefined) return
  const finishedAt = Date.now()
  let entries: Array<Record<string, unknown>> = []
  try {
    const current = JSON.parse(readFileSync(reportPath, 'utf8'))
    if (Array.isArray(current)) entries = current
  } catch {
    // The first phase has no report yet, and a partial report must not mask a
    // packaging failure.
  }
  entries.push({
    phase,
    status,
    elapsedMs: finishedAt - startedAt,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
  })
  try {
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, `${JSON.stringify(entries, null, 2)}\n`)
  } catch (error) {
    options.log(`Unable to persist Windows packaging timing report: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function runTimedPhase(
  options: WindowsPackageOptions,
  phase: WindowsPackagingPhase,
  action: () => void,
): void {
  const startedAt = Date.now()
  if (phase === 'prepare-dir' && options.timingReportPath !== undefined) {
    rmSync(options.timingReportPath, { force: true })
  }
  options.log(`[windows-packaging] ${phase} started`)
  try {
    action()
    recordPhaseTiming(options, phase, 'success', startedAt)
    options.log(`[windows-packaging] ${phase} completed in ${Date.now() - startedAt}ms`)
  } catch (error) {
    recordPhaseTiming(options, phase, 'failed', startedAt)
    options.log(`[windows-packaging] ${phase} failed after ${Date.now() - startedAt}ms`)
    throw error
  }
}

/** Create the native packaging options for a verifier entry point. */
export function createWindowsPackageOptions(verifier = './verify-win-installer.ts'): WindowsPackageOptions {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const workspaceRoot = resolve(desktopRoot, '..')
  const require = createRequire(import.meta.url)
  const windowsRoot = process.env.SystemRoot ?? process.env.WINDIR
  return {
    env: process.env,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    workspaceRoot,
    desktopRoot,
    commandShell: windowsRoot === undefined || windowsRoot.length === 0
      ? 'cmd.exe'
      : join(windowsRoot, 'System32', 'cmd.exe'),
    builderCli: require.resolve('electron-builder/cli.js'),
    prepareRuntime: () => {
      prepareFsExtForElectron({ platform: 'win32', arch: 'x64', desktopRoot })
    },
    verifier: fileURLToPath(new URL(verifier, import.meta.url)),
    nodeExecutable: process.execPath,
    run,
    log: message => console.log(message),
    refreshBundled: () => refreshBundledForPackaging('refresh', workspaceRoot),
    timingReportPath: join(desktopRoot, 'dist', 'windows-package-timings.json'),
  }
}

/** Run the shared host and Node release gates before packaging. */
function assertWindowsPackageHost(options: WindowsPackageOptions, artifact: string): void {
  if (options.platform !== 'win32') {
    throw new Error(`Windows ${artifact} must be built on a native Windows host`)
  }
  if (options.arch !== 'x64') {
    throw new Error(`Windows ${artifact} requires x64 Node; received ${options.arch}`)
  }
  const versionMatch = /^(\d+)\.(\d+)\./u.exec(options.nodeVersion)
  const major = Number(versionMatch?.[1])
  const minor = Number(versionMatch?.[2])
  if (!((major === 22 && minor >= 19) || major >= 24)) {
    throw new Error(
      `Windows ${artifact} requires Node 22.19+ or Node 24+ with bundled Corepack; received ${options.nodeVersion}`,
    )
  }
}

function builderEnvironment(cleanEnvironment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const debugNamespaces = new Set(
    (cleanEnvironment.DEBUG ?? '').split(',').map(value => value.trim()).filter(Boolean),
  )
  debugNamespaces.add('electron-builder')
  return electronBuilderEnvironment({
    ...cleanEnvironment,
    DEBUG: [...debugNamespaces].join(','),
    DSH_ELECTRON_BUILDER_TARGET_PLATFORM: 'win32',
    DSH_ELECTRON_BUILDER_TARGET_ARCH: 'x64',
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    // Traverse the installed tree directly: package-manager graph collection can
    // stall on the large linked workspace and pnpm v11 drops deduplicated links.
    // Keep the real pnpm identity so the archive contains the dependency payload.
    DSH_ELECTRON_BUILDER_TRAVERSAL_ONLY: '1',
  })
}

function runBuilder(
  options: WindowsPackageOptions,
  cleanEnvironment: NodeJS.ProcessEnv,
  target: 'dir' | 'nsis' | 'zip',
  prepackagedDir?: string,
): void {
  const compression = windowsCompressionOverride(options.env)
  const targetCompression = target === 'dir' ? undefined : compression
  options.run(
    options.nodeExecutable,
    [
      options.builderCli,
      '--config',
      'electron-builder.json',
      '--win',
      target,
      '--x64',
      '--publish',
      'never',
      '--config.win.signExecutable=false',
      '--config.npmRebuild=false',
      '--config.electronFuses.onlyLoadAppFromAsar=false',
      ...(prepackagedDir === undefined ? [] : ['--prepackaged', prepackagedDir]),
      ...(targetCompression === undefined ? [] : [`--config.win.compression=${targetCompression}`]),
    ],
    options.desktopRoot,
    builderEnvironment(cleanEnvironment),
  )
}

function prepareWindowsPackage(options: WindowsPackageOptions): void {
  assertWindowsPackageHost(options, 'packaging')
  const cleanEnvironment = withoutWindowsSigningSecrets(options.env)
  options.log('Preparing an unsigned Windows x64 packaged directory; Authenticode is a separate release step.')
  if (options.env.DSH_PACKAGE_CHECK_ALREADY_RAN !== '1') {
    options.refreshBundled()
    options.run(
      options.commandShell,
      ['/d', '/s', '/c', 'corepack pnpm --filter dsh-plugin-desktop check:win-package'],
      options.workspaceRoot,
      cleanEnvironment,
    )
  } else {
    options.log('Skipping the Windows package preflight; the package gate already passed.')
  }
  options.prepareRuntime()
  pruneBridgeDependencyResidue(options.desktopRoot)
  const materializeStartedAt = Date.now()
  const dereferenced = dereferencePlatformPackageLinks({ modulesRoot: join(options.desktopRoot, 'node_modules') })
  const hoisted = ensureHoistedPlatformPackage({ desktopRoot: options.desktopRoot, packageName: '@deepseek-ai/libreoffice-kit-win32-x64' })
  options.log(`platform package materialization: ${dereferenced} link(s) dereferenced, libreoffice kit ${hoisted}, took ${Date.now() - materializeStartedAt}ms`)
  runBuilder(options, cleanEnvironment, 'dir')
}

function packagePreparedWindowsArtifact(
  options: WindowsPackageOptions,
  target: 'nsis' | 'zip',
  artifact: 'installer' | 'portable archive',
  verifier: string,
): void {
  assertWindowsPackageHost(options, artifact)
  const cleanEnvironment = withoutWindowsSigningSecrets(options.env)
  const compression = windowsCompressionOverride(options.env)
  options.log(`Building an unsigned Windows x64 ${artifact} from the prepared directory; Authenticode is a separate release step.`)
  if (compression !== undefined && target === 'zip') options.log(`Packaging the ${artifact} with ${compression} compression.`)
  const prepackagedDir = join(options.desktopRoot, 'dist', 'win-unpacked')
  runBuilder(options, cleanEnvironment, target, prepackagedDir)
  options.run(options.nodeExecutable, [verifier], options.desktopRoot, cleanEnvironment)
}

/** Run the gates and package unsigned x64 Windows artifacts. */
export function packageWindowsArtifacts(
  options: WindowsPackageOptions,
  targets: readonly ('nsis' | 'zip')[],
  artifacts: readonly ('installer' | 'portable archive')[],
): void {
  windowsCompressionOverride(options.env)
  prepareWindowsPackage(options)
  targets.forEach((target, index) => {
    const artifact = artifacts[index] ?? (target === 'nsis' ? 'installer' : 'portable archive')
    const verifier = target === 'nsis' ? options.verifier : (options.extraVerifiers?.[0] ?? options.verifier)
    packagePreparedWindowsArtifact(options, target, artifact, verifier)
  })
}

export function prepareWindowsDirectory(options: WindowsPackageOptions = createWindowsPackageOptions()): void {
  runTimedPhase(options, 'prepare-dir', () => prepareWindowsPackage(options))
}

export function packagePreparedWindowsInstaller(options: WindowsPackageOptions = createWindowsPackageOptions()): void {
  runTimedPhase(options, 'installer', () => packagePreparedWindowsArtifact(options, 'nsis', 'installer', options.verifier))
}

export function packagePreparedWindowsPortable(options: WindowsPackageOptions = {
  ...createWindowsPackageOptions('./verify-win-portable.ts'),
}): void {
  runTimedPhase(options, 'portable', () => packagePreparedWindowsArtifact(options, 'zip', 'portable archive', options.verifier))
}

/** Run the gates and package one unsigned x64 Windows artifact. */
export function packageWindowsArtifact(
  options: WindowsPackageOptions,
  target: 'nsis' | 'zip',
  artifact: 'installer' | 'portable archive',
): void {
  packageWindowsArtifacts(options, [target], [artifact])
}

/** Run the headless release gates and package one unsigned x64 NSIS installer. */
export function packageWindowsInstaller(
  options: WindowsPackageOptions = createWindowsPackageOptions(),
): void {
  packageWindowsArtifact(options, 'nsis', 'installer')
}

/**
 * Run the gates once and package both unsigned x64 Windows artifacts in a
 * shared preparation followed by separate prepackaged target passes. The
 * dependency collection and ASAR packing dominate the job wall clock, so they
 * run once while installer and portable packaging remain independently visible.
 */
export function packageWindowsBundle(
  options: WindowsPackageOptions = {
    ...createWindowsPackageOptions('./verify-win-installer.ts'),
    extraVerifiers: [fileURLToPath(new URL('./verify-win-portable.ts', import.meta.url))],
  },
): void {
  packageWindowsArtifacts(options, ['nsis', 'zip'], ['installer', 'portable archive'])
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--prepare')) prepareWindowsDirectory()
    else if (process.argv.includes('--installer')) packagePreparedWindowsInstaller()
    else if (process.argv.includes('--portable')) packagePreparedWindowsPortable()
    else if (process.argv.includes('--bundle')) packageWindowsBundle()
    else packageWindowsInstaller()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
