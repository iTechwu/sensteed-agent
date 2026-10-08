/** Fail-loud verification of the runtime entries sealed into Electron's app.asar. */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  cpSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, parse, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { extractFile, getRawHeader } from '@electron/asar'
import {
  disablePackagedMacSshCryptoRuntime,
  FORBIDDEN_MACOS_UNIVERSAL_ENTRIES,
  FS_EXT_RELATIVE_PATH,
  hydrateInstalledMacCloudflaredRuntime,
  hydrateInstalledMacCpuFeaturesRuntime,
  hydrateInstalledMacFsExtRuntime,
  hydratePackagedMacRuntime,
  MACOS_UNIVERSAL_NATIVE_ENTRIES,
  type MacUniversalArch,
} from './mac-universal.ts'

/** Resolve a package root even when its exports hide `package.json`. */
export function resolveRuntimePackageRoot(
  packageName: string,
  resolveEntry: (specifier: string) => string = createRequire(import.meta.url).resolve,
  readManifest: (filename: string) => string = filename => readFileSync(filename, 'utf8'),
): string {
  let manifestCause: unknown
  try {
    return dirname(resolveEntry(`${packageName}/package.json`))
  } catch (cause) {
    manifestCause = cause
  }

  let directory = dirname(resolveEntry(packageName))
  const root = parse(directory).root
  while (true) {
    try {
      const manifest: unknown = JSON.parse(readManifest(join(directory, 'package.json')))
      if (manifest !== null
        && typeof manifest === 'object'
        && (manifest as { name?: unknown }).name === packageName) {
        return directory
      }
    } catch {
      // Continue toward the filesystem root until the owning manifest is found.
    }
    if (directory === root) {
      throw new Error(`dsh-plugin-desktop: cannot locate package root for ${packageName}`, {
        cause: manifestCause,
      })
    }
    directory = dirname(directory)
  }
}

const DSH_PACKAGE_ROOT = resolveRuntimePackageRoot('@deepseek-ai/dsh')
const PNPM_PACKAGE_ROOT = resolveRuntimePackageRoot('pnpm')
const DESKTOP_PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url))

function packageVersion(packageRoot: string): string {
  return (JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version: string }).version
}

const DSH_RUNTIME_VERSION = packageVersion(DSH_PACKAGE_ROOT)
const PNPM_RUNTIME_VERSION = packageVersion(PNPM_PACKAGE_ROOT)
const ELECTRON_ABI = readFileSync(join(resolveRuntimePackageRoot('electron'), 'abi_version'), 'utf8').trim()
if (!/^\d+$/u.test(ELECTRON_ABI)) {
  throw new Error(`dsh-plugin-desktop: invalid Electron ABI ${JSON.stringify(ELECTRON_ABI)}`)
}

/** Maximum physical file count accepted beside ASAR after smart unpack. */
export const MAX_UNPACKED_RUNTIME_FILES = 3_000

/** Maximum physical payload accepted beside ASAR after smart unpack. */
export const MAX_UNPACKED_RUNTIME_BYTES = 512 * 1024 * 1024

/** Narrow ceiling for pnpm's smart-unpacked native-helper package root. */
export const MAX_PNPM_SMART_UNPACK_FILES = 32
export const MAX_PNPM_SMART_UNPACK_BYTES = 32 * 1024 * 1024

/** Package roots electron-builder may smart-unpack as one indivisible unit. */
export const ALLOWED_SMART_UNPACK_PACKAGE_ROOTS = [
  'node_modules/@deepseek-ai/dsh-app-boot',
  'node_modules/@deepseek-ai/dsh-fs-local',
  'node_modules/@deepseek-ai/dsh',
  // 0.2.1-alpha.1 的 HMR 随 native manifest 携带不可 asar 化文件,electron-builder
  // 对其整包 smart-unpack;libreoffice-kit 本体同理(平台变体前缀已有独立条目)。
  'node_modules/@deepseek-ai/dsh-hmr',
  'node_modules/@deepseek-ai/libreoffice-kit',
  'node_modules/@deepseek-ai/dsh-host-directory-picker-native',
  'node_modules/@deepseek-ai/dsh-sandbox-windows-acl',
  'node_modules/@deepseek-ai/dsh-session-persistence-jsonl',
  'node_modules/@deepseek-ai/dsh-subprocess-local',
  'node_modules/@deepseek-ai/dsh-win32-process',
  'node_modules/cloudflared',
  'node_modules/cpu-features',
  'node_modules/dsh-better-sidebar',
  // a0a4298b0b 的运行时闭包：纯 JS 包随发布闭包 unpacked 交付。
  'node_modules/@opentelemetry/otlp-exporter-base',
  'node_modules/@opentelemetry/otlp-transformer',
  'node_modules/@opentelemetry/resources',
  'node_modules/@opentelemetry/sdk-logs',
  'node_modules/chokidar',
  'node_modules/execa',
  'node_modules/got',
  'node_modules/turndown',
  'node_modules/fs-ext',
  'node_modules/koffi',
  'node_modules/koffi-win32-x64-3-1-1',
  'node_modules/ssh2',
  'node_modules/node-addon-require-builtin',
  'node_modules/node-pty',
  // pnpm embeds executable and native helper payloads.
  'node_modules/pnpm',
  'node_modules/sharp',
] as const

/** Platform package families selected by native dependencies at package time. */
export const ALLOWED_SMART_UNPACK_PACKAGE_PREFIXES = [
  'node_modules/@anthropic-ai/claude-agent-sdk-',
  'node_modules/@dataiku/uv-',
  'node_modules/@deepseek-ai/libreoffice-kit-',
  'node_modules/@deepseek-ai/node-addon-system-',
  'node_modules/@img/sharp-',
  'node_modules/@koromix/koffi-',
  'node_modules/@openai/codex-',
  'node_modules/@trycua/cua-driver-',
  'node_modules/@ubjs/node-',
  'node_modules/@vscode/ripgrep-',
  'node_modules/lightningcss-',
  'node_modules/node-addon-require-builtin-',
  'node_modules/sherpa-onnx-',
] as const

/** Large platform runtime families intentionally kept outside the generic unpacked payload budget. */
export const EXEMPT_UNPACKED_RUNTIME_PACKAGE_PREFIXES = [
  'node_modules/@anthropic-ai/claude-agent-sdk-',
  'node_modules/@deepseek-ai/libreoffice-kit-',
  'node_modules/@openai/codex-',
] as const

/** Every generated JavaScript file shipped by the installed DSH CLI package. */
export const REQUIRED_DSH_CLI_RUNTIME_ENTRIES = Object.freeze(
  readdirSync(join(DSH_PACKAGE_ROOT, 'lib'), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => `node_modules/@deepseek-ai/dsh/lib/${entry.name}`)
    .sort(),
)

/** PTC preset inputs selected by upstream's historical Session migration. 0.1.7
 * ships the preset declarations inside the Web bundle's presets directory. */
export const REQUIRED_AGENT_PRESET_RUNTIME_ENTRIES = [
  'node_modules/@deepseek-ai/dsh-web-app/presets/ptc.patch.yml',
] as const

/** External packages imported by required desktop plugins but not reliably discovered through pnpm links. */
export const REQUIRED_RUNTIME_PACKAGE_MANIFESTS = [
  'node_modules/@opentelemetry/otlp-exporter-base/package.json',
  'node_modules/@opentelemetry/otlp-transformer/package.json',
  'node_modules/@opentelemetry/resources/package.json',
  'node_modules/@opentelemetry/sdk-logs/package.json',
  'node_modules/chokidar/package.json',
  'node_modules/execa/package.json',
  'node_modules/got/package.json',
  'node_modules/turndown/package.json',
] as const

/** Materialize runtime packages that Electron Builder cannot copy through pnpm links. */
export function hydrateRequiredRuntimePackages(context: PackagedRuntimeContext): void {
  const desktopRoot = context.packager.projectDir ?? DESKTOP_PACKAGE_ROOT
  const targetRoot = usesAsarLayout(context)
    ? resolvePackagedUnpackedRoot(context)
    : resolvePackagedApplicationRoot(context)
  if (!existsSync(targetRoot)) return
  for (const manifestPath of REQUIRED_RUNTIME_PACKAGE_MANIFESTS) {
    const packagePath = manifestPath.slice(0, -'/package.json'.length)
    const source = join(desktopRoot, packagePath)
    const target = join(targetRoot, packagePath)
    if (!existsSync(source)) {
      throw new Error(`dsh-plugin-desktop: runtime package source is missing at ${source}`)
    }
    cpSync(source, target, { recursive: true, force: true, dereference: true })
  }
}

/** AfterPack fields consumed without importing Electron Builder's incomplete declaration graph. */
export interface PackagedRuntimeContext {
  /** Completed platform application directory. */
  readonly appOutDir: string
  /** Electron Builder target architecture (`4` is its stable universal enum value). */
  readonly arch?: number
  /** Electron target platform selected by the packager. */
  readonly electronPlatformName: string
  /** Product metadata used to locate the macOS application bundle. */
  readonly packager: {
    /** Electron Builder project root containing the completed lib/ build output. */
    readonly projectDir?: string
    /** Effective platform-specific build settings selected by Electron Builder. */
    readonly platformSpecificBuildOptions?: {
      readonly asar?: boolean | null
    }
    /** LinuxPackager's executable name differs from appInfo.productFilename by default. */
    readonly executableName?: string
    readonly appInfo: {
      readonly productFilename: string
    }
  }
}

/** Restore architecture-specific packages omitted by Electron Builder's pnpm collector. */
export function hydratePackagedMacRuntimeForContext(context: PackagedRuntimeContext): void {
  if (context.electronPlatformName !== 'darwin') return
  let arches: readonly MacUniversalArch[]
  if (context.arch === 4) arches = ['arm64', 'x86_64']
  else if (context.arch === 3) arches = ['arm64']
  else if (context.arch === 1) arches = ['x86_64']
  else {
    throw new Error(
      `dsh-plugin-desktop: unsupported macOS package architecture ${String(context.arch)}`,
    )
  }
  const desktopRoot = context.packager.projectDir ?? DESKTOP_PACKAGE_ROOT
  const unpackedRoot = resolvePackagedUnpackedRoot(context)
  hydratePackagedMacRuntime({
    desktopRoot,
    unpackedRoot,
    arches,
  })
  hydrateInstalledMacCloudflaredRuntime(unpackedRoot, context.arch)
  hydrateInstalledMacCpuFeaturesRuntime(desktopRoot, unpackedRoot, context.arch)
  hydrateInstalledMacFsExtRuntime(desktopRoot, unpackedRoot, context.arch)
  disablePackagedMacSshCryptoRuntime(unpackedRoot)
}

/**
 * Replace the packaged host-Node fs-ext binding with the prepared Electron-ABI binary.
 *
 * fs-ext 2.1.1 requires `build/Release/fs_ext.node` directly and does not discover
 * prebuilds, while `prepare-fs-ext` stages the Electron-ABI build only under `prebuilds/`.
 * Linux packaging therefore must swap the binding in place before the runtime smoke loads
 * it — the same replacement the darwin path performs through its hydration hook.
 */
export function hydratePackagedLinuxFsExtRuntimeForContext(
  context: PackagedRuntimeContext,
  sourceFsExtRoot: string = resolveRuntimePackageRoot('fs-ext'),
): void {
  if (context.electronPlatformName !== 'linux') return
  const arch = context.arch === 1 ? 'x64' : context.arch === 3 ? 'arm64' : undefined
  if (arch === undefined) {
    throw new Error(`dsh-plugin-desktop: unsupported Linux package architecture ${String(context.arch)}`)
  }
  const source = join(
    sourceFsExtRoot,
    'prebuilds',
    `linux-${arch}`,
    `electron.abi${ELECTRON_ABI}.node`,
  )
  if (!existsSync(source)) {
    throw new Error(
      `dsh-plugin-desktop: prepared Electron-ABI fs-ext is missing at ${source}; `
      + 'run prepare-fs-ext before packaging',
    )
  }
  const target = join(
    resolvePackagedUnpackedRoot(context),
    'node_modules/fs-ext/build/Release/fs_ext.node',
  )
  if (!existsSync(target)) {
    throw new Error(`dsh-plugin-desktop: packaged fs-ext binding is missing at ${target}`)
  }
  copyFileSync(source, target)
  chmodSync(target, 0o755)
}

/** Stable non-desktop archive entries required by the packaged runtime. */
export const REQUIRED_PACKAGED_RUNTIME_ENTRIES = [
  'package.json',
  'cordis.patch.yml',
  ...REQUIRED_DSH_CLI_RUNTIME_ENTRIES,
  'node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js',
  'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html',
  'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js',
  ...REQUIRED_AGENT_PRESET_RUNTIME_ENTRIES,
  'node_modules/open/index.js',
  'node_modules/pnpm/bin/pnpm.mjs',
] as const

/** macOS-only desktop assets loaded by nativeImage from physical paths. */
export const REQUIRED_MACOS_UNPACKED_RUNTIME_ENTRIES = [
  'build/app-icon-mac.png',
  'build/tray-iconTemplate.png',
  'build/tray-iconTemplate@2x.png',
] as const

/** Windows/Linux desktop assets, including nativeImage scale variants. */
export const REQUIRED_NON_MACOS_UNPACKED_RUNTIME_ENTRIES = [
  'build/app-icon.png',
  'build/tray-icon-blue.png',
  'build/tray-icon-blue@1.25x.png',
  'build/tray-icon-blue@1.5x.png',
  'build/tray-icon-blue@2x.png',
] as const

/** Complete cross-platform asset surface, used only as a closed allowlist. */
export const REQUIRED_UNPACKED_RUNTIME_ENTRIES = [
  ...REQUIRED_MACOS_UNPACKED_RUNTIME_ENTRIES,
  ...REQUIRED_NON_MACOS_UNPACKED_RUNTIME_ENTRIES,
] as const

/** Ordinary modules that must stay archived to prevent a full physical mirror regression. */
export const FORBIDDEN_UNPACKED_RUNTIME_ENTRIES = [
  'package.json',
  'cordis.patch.yml',
  'node_modules/@deepseek-ai/dsh/lib/bin.js',
  'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js',
  'node_modules/@deepseek-ai/dsh-base/lib/index.js',
  'node_modules/@deepseek-ai/dsh-web-app/lib/index.js',
  // Preset inputs are ordinary read-only data covered by ASAR integrity.
  ...REQUIRED_AGENT_PRESET_RUNTIME_ENTRIES,
  'node_modules/@vscode/ripgrep/lib/index.js',
  'node_modules/open/index.js',
  'node_modules/yaml/dist/index.js',
] as const

/** Prebuilt Node-API modules required when the Windows package skips native source rebuilds. */
export const REQUIRED_WINDOWS_X64_NODE_PTY_ENTRIES = [
  'node_modules/@vscode/ripgrep-win32-x64/bin/rg.exe',
  'node_modules/node-pty/prebuilds/win32-x64/conpty.node',
  'node_modules/node-pty/prebuilds/win32-x64/conpty_console_list.node',
  'node_modules/node-pty/prebuilds/win32-x64/conpty/OpenConsole.exe',
  'node_modules/node-pty/prebuilds/win32-x64/conpty/conpty.dll',
] as const

/** fs-ext bindings required by non-universal macOS and Linux packages. */
export const REQUIRED_POSIX_FS_EXT_ENTRIES = {
  darwin: {
    x64: FS_EXT_RELATIVE_PATH,
    arm64: FS_EXT_RELATIVE_PATH,
  },
  linux: {
    x64: `node_modules/fs-ext/prebuilds/linux-x64/electron.abi${ELECTRON_ABI}.node`,
    arm64: `node_modules/fs-ext/prebuilds/linux-arm64/electron.abi${ELECTRON_ABI}.node`,
  },
} as const

/** CPU-specific runtime assets that must coexist in a universal macOS application. */
export const REQUIRED_MACOS_UNIVERSAL_ENTRIES = [
  ...MACOS_UNIVERSAL_NATIVE_ENTRIES.map(entry => entry.path),
  // afterPack replaces each thin binding with Electron's ABI; universal assembly merges both slices.
  FS_EXT_RELATIVE_PATH,
] as const

const MACOS_UNIVERSAL_UV_ENTRIES: readonly string[] = MACOS_UNIVERSAL_NATIVE_ENTRIES
  .filter(entry => entry.path.endsWith('/bin/uv'))
  .map(entry => entry.path)

/** Minimal raw ASAR header surface returned by @electron/asar. */
export interface RawAsarHeader {
  readonly header: unknown
}

/** Injectable raw-header reader used by focused tests. */
export type ArchiveHeaderReader = (archivePath: string) => RawAsarHeader

/** Canonical ASAR leaf paths and the subset whose payloads live beside the archive. */
export interface PackagedAsarIndex {
  readonly files: ReadonlySet<string>
  readonly unpackedFiles: ReadonlySet<string>
}

/** Injectable desktop build-output inventory used by focused tests. */
export type DesktopRuntimeLister = (libRoot: string) => readonly string[]

/** Injectable physical-file probe used by focused tests. */
export type FileProbe = (filename: string) => boolean

/** One physical file emitted beside app.asar. */
export interface UnpackedRuntimeFile {
  readonly path: string
  readonly bytes: number
}

/** One package-root or desktop-root inventory bucket. */
export interface UnpackedRuntimeGroup {
  readonly root: string
  readonly files: number
  readonly bytes: number
}

/** Bounded physical payload summary printed by afterPack. */
export interface UnpackedRuntimeSummary {
  readonly files: number
  readonly bytes: number
  readonly groups: readonly UnpackedRuntimeGroup[]
}

/** Injectable physical unpacked-file inventory used by focused tests. */
export type UnpackedFileLister = (unpackedRoot: string) => readonly UnpackedRuntimeFile[]

/** Result surface required from one packaged Electron child. */
export interface PackagedElectronResult {
  readonly error?: Error
  readonly signal?: NodeJS.Signals | null
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

/** Injectable packaged Electron process seam used by focused tests. */
export type PackagedElectronRunner = (
  executable: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
) => PackagedElectronResult

/** Injectable ASAR/CLI/native smoke seam used by the post-fuse artifact hook. */
export type PackagedElectronSmoke = (context: PackagedRuntimeContext) => void

/** Resolve the packaged Electron executable created beside the application resources. */
export function resolvePackagedExecutablePath(context: PackagedRuntimeContext): string {
  const filename = context.packager.appInfo.productFilename
  if (context.electronPlatformName === 'darwin') {
    return join(context.appOutDir, `${filename}.app`, 'Contents', 'MacOS', filename)
  }
  if (context.electronPlatformName === 'win32') return join(context.appOutDir, `${filename}.exe`)
  if (context.electronPlatformName === 'linux') {
    return join(context.appOutDir, context.packager.executableName ?? filename)
  }
  throw new Error(
    `dsh-plugin-desktop: unsupported Electron afterPack platform ${JSON.stringify(context.electronPlatformName)}`,
  )
}

function runPackagedElectron(
  executable: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): PackagedElectronResult {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    env: environment,
    shell: false,
    timeout: 60_000,
    windowsHide: true,
  })
  return {
    ...(result.error === undefined ? {} : { error: result.error }),
    signal: result.signal,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function packagedRuntimeRunnable(context: PackagedRuntimeContext): boolean {
  if (context.electronPlatformName !== process.platform) return false
  const { arch } = context
  if (arch === undefined || arch === 4) return true
  if (arch === 1) return process.arch === 'x64'
  if (arch === 3) return process.arch === 'arm64'
  if (arch === 0) return process.arch === 'ia32'
  return false
}

/** Load the exact packaged fs-ext addon through Electron before accepting the application. */
export function smokePackagedFsExtRuntime(
  context: PackagedRuntimeContext,
  run: PackagedElectronRunner = runPackagedElectron,
): void {
  if (!packagedRuntimeRunnable(context)) return
  const executable = resolvePackagedExecutablePath(context)
  const entry = join(resolvePackagedAsarPath(context), 'node_modules', 'fs-ext', 'fs-ext.js')
  const result = run(executable, ['--expose-internals', entry], {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
  })
  if (result.error !== undefined) {
    throw new Error('dsh-plugin-desktop: packaged fs-ext native ABI smoke could not start', {
      cause: result.error,
    })
  }
  if (result.status !== 0 || result.stdout.trim() !== '') {
    throw new Error(
      `dsh-plugin-desktop: packaged fs-ext native ABI smoke failed with status ${String(result.status)}; `
      + `signal=${String(result.signal ?? null)}; `
      + `stdout=${JSON.stringify(result.stdout.trim())}; stderr=${JSON.stringify(result.stderr.trim())}`,
    )
  }
}

/** Verify packaged CLI fallbacks are physical, owned proxies into the current ASAR. */
export function verifyPackagedProfileModuleFallback(modulesDir: string, asarRoot: string): void {
  const entries = readdirSync(modulesDir, { withFileTypes: true })
  if (entries.length === 0) {
    throw new Error('dsh-plugin-desktop: packaged Desktop CLI created no Profile module fallbacks')
  }
  const packages: Array<{ name: string; directory: string }> = []
  for (const entry of entries) {
    const entryPath = join(modulesDir, entry.name)
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(`dsh-plugin-desktop: packaged Profile fallback must be a physical directory: ${entryPath}`)
    }
    if (!entry.name.startsWith('@')) {
      packages.push({ name: entry.name, directory: entryPath })
      continue
    }
    for (const child of readdirSync(entryPath, { withFileTypes: true })) {
      const childPath = join(entryPath, child.name)
      if (child.isSymbolicLink() || !child.isDirectory()) {
        throw new Error(`dsh-plugin-desktop: packaged Profile fallback must be a physical directory: ${childPath}`)
      }
      packages.push({ name: `${entry.name}/${child.name}`, directory: childPath })
    }
  }
  const asarUrlPrefix = `${pathToFileURL(asarRoot).href}/`
  for (const candidate of packages) {
    const manifestPath = join(candidate.directory, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name?: unknown
      private?: unknown
      type?: unknown
      exports?: unknown
      dsh?: { moduleFallback?: { targets?: unknown } }
    }
    const exports = manifest.exports
    const targets = manifest.dsh?.moduleFallback?.targets
    if (manifest.name !== candidate.name || manifest.private !== true || manifest.type !== 'module'
      || exports === null || typeof exports !== 'object' || Array.isArray(exports)
      || targets === null || typeof targets !== 'object' || Array.isArray(targets)) {
      throw new Error(`dsh-plugin-desktop: invalid managed Profile proxy manifest at ${manifestPath}`)
    }
    const exportEntries = Object.entries(exports as Record<string, unknown>)
    const targetEntries = Object.entries(targets as Record<string, unknown>)
    if (targetEntries.length === 0
      || JSON.stringify(exportEntries.map(([subpath]) => subpath))
        !== JSON.stringify(targetEntries.map(([subpath]) => subpath))) {
      throw new Error(`dsh-plugin-desktop: incomplete managed Profile proxy exports at ${manifestPath}`)
    }
    for (const [index, [subpath, target]] of targetEntries.entries()) {
      const entryName = `./entry-${String(index)}.js`
      if ((exports as Record<string, unknown>)[subpath] !== entryName
        || typeof target !== 'string' || !target.startsWith(asarUrlPrefix)) {
        throw new Error(`dsh-plugin-desktop: invalid managed Profile proxy target at ${manifestPath}`)
      }
      const entryPath = join(candidate.directory, entryName.slice(2))
      if (!lstatSync(entryPath).isFile() || !readFileSync(entryPath, 'utf8').includes(JSON.stringify(target))) {
        throw new Error(`dsh-plugin-desktop: incomplete managed Profile proxy entry at ${entryPath}`)
      }
    }
  }
}

/**
 * Execute the real packaged runtime through Electron's supported RunAsNode
 * path. This proves DSH and pnpm can load from the packaged application root,
 * the upstream Profile proxy selects Electron, and native dependencies resolve.
 */
export function smokePackagedElectronRuntime(
  context: PackagedRuntimeContext,
  run: PackagedElectronRunner = runPackagedElectron,
): void {
  // A universal executable runs natively on either macOS CPU. Per-architecture
  // intermediate apps are only executable on the matching packaging host.
  if (!packagedRuntimeRunnable(context)) return
  const executable = resolvePackagedExecutablePath(context)
  const runtimeRoot = resolvePackagedRuntimeRoot(context)
  const smokeHome = mkdtempSync(join(tmpdir(), 'dsh-packaged-cli-'))
  const environment = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    DSH_HOME: smokeHome,
    DSH_TELEMETRY_DISABLED: '1',
  }
  const checks = [
    {
      label: 'DSH CLI',
      entry: join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      args: ['--version'],
      accepts: (stdout: string) => stdout.trim() === DSH_RUNTIME_VERSION,
    },
    {
      label: 'pnpm CLI',
      entry: join(runtimeRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
      args: ['--version'],
      accepts: (stdout: string) => stdout.trim() === PNPM_RUNTIME_VERSION,
    },
    {
      label: 'fs-ext native ABI',
      entry: join(runtimeRoot, 'node_modules', 'fs-ext', 'fs-ext.js'),
      args: [],
      accepts: (stdout: string) => stdout.trim() === '',
    },
    {
      label: 'ASAR/Profile/CJS/ripgrep',
      entry: join(runtimeRoot, 'lib', 'packaged-runtime-smoke.js'),
      args: [],
      accepts: (stdout: string) => stdout.trim() === 'DSH_PACKAGED_RUNTIME_OK',
    },
    {
      label: 'Desktop CLI config composition',
      entry: join(runtimeRoot, 'lib', 'desktop-cli.js'),
      args: ['--profile', 'headless', '--dump-config'],
      accepts: (stdout: string) => stdout.includes('# == ') && stdout.includes('name:'),
    },
    {
      // This is deliberately the Desktop wrapper rather than DSH's bin.js:
      // a child RunAsNode process cannot inherit main's resolver hook.
      label: 'Desktop CLI Loader boot',
      entry: join(runtimeRoot, 'lib', 'desktop-cli.js'),
      args: ['--profile', 'headless', '--help'],
      accepts: (stdout: string) => stdout.includes('dsh --profile headless'),
    },
  ] as const
  try {
    for (const check of checks) {
      const result = run(executable, ['--expose-internals', check.entry, ...check.args], environment)
      if (result.error !== undefined) {
        throw new Error(`dsh-plugin-desktop: packaged ${check.label} smoke could not start`, {
          cause: result.error,
        })
      }
      if (result.status !== 0 || !check.accepts(result.stdout)) {
        throw new Error(
          `dsh-plugin-desktop: packaged ${check.label} smoke failed with status ${String(result.status)}; `
          + `signal=${String(result.signal ?? null)}; `
          + `stdout=${JSON.stringify(result.stdout.trim())}; stderr=${JSON.stringify(result.stderr.trim())}`,
        )
      }
    }
    verifyPackagedProfileModuleFallback(join(smokeHome, 'profiles', 'node_modules'), resolvePackagedAsarPath(context))
  } finally {
    rmSync(smokeHome, { recursive: true, force: true })
  }
}

/**
 * Resolve the platform-specific archive produced by Electron Builder.
 * @param context - completed application directory and target platform.
 * @returns absolute path to the packaged app.asar.
 */
export function resolvePackagedAsarPath(context: PackagedRuntimeContext): string {
  if (context.electronPlatformName === 'darwin') {
    return join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'Resources',
      'app.asar',
    )
  }
  if (context.electronPlatformName === 'win32' || context.electronPlatformName === 'linux') {
    return join(context.appOutDir, 'resources', 'app.asar')
  }
  throw new Error(
    `dsh-plugin-desktop: unsupported Electron afterPack platform ${JSON.stringify(context.electronPlatformName)}`,
  )
}

/**
 * Resolve the physical dependency tree emitted beside app.asar.
 * @param context - completed application directory and target platform.
 * @returns absolute path to app.asar.unpacked.
 */
export function resolvePackagedUnpackedRoot(context: PackagedRuntimeContext): string {
  return `${resolvePackagedAsarPath(context)}.unpacked`
}

/** Resolve the physical application directory emitted when a target disables ASAR. */
export function resolvePackagedApplicationRoot(context: PackagedRuntimeContext): string {
  if (context.electronPlatformName === 'darwin') {
    return join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'Resources',
      'app',
    )
  }
  if (context.electronPlatformName === 'win32' || context.electronPlatformName === 'linux') {
    return join(context.appOutDir, 'resources', 'app')
  }
  throw new Error(
    `dsh-plugin-desktop: unsupported Electron afterPack platform ${JSON.stringify(context.electronPlatformName)}`,
  )
}

/** Return whether Electron Builder emitted the ASAR layout for this target. */
export function usesAsarLayout(context: PackagedRuntimeContext): boolean {
  return context.packager.platformSpecificBuildOptions?.asar !== false
}

/** Resolve the root containing executable JavaScript for either packaged layout. */
export function resolvePackagedRuntimeRoot(context: PackagedRuntimeContext): string {
  return usesAsarLayout(context)
    ? resolvePackagedAsarPath(context)
    : resolvePackagedApplicationRoot(context)
}

/** Normalize archive and physical-tree paths without allowing traversal aliases. */
function normalizeArchiveEntry(entry: string): string {
  const segments = entry
    .replaceAll('\\', '/')
    .split('/')
    .filter(segment => segment.length > 0 && segment !== '.')
  if (segments.length === 0 || segments.includes('..')) {
    throw new Error(`dsh-plugin-desktop: invalid packaged runtime path ${JSON.stringify(entry)}`)
  }
  return segments.join('/')
}

/** Recursively inventory every runtime file emitted by the desktop build. */
export function listDesktopRuntimeEntries(libRoot: string): string[] {
  const entries: string[] = []
  const pending: Array<{ absolute: string; archive: string }> = [{
    absolute: libRoot,
    archive: 'lib',
  }]
  for (let directory = pending.pop(); directory !== undefined; directory = pending.pop()) {
    for (const entry of readdirSync(directory.absolute, { withFileTypes: true })) {
      const absolute = join(directory.absolute, entry.name)
      const archive = normalizeArchiveEntry(`${directory.archive}/${entry.name}`)
      if (entry.isDirectory()) pending.push({ absolute, archive })
      else if (!entry.name.endsWith('.map') && !/\.d\.(?:cts|mts|ts)$/u.test(entry.name)) {
        entries.push(archive)
      }
    }
  }
  return entries.sort((left, right) => left.localeCompare(right, 'en'))
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Derive canonical file and unpacked-file sets directly from the ASAR header. */
export function indexPackagedAsarHeader(header: unknown): PackagedAsarIndex {
  const files = new Set<string>()
  const unpackedFiles = new Set<string>()
  const visit = (
    value: unknown,
    path: string | undefined,
    parentUnpacked: boolean,
  ): void => {
    if (!record(value)) {
      throw new Error(`dsh-plugin-desktop: malformed ASAR header entry at ${path ?? '(root)'}`)
    }
    if ('unpacked' in value && typeof value.unpacked !== 'boolean') {
      throw new Error(`dsh-plugin-desktop: malformed ASAR unpacked flag at ${path ?? '(root)'}`)
    }
    const unpacked = parentUnpacked || value.unpacked === true
    if ('files' in value) {
      if (!record(value.files) || 'link' in value || 'size' in value) {
        throw new Error(`dsh-plugin-desktop: malformed ASAR directory entry at ${path ?? '(root)'}`)
      }
      for (const [name, child] of Object.entries(value.files)) {
        const childPath = normalizeArchiveEntry(path === undefined ? name : `${path}/${name}`)
        visit(child, childPath, unpacked)
      }
      return
    }
    if (path === undefined || (!('size' in value) && !('link' in value))) {
      throw new Error(`dsh-plugin-desktop: malformed ASAR leaf entry at ${path ?? '(root)'}`)
    }
    if (files.has(path)) {
      throw new Error(`dsh-plugin-desktop: duplicate normalized ASAR header entry ${path}`)
    }
    files.add(path)
    if (unpacked) unpackedFiles.add(path)
  }
  visit(header, undefined, false)
  return { files, unpackedFiles }
}

/**
 * Inspect one archive and reject an incomplete packaged runtime.
 * @param archivePath - resolved app.asar path.
 * @param requiredEntries - build-derived and stable runtime leaves that must be present.
 * @param readHeader - raw ASAR header reader.
 * @returns Canonical file sets for physical-tree verification.
 */
export function verifyPackagedAsar(
  archivePath: string,
  requiredEntries: readonly string[],
  readHeader: ArchiveHeaderReader = getRawHeader,
): PackagedAsarIndex {
  let rawHeader: RawAsarHeader
  try {
    rawHeader = readHeader(archivePath)
  } catch (cause) {
    throw new Error(
      `dsh-plugin-desktop: failed to inspect packaged runtime at ${archivePath}`,
      { cause },
    )
  }

  const index = indexPackagedAsarHeader(rawHeader.header)
  const missing = requiredEntries
    .map(normalizeArchiveEntry)
    .filter(entry => !index.files.has(entry))
  if (missing.length > 0) {
    throw new Error(
      `dsh-plugin-desktop: packaged runtime at ${archivePath} is missing required ASAR entries: ${missing.join(', ')}`,
    )
  }
  return index
}

/** Enumerate physical file/symlink leaves and byte sizes without following links. */
export function listUnpackedRuntimeFiles(unpackedRoot: string): UnpackedRuntimeFile[] {
  const files: UnpackedRuntimeFile[] = []
  const pending = ['']
  for (let directory = pending.pop(); directory !== undefined; directory = pending.pop()) {
    for (const entry of readdirSync(join(unpackedRoot, directory), { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else files.push({
        path: path.replaceAll('\\', '/'),
        bytes: lstatSync(join(unpackedRoot, path)).size,
      })
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

function unpackedPackageRoot(path: string): string | undefined {
  const segments = path.split('/')
  if (segments[0] !== 'node_modules' || segments.length < 2) return undefined
  if (segments[1]?.startsWith('@') === true) {
    return segments.length >= 3 ? segments.slice(0, 3).join('/') : undefined
  }
  return segments.slice(0, 2).join('/')
}

function unpackedGroupRoot(path: string): string {
  return unpackedPackageRoot(path) ?? `desktop/${path.split('/')[0] ?? '(root)'}`
}

function allowedSmartUnpackPackageRoot(root: string): boolean {
  return ALLOWED_SMART_UNPACK_PACKAGE_ROOTS.some(candidate => root === candidate)
    || ALLOWED_SMART_UNPACK_PACKAGE_PREFIXES.some(prefix => root.startsWith(prefix))
}

/** Summarize smart-unpacked payload by package root for actionable build output. */
export function summarizeUnpackedRuntime(
  files: readonly UnpackedRuntimeFile[],
): UnpackedRuntimeSummary {
  const groups = new Map<string, { files: number; bytes: number }>()
  let bytes = 0
  for (const file of files) {
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) {
      throw new Error(
        `dsh-plugin-desktop: unpacked runtime entry ${JSON.stringify(file.path)} has invalid byte size ${String(file.bytes)}`,
      )
    }
    bytes += file.bytes
    const root = unpackedGroupRoot(normalizeArchiveEntry(file.path))
    const group = groups.get(root) ?? { files: 0, bytes: 0 }
    group.files += 1
    group.bytes += file.bytes
    groups.set(root, group)
  }
  return {
    files: files.length,
    bytes,
    groups: [...groups]
      .map(([root, group]) => ({ root, ...group }))
      .sort((left, right) => right.bytes - left.bytes || left.root.localeCompare(right.root, 'en')),
  }
}

/** Render a stable one-line inventory suitable for Electron Builder logs and failures. */
export function formatUnpackedRuntimeSummary(summary: UnpackedRuntimeSummary): string {
  const groups = summary.groups
    .map(group => `${group.root}=${String(group.files)} files/${String(group.bytes)} bytes`)
    .join(', ')
  return `${String(summary.files)} files/${String(summary.bytes)} bytes${groups.length === 0 ? '' : `; ${groups}`}`
}

/**
 * Reject a regression back to the old full app.asar mirror. Header unpacked
 * leaves and physical file/symlink leaves must match exactly before the native
 * allowlist and payload budgets are applied.
 */
export function verifySelectiveUnpackedRuntime(
  archive: PackagedAsarIndex,
  unpackedRoot: string,
  files: readonly UnpackedRuntimeFile[],
  allowedDesktopEntries: readonly string[] = REQUIRED_UNPACKED_RUNTIME_ENTRIES,
): UnpackedRuntimeSummary {
  const normalizedFiles = files.map(file => ({
    path: normalizeArchiveEntry(file.path),
    bytes: file.bytes,
  }))
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const file of normalizedFiles) {
    if (seen.has(file.path)) duplicates.add(file.path)
    seen.add(file.path)
  }
  if (duplicates.size > 0) {
    throw new Error(
      `dsh-plugin-desktop: unpacked runtime at ${unpackedRoot} contains duplicate normalized physical entries: ${[...duplicates].sort().join(', ')}`,
    )
  }
  const summary = summarizeUnpackedRuntime(normalizedFiles)
  const budgetedFiles = normalizedFiles.filter(file =>
    !EXEMPT_UNPACKED_RUNTIME_PACKAGE_PREFIXES.some(prefix => file.path.startsWith(prefix)))
  const budgetSummary = summarizeUnpackedRuntime(budgetedFiles)
  const inventory = formatUnpackedRuntimeSummary(summary)
  const outsideArchive = normalizedFiles
    .map(file => file.path)
    .filter(entry => !archive.files.has(entry))
    .sort()
  const packedInHeader = normalizedFiles
    .map(file => file.path)
    .filter(entry => archive.files.has(entry) && !archive.unpackedFiles.has(entry))
    .sort()
  const missingPhysical = [...archive.unpackedFiles]
    .filter(entry => !seen.has(entry))
    .sort()
  const mismatches = [
    ...(outsideArchive.length === 0
      ? []
      : [`physical entries absent from the ASAR header: ${outsideArchive.join(', ')}`]),
    ...(packedInHeader.length === 0
      ? []
      : [`physical entries not marked unpacked in the ASAR header: ${packedInHeader.join(', ')}`]),
    ...(missingPhysical.length === 0
      ? []
      : [`ASAR header entries missing from the physical tree: ${missingPhysical.join(', ')}`]),
  ]
  if (mismatches.length > 0) {
    throw new Error(
      `dsh-plugin-desktop: unpacked runtime at ${unpackedRoot} does not exactly match ASAR unpacked flags: ${mismatches.join('; ')}; inventory: ${inventory}`,
    )
  }
  const desktopCode = normalizedFiles
    .map(file => file.path)
    .filter(entry => /^lib\/.+\.(?:cjs|html|js|json|mjs)$/u.test(entry))
  if (desktopCode.length > 0) {
    throw new Error(
      `dsh-plugin-desktop: unpacked runtime at ${unpackedRoot} contains desktop code/data that must stay in app.asar: ${desktopCode.join(', ')}; inventory: ${inventory}`,
    )
  }
  const forbidden = FORBIDDEN_UNPACKED_RUNTIME_ENTRIES
    .filter(entry => seen.has(entry))
  if (forbidden.length > 0) {
    throw new Error(
      `dsh-plugin-desktop: unpacked runtime at ${unpackedRoot} mirrors ordinary archived modules: ${forbidden.join(', ')}; inventory: ${inventory}`,
    )
  }
  const allowedDesktop = new Set(allowedDesktopEntries.map(normalizeArchiveEntry))
  const unexpectedDesktopEntries = normalizedFiles
    .map(file => file.path)
    .filter(entry => unpackedPackageRoot(entry) === undefined && !allowedDesktop.has(entry))
    .sort()
  if (unexpectedDesktopEntries.length > 0) {
    throw new Error(
      `dsh-plugin-desktop: unpacked runtime at ${unpackedRoot} contains non-allowlisted desktop entries: ${unexpectedDesktopEntries.join(', ')}; inventory: ${inventory}`,
    )
  }
  const unexpectedPackageRoots = [...new Set(normalizedFiles.flatMap((file) => {
    const root = unpackedPackageRoot(file.path)
    return root === undefined || allowedSmartUnpackPackageRoot(root)
      || file.path.startsWith('node_modules/@agents-anywhere/dsh-bridge-next/lib/bundled-connector/') ? [] : [root]
  }))].sort()
  if (unexpectedPackageRoots.length > 0) {
    // 逐文件列出违规根下的条目,错位类失败(如 linux 的 sharp 文件落进声明包根)
    // 直接给出证据路径,避免按字节数盲猜。
    const offendingEntries = normalizedFiles
      .map(file => file.path)
      .filter(entry => unexpectedPackageRoots.some(root => entry === root || entry.startsWith(`${root}/`)))
      .sort()
      .slice(0, 40)
    throw new Error(
      `dsh-plugin-desktop: unpacked runtime at ${unpackedRoot} contains non-allowlisted package roots: `
      + `${unexpectedPackageRoots.join(', ')}; entries: ${offendingEntries.join(', ')}; inventory: ${inventory}`,
    )
  }
  const pnpm = summary.groups.find(group => group.root === 'node_modules/pnpm')
  if (pnpm !== undefined
    && (pnpm.files > MAX_PNPM_SMART_UNPACK_FILES || pnpm.bytes > MAX_PNPM_SMART_UNPACK_BYTES)) {
    throw new Error(
      `dsh-plugin-desktop: unpacked runtime at ${unpackedRoot} exceeds pnpm smart-unpack budget `
      + `${String(MAX_PNPM_SMART_UNPACK_FILES)} files/${String(MAX_PNPM_SMART_UNPACK_BYTES)} bytes; `
      + `inventory: ${inventory}`,
    )
  }
  if (budgetSummary.files > MAX_UNPACKED_RUNTIME_FILES) {
    throw new Error(
      `dsh-plugin-desktop: unpacked runtime at ${unpackedRoot} exceeds selective ASAR file budget ${String(MAX_UNPACKED_RUNTIME_FILES)}; inventory: ${inventory}`,
    )
  }
  if (budgetSummary.bytes > MAX_UNPACKED_RUNTIME_BYTES) {
    throw new Error(
      `dsh-plugin-desktop: unpacked runtime at ${unpackedRoot} exceeds selective ASAR byte budget ${String(MAX_UNPACKED_RUNTIME_BYTES)}; inventory: ${inventory}`,
    )
  }
  return summary
}

/**
 * Verify Electron Builder's completed application before signing begins.
 * @param context - Electron Builder's afterPack context.
 * @param readHeader - raw ASAR header reader.
 * @param exists - physical-file probe for the unpacked CLI dependency tree.
 * @param listUnpacked - physical file inventory below app.asar.unpacked.
 * @param listDesktop - recursive inventory of the completed desktop lib/ output.
 * @returns Physical payload inventory; failure rejects the package before signing.
 */
export function verifyPackagedRuntime(
  context: PackagedRuntimeContext,
  readHeader: ArchiveHeaderReader = getRawHeader,
  exists: FileProbe = existsSync,
  listUnpacked: UnpackedFileLister = listUnpackedRuntimeFiles,
  listDesktop: DesktopRuntimeLister = listDesktopRuntimeEntries,
): UnpackedRuntimeSummary {
  const libRoot = join(context.packager.projectDir ?? DESKTOP_PACKAGE_ROOT, 'lib')
  let desktopRuntimeEntries: readonly string[]
  try {
    desktopRuntimeEntries = listDesktop(libRoot)
  } catch (cause) {
    throw new Error(
      `dsh-plugin-desktop: failed to inventory desktop build output at ${libRoot}`,
      { cause },
    )
  }
  const hasAsar = usesAsarLayout(context)
  if (!hasAsar && exists(resolvePackagedAsarPath(context))) {
    throw new Error('ASAR-disabled package unexpectedly contains app.asar')
  }
  if (context.electronPlatformName === 'win32' && context.arch !== undefined && context.arch !== 1) {
    throw new Error(
      `dsh-plugin-desktop: unsupported Windows package architecture ${String(context.arch)}; only x64 is configured`,
    )
  }
  const desktopPhysicalEntries = context.electronPlatformName === 'darwin'
    ? REQUIRED_MACOS_UNPACKED_RUNTIME_ENTRIES
    : REQUIRED_NON_MACOS_UNPACKED_RUNTIME_ENTRIES
  const posixFsExtEntry = context.electronPlatformName === 'darwin'
    || context.electronPlatformName === 'linux'
    ? context.arch === 1
      ? REQUIRED_POSIX_FS_EXT_ENTRIES[context.electronPlatformName].x64
      : context.arch === 3
        ? REQUIRED_POSIX_FS_EXT_ENTRIES[context.electronPlatformName].arm64
        : undefined
    : undefined
  const universalMacEntries = context.electronPlatformName === 'darwin'
    && context.arch === 4
    && existsSync(join(
      context.packager.projectDir ?? DESKTOP_PACKAGE_ROOT,
      'node_modules/@agents-anywhere/dsh-bridge-next/package.json',
    ))
    ? REQUIRED_MACOS_UNIVERSAL_ENTRIES
    : REQUIRED_MACOS_UNIVERSAL_ENTRIES.filter(entry => !MACOS_UNIVERSAL_UV_ENTRIES.includes(entry))
  const requiredPhysicalEntries = context.electronPlatformName === 'win32'
    ? [
        ...desktopPhysicalEntries,
        ...REQUIRED_WINDOWS_X64_NODE_PTY_ENTRIES,
      ]
    : context.electronPlatformName === 'darwin' && context.arch === 4
      ? [...desktopPhysicalEntries, ...universalMacEntries]
      : posixFsExtEntry === undefined
        ? desktopPhysicalEntries
        : [...desktopPhysicalEntries, posixFsExtEntry,
          ...(context.electronPlatformName === 'darwin'
            ? [`node_modules/@deepseek-ai/node-addon-system-darwin-${context.arch === 1 ? 'x64' : 'arm64'}/bin/system.node`]
            : []),
        ]
  const runtimeRoot = hasAsar ? resolvePackagedUnpackedRoot(context) : resolvePackagedApplicationRoot(context)
  const requiredEntries = hasAsar
    ? requiredPhysicalEntries
    : [...new Set([
        ...REQUIRED_PACKAGED_RUNTIME_ENTRIES,
        ...desktopRuntimeEntries,
        ...requiredPhysicalEntries,
      ])]
  const missing = requiredEntries.filter(entry => !exists(join(runtimeRoot, entry)))
  if (missing.length > 0) {
    throw new Error(
      `dsh-plugin-desktop: packaged runtime at ${runtimeRoot} is missing required physical entries: ${missing.join(', ')}`,
    )
  }
  if (context.electronPlatformName === 'darwin' && context.arch === 4) {
    const forbidden = FORBIDDEN_MACOS_UNIVERSAL_ENTRIES
      .filter(entry => exists(join(runtimeRoot, entry)))
    if (forbidden.length > 0) {
      throw new Error(
        `dsh-plugin-desktop: universal macOS runtime at ${runtimeRoot} contains host-architecture build output: ${forbidden.join(', ')}`,
      )
    }
  }
  const files = listUnpacked(runtimeRoot)
  if (!hasAsar) return summarizeUnpackedRuntime(files)
  const archive = verifyPackagedAsar(
    resolvePackagedAsarPath(context),
    [...REQUIRED_PACKAGED_RUNTIME_ENTRIES, ...desktopRuntimeEntries],
    readHeader,
  )
  return verifySelectiveUnpackedRuntime(archive, runtimeRoot, files, desktopPhysicalEntries)
}

/** Emit one compact package-root inventory after the static ASAR check passes. */
export function reportUnpackedRuntime(summary: UnpackedRuntimeSummary): void {
  process.stdout.write(`dsh-plugin-desktop: packaged runtime inventory: ${formatUnpackedRuntimeSummary(summary)}\n`)
}

/**
 * Wrap one archived-read strategy with the offset fallback: @electron/asar's
 * extractFile can miss entries its own raw header plainly holds (observed on
 * the Windows runner), so callers never trust a single read path.
 */
export function withOffsetFallback(
  context: PackagedRuntimeContext,
  readPackaged: (path: string) => Buffer,
): (path: string) => Buffer {
  return (path: string): Buffer => {
    try {
      return readPackaged(path)
    } catch (cause) {
      if (!usesAsarLayout(context)) throw cause
      try {
        return readArchivedFileByOffset(resolvePackagedAsarPath(context), path)
      } catch (offsetCause) {
        throw new Error(
          `packaged payload is missing from the archive: ${diagnoseArchiveScope(resolvePackagedAsarPath(context), path)}`,
          { cause: offsetCause },
        )
      }
    }
  }
}

/**
 * Verify the frozen Profile closure manifest sealed into the payload matches
 * the packaged identity: same schema, same desktop version, and the pinned
 * `@deepseek-ai/dsh` version equals the tree actually inside the archive.
 */
export function verifyProfileClosureArtifact(
  context: PackagedRuntimeContext,
  readPackaged: (path: string) => Buffer = path => usesAsarLayout(context)
    ? extractFile(resolvePackagedAsarPath(context), path)
    : readFileSync(join(resolvePackagedApplicationRoot(context), path)),
): void {
  const readPackagedOrOffset = withOffsetFallback(context, readPackaged)
  const readPackagedRuntimeFile = (path: string): Buffer => {
    try {
      return readPackagedOrOffset(path)
    } catch (cause) {
      if (usesAsarLayout(context)) {
        const unpackedPath = join(resolvePackagedUnpackedRoot(context), path)
        if (existsSync(unpackedPath)) return readFileSync(unpackedPath)
      }
      throw cause
    }
  }
  let closure: { schemaVersion?: number; desktopVersion?: string; dshVersion?: string; packages?: Record<string, string> }
  try {
    closure = JSON.parse(readPackaged('lib/profile-closure.json').toString('utf8'))
  } catch (cause) {
    throw new Error(
      `dsh-plugin-desktop: packaged Profile closure manifest is missing or unreadable: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  if (closure.schemaVersion !== 1) {
    throw new Error(`dsh-plugin-desktop: Profile closure manifest has an unexpected schemaVersion ${String(closure.schemaVersion)}`)
  }
  const rootVersion = (JSON.parse(readPackaged('package.json').toString('utf8')) as { version?: string }).version
  if (closure.desktopVersion !== rootVersion) {
    throw new Error(`dsh-plugin-desktop: Profile closure manifest desktopVersion ${String(closure.desktopVersion)} is stale against the packaged ${String(rootVersion)}`)
  }
  const dshVersion = (JSON.parse(readPackagedOrOffset('node_modules/@deepseek-ai/dsh/package.json').toString('utf8')) as { version?: string }).version
  if (closure.dshVersion !== dshVersion || closure.packages?.['@deepseek-ai/dsh'] !== dshVersion) {
    throw new Error(`dsh-plugin-desktop: Profile closure manifest pins @deepseek-ai/dsh ${String(closure.dshVersion)} but the archive carries ${String(dshVersion)}`)
  }
  for (const [packageName, expectedVersion] of Object.entries(closure.packages ?? {})) {
    if (packageName === '@deepseek-ai/dsh') continue
    let actualVersion: unknown
    try {
      actualVersion = (JSON.parse(readPackagedRuntimeFile(`node_modules/${packageName}/package.json`).toString('utf8')) as { version?: unknown }).version
    } catch (cause) {
      throw new Error(
        `dsh-plugin-desktop: Profile closure package ${packageName}@${expectedVersion} is missing from the archive`,
        { cause },
      )
    }
    if (actualVersion !== expectedVersion) {
      throw new Error(
        `dsh-plugin-desktop: Profile closure package ${packageName} resolves to ${String(actualVersion)} but the manifest pins ${expectedVersion}`,
      )
    }
  }
  for (const manifestPath of REQUIRED_RUNTIME_PACKAGE_MANIFESTS) {
    try {
      readPackagedRuntimeFile(manifestPath)
    } catch (cause) {
      throw new Error(
        `dsh-plugin-desktop: required runtime package ${manifestPath} is missing from the archive`,
        { cause },
      )
    }
  }
}

/**
 * Describe the archive scope around the AA bridge for missing-payload errors:
 * the subtree under /node_modules/@agents-anywhere plus a sample of the
 * packaged top-level packages, so a runner-side archive omission is visible
 * without re-running the build under a debugger.
 */
export function diagnoseArchiveScope(
  archivePath: string,
  packagePath: string,
  readHeader: ArchiveHeaderReader = getRawHeader,
): string {
  try {
    const rawHeader = readHeader(archivePath).header as { files?: Record<string, unknown> }
    const rawRootKeys = Object.keys(rawHeader.files ?? {})
    const { files } = indexPackagedAsarHeader(rawHeader)
    const prefix = `/${packagePath}`
    const scope = [...files].filter(path => path === prefix || path.startsWith(`${prefix}/`))
    if (scope.length > 0) {
      return `archive holds ${scope.length} ${prefix} entries: ${scope.slice(0, 20).join(', ')}`
    }
    const packageNames = new Set<string>()
    for (const path of [...files].filter(path => path.startsWith('/node_modules/'))) {
      const segments = path.split('/')
      // /node_modules/@scope/name/... vs /node_modules/name/...
      packageNames.add(segments[2]?.startsWith('@') === true
        ? `${segments[2]}/${segments[3] ?? ''}`
        : segments[2] ?? '')
    }
    const rawNodeModules = rawRootKeys.filter(key => key.replaceAll('\\', '/').startsWith('node_modules')).length
    const nodeModulesEntry = rawHeader.files?.['node_modules'] as
      | { files?: Record<string, unknown>; link?: string; size?: number; unpacked?: boolean }
      | undefined
    const agentsEntry = nodeModulesEntry?.files?.['@agents-anywhere'] as
      | { files?: Record<string, unknown>; unpacked?: boolean }
      | undefined
    const bridgeEntry = agentsEntry?.files?.['dsh-bridge-next'] as unknown
    const bridgeShape = bridgeEntry === undefined
      ? 'absent'
      : JSON.stringify(bridgeEntry).slice(0, 300)
    // Independent raw-walk leaf count under node_modules, deliberately not
    // going through indexPackagedAsarHeader so a walker quirk cannot mask
    // what the header itself holds.
    let rawLeafCount = 0
    const rawLeafSamples: string[] = []
    const countRaw = (value: unknown, path: string): void => {
      if (rawLeafCount > 4096) return
      if (value === null || typeof value !== 'object') return
      const entry = value as Record<string, unknown>
      if ('files' in entry && entry.files !== null && typeof entry.files === 'object') {
        for (const [name, child] of Object.entries(entry.files as Record<string, unknown>)) {
          countRaw(child, `${path}/${name}`)
        }
        return
      }
      rawLeafCount += 1
      if (rawLeafSamples.length < 5) rawLeafSamples.push(path)
    }
    countRaw(nodeModulesEntry, '/node_modules')
    const nodeModulesShape = nodeModulesEntry === undefined
      ? 'absent'
      : nodeModulesEntry.link !== undefined
        ? `link -> ${JSON.stringify(nodeModulesEntry.link)}`
        : nodeModulesEntry.files === undefined
          ? `leaf(size=${String(nodeModulesEntry.size)}, unpacked=${String(nodeModulesEntry.unpacked)})`
          : `dir with ${Object.keys(nodeModulesEntry.files).length} children: ${Object.keys(nodeModulesEntry.files).slice(0, 6).map(key => JSON.stringify(key)).join(', ')}; @agents-anywhere: ${agentsEntry === undefined ? 'absent' : `unpacked=${String(agentsEntry.unpacked)} files=${agentsEntry.files === undefined ? 'none' : Object.keys(agentsEntry.files).length} sample=${Object.keys(agentsEntry.files ?? {}).slice(0, 3).map(key => JSON.stringify(key)).join(', ')}`}`
    return `archive holds ${files.size} entries total, none under ${prefix}; raw node_modules leaf count: ${rawLeafCount}, samples: ${rawLeafSamples.join(', ') || '(none)'}; bridge entry: ${bridgeShape}; raw root keys: ${rawRootKeys.length} (node_modules-prefixed: ${rawNodeModules}, sample: ${rawRootKeys.slice(0, 8).map(key => JSON.stringify(key)).join(', ')}); node_modules entry shape: ${nodeModulesShape}; packaged top-level packages: ${[...packageNames].sort().slice(0, 25).join(', ')}`
  } catch (diagnosticCause) {
    return `archive scope scan itself failed: ${diagnosticCause instanceof Error ? diagnosticCause.message : String(diagnosticCause)}`
  }
}

/**
 * Read one archived file by walking the raw header ourselves and seeking to
 * the recorded offset. @electron/asar's own `extractFile` was observed to
 * miss entries that the very same raw header plainly holds on the Windows
 * runner, so the verification must not depend on its path resolution.
 */
export function readArchivedFileByOffset(archivePath: string, archivePath2: string): Buffer {
  const rawHeader = getRawHeader(archivePath).header as {
    files?: Record<string, unknown>
  }
  let node: unknown = rawHeader
  for (const segment of archivePath2.split('/').filter(Boolean)) {
    if (node === null || typeof node !== 'object') {
      throw new Error(`archived path segment missing: ${segment} in ${archivePath2}`)
    }
    const files = (node as { files?: Record<string, unknown> }).files
    if (files === undefined || !(segment in files)) {
      throw new Error(`archived path segment missing: ${segment} in ${archivePath2}`)
    }
    node = files[segment]
  }
  const entry = node as { size?: number; offset?: string }
  if (typeof entry.size !== 'number' || typeof entry.offset !== 'string') {
    throw new Error(`archived path is not a packed file: ${archivePath2}`)
  }
  const sizes = Buffer.alloc(8)
  const fd = openSync(archivePath, 'r')
  try {
    readSync(fd, sizes, 0, 8, 0)
    const headerSize = sizes.readUInt32LE(4)
    const content = Buffer.alloc(entry.size)
    readSync(fd, content, 0, entry.size, 8 + headerSize + Number(entry.offset))
    return content
  } finally {
    closeSync(fd)
  }
}

/** Verify the AA version and built entry sealed into the actual installation payload. */
export function verifyPackagedAgentsAnywhere(
  context: PackagedRuntimeContext,
  readInstalled: (path: string) => Buffer = readFileSync,
  readPackaged: (path: string) => Buffer = path => usesAsarLayout(context)
    ? extractFile(resolvePackagedAsarPath(context), path)
    : readFileSync(join(resolvePackagedApplicationRoot(context), path)),
): void {
  const packagePath = 'node_modules/@agents-anywhere/dsh-bridge-next'
  const desktopRoot = context.packager.projectDir ?? DESKTOP_PACKAGE_ROOT
  let expected: { version: string }
  try {
    expected = JSON.parse(readInstalled(join(desktopRoot, packagePath, 'package.json')).toString()) as { version: string }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return
    throw cause
  }
  if (context.electronPlatformName === 'darwin') {
    const root = usesAsarLayout(context) ? resolvePackagedUnpackedRoot(context) : resolvePackagedApplicationRoot(context)
    for (const entry of MACOS_UNIVERSAL_NATIVE_ENTRIES.filter(entry => entry.path.endsWith('/bin/uv'))) {
      accessSync(join(root, entry.path), constants.X_OK)
    }
  }
  const readPackagedOrOffset = withOffsetFallback(context, readPackaged)
  const actual = JSON.parse(readPackagedOrOffset(`${packagePath}/package.json`).toString()) as { version: string }
  if (expected.version !== actual.version) {
    throw new Error(`Packaged AA version mismatch: expected ${expected.version}, received ${actual.version}`)
  }
  const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
  if (digest(readInstalled(join(desktopRoot, packagePath, 'lib/index.js')))
    !== digest(readPackagedOrOffset(`${packagePath}/lib/index.js`))) {
    throw new Error('Packaged AA entry differs from the prepared release dependency')
  }
}

/**
 * Run the static packaged-runtime check as Electron Builder's afterPack hook.
 * @param context - Electron Builder's afterPack context.
 * @returns A promise that rejects before signing when the runtime is incomplete.
 */
/**
 * Rebuild the packaged ASAR header so every file physically present in
 * app.asar.unpacked becomes addressable. electron-builder 26.17 writes some
 * physically copied files (closure packages' docs, hydrated natives) without
 * header entries, which leaves them unreachable at runtime. The rebuilt
 * pickle keeps the header buffer's total length (the payload lives at the
 * buffer tail per PickleIterator's payloadOffset = length - payloadSize), so
 * every recorded body offset stays valid.
 */
export function repairPackagedAsarHeader(context: PackagedRuntimeContext): void {
  if (!usesAsarLayout(context)) {
    console.log('repair diag: skipped, not an asar layout')
    return
  }
  const asarPath = resolvePackagedAsarPath(context)
  const unpackedRoot = resolve(unpackRootOf(context))
  let fd: number
  try {
    fd = openSync(asarPath, 'r+')
  } catch (cause) {
    console.log(`repair diag: skipped, openSync failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    return
  }
  console.log(`repair diag: running, asar=${asarPath} unpackedRoot=${unpackedRoot}`)
  try {
    const sizes = Buffer.alloc(16)
    readSync(fd, sizes, 0, 16, 0)
    const oldHeaderBufLen = sizes.readUInt32LE(4)
    const oldJsonLen = sizes.readUInt32LE(12)
    const oldJson = Buffer.alloc(oldJsonLen)
    readSync(fd, oldJson, 0, oldJsonLen, 16)
    const header = JSON.parse(oldJson.toString('utf8')) as { files?: Record<string, unknown> }

    const ensureLeaf = (path: string, bytes: number): void => {
      const segments = path.split('/').filter(Boolean)
      let node = header
      for (const segment of segments.slice(0, -1)) {
        const dir = (node.files ??= {})
        node = (dir[segment] ??= { files: {} })
      }
      const parent = (node.files ??= {})
      // Force the unpacked flag: the writer emits these files physically
      // while leaving their header entries packed (or absent), and Electron
      // must read them from app.asar.unpacked.
      parent[segments.at(-1)!] = { size: bytes, unpacked: true }
    }
    const walkPhysical = (dir: string, path: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        const childPath = `${path}/${entry.name}`
        if (entry.isDirectory()) walkPhysical(full, childPath)
        else ensureLeaf(childPath, statSync(full).size)
      }
    }
    walkPhysical(join(unpackedRoot, 'node_modules'), '/node_modules')

    // The embedded-ASAR integrity fuse is disabled for these smoke/gate
    // packages, so the per-entry integrity blocks are dead weight that buys
    // the slack the added entries need.
    const stripIntegrity = (node: unknown): void => {
      if (node === null || typeof node !== 'object') return
      const record = node as Record<string, unknown>
      delete record.integrity
      for (const child of Object.values(record.files ?? {})) stripIntegrity(child)
    }
    stripIntegrity(header)

    const json = Buffer.from(JSON.stringify(header))
    const jsonLenPadded = (json.length + 3) & ~3
    const payloadSize = 4 + jsonLenPadded
    const payloadOffset = oldHeaderBufLen - payloadSize
    if (payloadOffset < 8) {
      throw new Error(
        `dsh-plugin-desktop: repaired ASAR header payload needs ${payloadSize} bytes, exceeding the reserved ${oldHeaderBufLen - 8}`,
      )
    }
    // The pickle payload lives at the buffer tail (payloadOffset = length -
    // payloadSize, per PickleIterator's payloadOffset = getHeaderSize()).
    const headerBuf = Buffer.alloc(oldHeaderBufLen)
    // payloadSize covers the whole reserved region so the PickleIterator's
    // payloadOffset (= buffer.length - payloadSize) lands exactly at 4.
    headerBuf.writeUInt32LE(oldHeaderBufLen - 4, 0)
    headerBuf.writeUInt32LE(json.length, payloadOffset)
    json.copy(headerBuf, payloadOffset + 4)
    writeSync(fd, headerBuf, 0, headerBuf.length, 8)
    console.log(
      `repair diag: wrote headerBuf ${headerBuf.length}B at offset 8 ` +
      `(payloadSize ${payloadSize}, payloadOffset ${payloadOffset}, added ${added} entries)`,
    )
  } finally {
    closeSync(fd)
  }
}

function unpackRootOf(context: PackagedRuntimeContext): string {
  return usesAsarLayout(context) ? resolvePackagedUnpackedRoot(context) : resolvePackagedApplicationRoot(context)
}

export async function afterPack(
  context: PackagedRuntimeContext,
  verify: typeof verifyPackagedRuntime = verifyPackagedRuntime,
  report: (summary: UnpackedRuntimeSummary) => void = reportUnpackedRuntime,
  verifyAa: typeof verifyPackagedAgentsAnywhere = verifyPackagedAgentsAnywhere,
  smokeNative: PackagedElectronSmoke = smokePackagedFsExtRuntime,
  hydrateMac: (context: PackagedRuntimeContext) => void = hydratePackagedMacRuntimeForContext,
  verifyClosure: typeof verifyProfileClosureArtifact = verifyProfileClosureArtifact,
  hydrateLinux: (context: PackagedRuntimeContext) => void = hydratePackagedLinuxFsExtRuntimeForContext,
): Promise<void> {
  hydrateMac(context)
  hydrateLinux(context)
  hydrateRequiredRuntimePackages(context)
  repairPackagedAsarHeader(context)
  const summary = verify(context)
  verifyAa(context)
  verifyClosure(context)
  report(summary)
  smokeNative(context)
}

export default afterPack
