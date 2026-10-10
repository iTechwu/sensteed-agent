/** Inventory the installed payload without reading large native binaries. */
import { getRawHeader } from '@electron/asar'
import { existsSync, rmSync, lstatSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface PayloadFile {
  readonly path: string
  readonly bytes: number
  readonly unpacked: boolean
}

export interface PackageSizeReport {
  readonly platform: string
  readonly arch: string
  readonly archiveBytes: number
  readonly unpackedBytes: number
  readonly payloadBytes: number
  readonly sourceMapBytes: number
  readonly fileCount: number
  readonly largestPackages: readonly { readonly path: string; readonly bytes: number }[]
  readonly largestFiles: readonly PayloadFile[]
}

interface HeaderEntry {
  readonly files?: Record<string, HeaderEntry>
  readonly size?: number
  readonly unpacked?: boolean
}

export function isRuntimeSourceMap(path: string): boolean {
  return /\.(?:[cm]?[jt]s|css)\.map$/u.test(path)
}

/** Count each package version/location independently; nested packages stay visible. */
export function payloadPackageRoot(path: string): string {
  const segments = path.split('/')
  const index = segments.lastIndexOf('node_modules')
  if (index === -1) return segments[0] ?? path
  const packageName = segments[index + 1]
  return segments.slice(0, index + (packageName?.startsWith('@') ? 3 : 2)).join('/')
}

export function summarizePackageSize(
  files: readonly PayloadFile[],
  archiveBytes: number,
  platform: string,
  arch: string,
): PackageSizeReport {
  const packages = new Map<string, number>()
  let unpackedBytes = 0
  let sourceMapBytes = 0
  for (const file of files) {
    const root = payloadPackageRoot(file.path)
    packages.set(root, (packages.get(root) ?? 0) + file.bytes)
    if (file.unpacked) unpackedBytes += file.bytes
    if (isRuntimeSourceMap(file.path)) sourceMapBytes += file.bytes
  }
  return {
    platform, arch, archiveBytes, unpackedBytes,
    payloadBytes: archiveBytes + unpackedBytes,
    sourceMapBytes, fileCount: files.length,
    largestPackages: [...packages].map(([path, bytes]) => ({ path, bytes }))
      .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path)).slice(0, 30),
    largestFiles: [...files].sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path)).slice(0, 30),
  }
}

/** Match the payload budget to a single CPU or a universal two-CPU bundle. */
export function assertPackageSize(report: PackageSizeReport): void {
  const limit = (report.arch === 'universal' ? 2.5 : 1.5) * 1024 ** 3
  if (report.sourceMapBytes > 0) {
    throw new Error(`packaged runtime contains ${report.sourceMapBytes} bytes of debug source maps`)
  }
  if (report.payloadBytes > limit) {
    throw new Error(`packaged ${report.platform}/${report.arch} payload is ${report.payloadBytes} bytes; budget is ${limit}; see package-size report`)
  }
}

function collectPhysical(directory: string, prefix: string, files: Map<string, PayloadFile>): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    // Links contain no duplicated payload; their targets are inventoried once.
    const stat = lstatSync(path)
    if (stat.isDirectory()) collectPhysical(path, relative, files)
    else if (stat.isFile()) files.set(relative, { path: relative, bytes: stat.size, unpacked: true })
  }
}

/** Write the report before checking budgets so failed builds preserve evidence. */
export function writePackageSizeReport(options: {
  readonly archive: string
  readonly unpackedRoot: string
  readonly platform: string
  readonly arch: string
  readonly outputPath: string
}): PackageSizeReport {
  const files = new Map<string, PayloadFile>()
  const walk = (entry: HeaderEntry, prefix: string): void => {
    for (const [name, child] of Object.entries(entry.files ?? {})) {
      const path = prefix ? `${prefix}/${name}` : name
      if (child.files) walk(child, path)
      else if (typeof child.size === 'number' && !child.unpacked) {
        files.set(path, { path, bytes: child.size, unpacked: false })
      }
    }
  }
  walk(getRawHeader(options.archive).header, '')
  if (existsSync(options.unpackedRoot)) collectPhysical(options.unpackedRoot, '', files)
  const report = summarizePackageSize([...files.values()], statSync(options.archive).size,
    options.platform, options.arch)
  writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`package size: ${options.platform}/${options.arch}, payload ${(report.payloadBytes / 1024 ** 2).toFixed(1)} MiB, report ${options.outputPath}`)
  assertPackageSize(report)
  return report
}

/** Reports live beside generated app directories, outside the installed bundle. */
export function packageSizeReportPath(appOutDir: string, platform: string, arch: string): string {
  return join(dirname(appOutDir), `package-size-${platform}-${arch}.json`)
}

/** Hydration copies whole native packages after the builder's file filter ran. */
export function pruneHydratedSourceMaps(directory: string): void {
  if (!existsSync(directory)) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) pruneHydratedSourceMaps(path)
    else if (entry.isFile() && isRuntimeSourceMap(entry.name)) rmSync(path)
  }
}
