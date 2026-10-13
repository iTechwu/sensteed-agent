/** Absolute path of the app-bundled third-party skill root, when present. */

import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Resolve the bundled skill root the harness mounts as its dedicated
 * 'bundled' provider root (`DSH_BUNDLED_SKILL_DIR`, rank 600, trustedHost).
 *
 * The directory sits next to `lib/` in the desktop package: in development
 * that is the committed refresh snapshot, in the packaged app the same
 * relative hop lands inside `app.asar/bundled/skills`, which Electron's
 * patched fs reads like any other archived path (same contract as the
 * preset skills under `node_modules`).
 *
 * @returns the root, or `undefined` when nothing is bundled so callers can
 *   leave the environment variable untouched.
 */
export function bundledSkillRoot(moduleUrl: string = import.meta.url): string | undefined {
  const root = join(dirname(fileURLToPath(moduleUrl)), '..', 'bundled', 'skills')
  try {
    return statSync(root).isDirectory() ? root : undefined
  } catch {
    return undefined
  }
}
