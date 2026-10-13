/** Packaging-entry boundary for the bundled-content refresh CLI. */

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

export type RefreshBundledMode = 'refresh' | 'verify'

/**
 * Run `scripts/refresh-bundled.mjs` for one packaging entry.
 *
 * Both historical modes now verify the tagged snapshot offline. Refresh
 * skills and GitHub-sourced plugins in dev before preparing the release.
 */
export function refreshBundledForPackaging(mode: RefreshBundledMode, repositoryRoot: string): void {
  // Packaging is always based on the tagged snapshot. Refresh in dev before release preparation.
  const args = ['--offline']
  const result = spawnSync(process.execPath, [join(repositoryRoot, 'scripts', 'refresh-bundled.mjs'), ...args], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`refresh-bundled (${mode}) exited with ${String(result.status)}`)
}
