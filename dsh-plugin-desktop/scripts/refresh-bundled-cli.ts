/** Packaging-entry boundary for the bundled-content refresh CLI. */

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

export type RefreshBundledMode = 'refresh' | 'verify'

/**
 * Run `scripts/refresh-bundled.mjs` for one packaging entry.
 *
 * - `refresh`: pull the latest skills and github-sourced plugins before the
 *   check gate; network failures degrade to the committed snapshot (exit 0).
 * - `verify`: offline gate for the signed release path — the release ships
 *   exactly the committed snapshot, or fails loudly.
 */
export function refreshBundledForPackaging(mode: RefreshBundledMode, repositoryRoot: string): void {
  const args = mode === 'verify' ? ['--offline'] : []
  const result = spawnSync(process.execPath, [join(repositoryRoot, 'scripts', 'refresh-bundled.mjs'), ...args], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`refresh-bundled (${mode}) exited with ${String(result.status)}`)
}
