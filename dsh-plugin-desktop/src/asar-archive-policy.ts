/** Physical-filesystem policy for Electron processes that serve user workspaces. */

import { fileURLToPath } from 'node:url'
import fs, { type BigIntStats, type PathLike, type Stats, type StatOptions } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'

/** A path segment Electron would open as an archive, or its unpacked sibling. */
const ARCHIVE_SEGMENT = /(?:^|[\\/])[^\\/]*\.asar(?:\.unpacked)?(?:[\\/]|$)/iu

/** Restore the bigint contract for Electron's virtual archive metadata. */
export function normalizeAsarBigIntStats(path: PathLike, options: StatOptions | undefined, stats: Stats | BigIntStats): Stats | BigIntStats {
  const filename = path instanceof URL ? fileURLToPath(path) : path.toString()
  if (options?.bigint !== true || typeof stats.mode === 'bigint' || !ARCHIVE_SEGMENT.test(filename)) return stats
  return new Proxy(stats, {
    get(target, key) {
      if (typeof key === 'string' && /^(?:atime|mtime|ctime|birthtime)Ns$/u.test(key)) {
        const milliseconds = Reflect.get(target, key.replace(/Ns$/u, 'Ms')) as number
        return BigInt(Math.round(milliseconds * 1_000_000))
      }
      const value: unknown = Reflect.get(target, key)
      // Bind Stats predicates to their numeric backing object: converting mode
      // while retaining their numeric bit masks would introduce another TypeError.
      if (typeof value === 'function') return value.bind(target)
      return typeof value === 'number' ? BigInt(Math.trunc(value)) : value
    },
  }) as BigIntStats
}

let bigintStatsInstalled = false

function installAsarBigIntStats(): void {
  if (bigintStatsInstalled || process.versions.electron === undefined) return
  bigintStatsInstalled = true
  type StatMethod = (path: PathLike, options?: StatOptions) => Promise<Stats | BigIntStats>
  for (const method of ['stat', 'lstat'] as const) {
    const original = fs.promises[method] as StatMethod
    fs.promises[method] = (async (path: PathLike, options?: StatOptions) => {
      const stats = await original(path, options)
      return normalizeAsarBigIntStats(path, options, stats)
    }) as typeof fs.promises.stat
  }
  // fs-local may already hold named fs/promises imports when the Host starts.
  syncBuiltinESMExports()
}

/** The one Electron process flag this policy owns. */
export interface AsarArchiveProcess {
  noAsar?: boolean
}

/**
 * Turn off Electron's transparent `.asar` archive view for this process.
 *
 * Electron patches `fs` in its main process, utility processes and
 * ELECTRON_RUN_AS_NODE children so that any path ending in `.asar` reads as a
 * directory. A workspace file named `*.asar` then stats as a directory whose
 * fields are numbers even under `{ bigint: true }` (dsh-fs-local fails with
 * "Cannot mix BigInt and other types"), and a `*.asar` file that is not an
 * archive throws "Invalid package", so one such file breaks listing its whole
 * directory. Unpacked processes can use the physical filesystem instead.
 *
 * The view stays on when the code about to run was itself loaded from an
 * archive: turning it off there would make the application unloadable. Such
 * processes retain the archive view and normalize its bigint stat responses.
 * @param moduleUrl - URL of the code this process runs.
 * @param proc - process whose flag is set.
 * @returns whether the archive view was turned off.
 */
export function disableAsarArchiveView(moduleUrl: string, proc: AsarArchiveProcess = process): boolean {
  if (ARCHIVE_SEGMENT.test(fileURLToPath(moduleUrl))) {
    if (proc === process) installAsarBigIntStats()
    return false
  }
  proc.noAsar = true
  return true
}
