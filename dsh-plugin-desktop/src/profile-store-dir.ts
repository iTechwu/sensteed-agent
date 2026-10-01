/** Desktop-pinned pnpm content store shared by every Desktop-driven pnpm run. */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Resolve the pinned store directory for one Harness home.
 *
 * Pinning keeps offline-capable operations (Profile dependency repair,
 * checkpoint restoration) hitting the same content the user-visible Market
 * installs already downloaded, and keeps one predictable disk budget under
 * the Harness home instead of pnpm's per-user default location.
 */
export function desktopPnpmStoreDir(home: string): string {
  if (home.length === 0 || home.includes('\0')) {
    throw new TypeError('desktop pnpm store directory requires a non-empty Harness home without NUL')
  }
  return join(home, 'pnpm-store')
}

/** Create the pinned store directory when missing and return its path. */
export function ensureDesktopPnpmStoreDir(home: string): string {
  const dir = desktopPnpmStoreDir(home)
  mkdirSync(dir, { recursive: true })
  return dir
}
