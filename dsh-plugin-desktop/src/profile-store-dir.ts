/** pnpm content store selection compatible with existing Profile installations. */

import { mkdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { parseDocument } from 'yaml'

/**
 * Resolve the store for one Profile, or the default for one Harness home.
 *
 * Existing node_modules must keep the store recorded by pnpm: changing it
 * during add/remove fails with ERR_PNPM_UNEXPECTED_STORE. New installations
 * use the app-local store. Read on every operation because terminal installs
 * and dependency repairs may replace the metadata during this generation.
 */
export function desktopPnpmStoreDir(home: string, profileDir?: string): string {
  if (home.length === 0 || home.includes('\0')) {
    throw new TypeError('desktop pnpm store directory requires a non-empty Harness home without NUL')
  }
  if (profileDir !== undefined) {
    let contents: string | undefined
    try {
      contents = readFileSync(join(profileDir, 'node_modules', '.modules.yaml'), 'utf8')
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    }
    if (contents !== undefined) {
      const document = parseDocument(contents)
      const storeDir: unknown = document.get('storeDir')
      if (document.errors.length === 0 && typeof storeDir === 'string'
        && isAbsolute(storeDir) && !storeDir.includes('\0')) {
        // pnpm accepts its already-versioned store path (for example /store/v11).
        return storeDir
      }
    }
  }
  return join(home, 'pnpm-store')
}

/** Create the selected store directory when missing and return its path. */
export function ensureDesktopPnpmStoreDir(home: string, profileDir?: string): string {
  const dir = desktopPnpmStoreDir(home, profileDir)
  mkdirSync(dir, { recursive: true })
  return dir
}
