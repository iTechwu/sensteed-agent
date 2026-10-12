/** Restore Windows Koffi platform packages omitted by Electron Builder's npm collector. */

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'

export interface PackagedWindowsKoffiHydrationOptions {
  /** Desktop package root containing the complete installed dependency tree. */
  readonly desktopRoot: string
  /** Physical app.asar.unpacked root produced by Electron Builder. */
  readonly unpackedRoot: string
}

export interface LoadedKoffiModule {
  readonly version?: unknown
}

export type PackagedKoffiLoader = (koffiRoot: string) => LoadedKoffiModule

export interface PlatformLinkDereferenceOptions {
  /** Dependency tree root whose links are materialized in place. */
  readonly modulesRoot: string
  /** Injectable platform so non-Windows hosts can exercise the walk in tests. */
  readonly platform?: NodeJS.Platform
}

export interface HoistedPlatformPackageOptions {
  /** Desktop package root whose node_modules the package is hoisted into. */
  readonly desktopRoot: string
  /** Scoped package name, e.g. `@deepseek-ai/libreoffice-kit-win32-x64`. */
  readonly packageName: string
}

function copyPackage(source: string, target: string): void {
  if (!existsSync(source)) {
    throw new Error(`cannot find installed Windows Koffi package at ${source}`)
  }
  rmSync(target, { recursive: true, force: true })
  cpSync(source, target, { recursive: true, force: true, dereference: true })
}

function findPackagedKoffiPackages(nodeModulesRoot: string): string[] {
  const found: string[] = []
  const pending = [nodeModulesRoot]
  while (pending.length > 0) {
    const directory = pending.pop()!
    if (!existsSync(directory)) continue
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const child = join(directory, entry.name)
      if (entry.name === 'koffi' && directory.endsWith(`${sep}node_modules`)) {
        found.push(child)
        continue
      }
      pending.push(child)
    }
  }
  return found
}

function packageVersion(packageRoot: string): string {
  return (JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
    readonly version: string
  }).version
}

function resolveInstalledKoffi(
  desktopRoot: string,
  unpackedRoot: string,
  packagedKoffi: string,
): string {
  const packagedVersion = packageVersion(packagedKoffi)
  const matchesPackagedVersion = (candidate: string): boolean =>
    existsSync(candidate) && packageVersion(candidate) === packagedVersion

  const packageRelativePath = relative(unpackedRoot, packagedKoffi)
  const directCandidate = join(desktopRoot, packageRelativePath)
  if (matchesPackagedVersion(directCandidate)) return realpathSync(directCandidate)

  const marker = `${sep}node_modules${sep}koffi`
  const markerIndex = packageRelativePath.lastIndexOf(marker)
  if (markerIndex >= 0) {
    const consumerRoot = join(desktopRoot, packageRelativePath.slice(0, markerIndex))
    try {
      const resolvedCandidate = dirname(createRequire(join(consumerRoot, 'package.json')).resolve('koffi'))
      if (matchesPackagedVersion(resolvedCandidate)) return realpathSync(resolvedCandidate)
    } catch {
      // The versioned pnpm store lookup below is the authoritative fallback.
    }
  }

  const workspaceRoot = dirname(desktopRoot)
  const storeCandidates = [
    join(workspaceRoot, 'node_modules', '.pnpm', `koffi@${packagedVersion}`, 'node_modules', 'koffi'),
    join(
      workspaceRoot,
      'deepseek-harness',
      'node_modules',
      '.pnpm',
      `koffi@${packagedVersion}`,
      'node_modules',
      'koffi',
    ),
  ]
  const versionedCandidate = storeCandidates.find(matchesPackagedVersion)
  if (versionedCandidate !== undefined) return realpathSync(versionedCandidate)

  throw new Error(`cannot resolve installed Koffi ${packagedVersion} source for ${packagedKoffi}`)
}

function resolveInstalledWindowsNative(desktopRoot: string, installedKoffi: string): string {
  const packageName = 'koffi-win32-x64'
  const adjacent = join(dirname(installedKoffi), '@koromix', packageName)
  if (existsSync(adjacent)) return adjacent

  const version = packageVersion(installedKoffi)
  const alias = join(desktopRoot, 'node_modules', `${packageName}-${version.replaceAll('.', '-')}`)
  if (existsSync(alias)) return alias

  throw new Error(`cannot resolve installed ${packageName} ${version} source`)
}

/** Materialize the matching win32-x64 native package beside every packaged Koffi version. */
export function hydratePackagedWindowsKoffiRuntime(
  options: PackagedWindowsKoffiHydrationOptions,
): void {
  const desktopRoot = resolve(options.desktopRoot)
  const unpackedRoot = resolve(options.unpackedRoot)
  const packagedModules = join(unpackedRoot, 'node_modules')

  for (const packagedKoffi of findPackagedKoffiPackages(packagedModules)) {
    const installedKoffi = resolveInstalledKoffi(desktopRoot, unpackedRoot, packagedKoffi)
    copyPackage(
      resolveInstalledWindowsNative(desktopRoot, installedKoffi),
      join(dirname(packagedKoffi), '@koromix', 'koffi-win32-x64'),
    )
  }
}

/**
 * Dereference platform-gated packages (package.json declaring `os`/`cpu`)
 * that pnpm installs as junctions/symlinks, replacing each link with a real
 * directory copy before Electron Builder runs.
 *
 * The Windows dependency-tree copy drops link entries from app.asar while
 * its file set still records them, so every archived platform package
 * (koffi, sharp, LibreOffice kit, …) must be physically materialized or the
 * NSIS stage fails with `"…" was not found in this archive`. Regular
 * packages are left alone: their links archive correctly and dereferencing
 * them would duplicate the store needlessly. `.pnpm` is not descended into —
 * it is the dereference source, not an archive surface.
 *
 * @returns how many links were dereferenced.
 */
export function dereferencePlatformPackageLinks(
  options: PlatformLinkDereferenceOptions,
): number {
  if ((options.platform ?? process.platform) !== 'win32') return 0
  const root = resolve(options.modulesRoot)
  let dereferenced = 0
  const pending = [root]
  while (pending.length > 0) {
    const dir = pending.pop()!
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      const info = lstatSync(full, { throwIfNoEntry: false })
      if (info === undefined) continue
      if (info.isSymbolicLink()) {
        const manifestPath = join(full, 'package.json')
        const manifest = existsSync(manifestPath)
          ? JSON.parse(readFileSync(manifestPath, 'utf8')) as { os?: unknown, cpu?: unknown }
          : undefined
        if (manifest?.os === undefined && manifest?.cpu === undefined) {
          // 常规包的链接在依赖拷贝中本来就能正确归档；只需继续下钻，
          // 平台门控链接才是被丢档的那类。
          const target = statSync(full, { throwIfNoEntry: false })
          if (target?.isDirectory()) pending.push(full)
          continue
        }
        const source = realpathSync(full)
        rmSync(full, { recursive: true, force: true })
        cpSync(source, full, { recursive: true, force: true, dereference: true })
        dereferenced += 1
        continue
      }
      if (info.isDirectory() && entry.name !== '.pnpm') pending.push(full)
    }
  }
  return dereferenced
}

function loadPackagedKoffi(koffiRoot: string): LoadedKoffiModule {
  const require = createRequire(join(koffiRoot, 'package.json'))
  return require('koffi') as LoadedKoffiModule
}

/** Load every packaged Windows Koffi instance and verify its native version. */
export function smokePackagedWindowsKoffiRuntime(
  unpackedRoot: string,
  load: PackagedKoffiLoader = loadPackagedKoffi,
): void {
  for (const koffiRoot of findPackagedKoffiPackages(join(unpackedRoot, 'node_modules'))) {
    const expectedVersion = packageVersion(koffiRoot)
    let loaded: LoadedKoffiModule
    try {
      loaded = load(koffiRoot)
    } catch (cause) {
      throw new Error(`failed to load packaged Koffi at ${koffiRoot}`, { cause })
    }
    if (loaded.version !== expectedVersion) {
      throw new Error(
        `packaged Koffi at ${koffiRoot} loaded native version ${String(loaded.version)}; expected ${expectedVersion}`,
      )
    }
  }
}

export type HoistedPlatformPackageOutcome = 'present' | 'materialized' | 'source-missing'

/**
 * Ensure a pnpm-virtual-store platform package is physically reachable at its
 * hoisted top-level path before Electron Builder runs.
 *
 * Transitive platform packages (e.g. `@deepseek-ai/libreoffice-kit-win32-x64`
 * under the main LibreOffice kit) stay inside `.pnpm`; pnpm's list view still
 * reports them hoisted, so the dependency collector records a top-level file
 * set that the Windows dependency copy cannot satisfy from the absent
 * top-level path, and NSIS fails with `"…" was not found in this archive`.
 * A real top-level copy gives both the collector and the copier the same
 * physical location.
 */
export function ensureHoistedPlatformPackage(options: HoistedPlatformPackageOptions): HoistedPlatformPackageOutcome {
  const desktopRoot = resolve(options.desktopRoot)
  const hoisted = join(desktopRoot, 'node_modules', ...options.packageName.split('/'))
  if (existsSync(hoisted)) return 'present'

  const storeDirName = `${options.packageName.replaceAll('/', '+')}@`
  const storeRoot = join(desktopRoot, 'node_modules', '.pnpm')
  if (!existsSync(storeRoot)) return 'source-missing'
  for (const entry of readdirSync(storeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(storeDirName)) continue
    const source = join(storeRoot, entry.name, 'node_modules', ...options.packageName.split('/'))
    if (!existsSync(source)) continue
    mkdirSync(dirname(hoisted), { recursive: true })
    cpSync(source, hoisted, { recursive: true, force: true, dereference: true })
    return 'materialized'
  }
  return 'source-missing'
}
