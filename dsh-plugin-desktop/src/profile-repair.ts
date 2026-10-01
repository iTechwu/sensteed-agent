/** Deferred, offline-first repair of Profile dependency metadata. */

import { acquireDesktopDataOperationLock } from './desktop-data-operation-lock.ts'
import { DesktopDataDirectoryError } from './desktop-data-directory.ts'
import {
  classifyProfileDependencyState,
} from './profile.ts'
import {
  formatProfileMaterializationFailure,
  materializeProfile,
  type ProfileMaterializerSpawn,
} from './profile-materializer.ts'
import { maskSecrets } from './mask-secrets.ts'
import { ensureDesktopPnpmStoreDir } from './profile-store-dir.ts'

/**
 * Terminal states of one deferred repair pass.
 *
 * `deferred` means another desktop data operation held the lock; the next
 * startup reschedules the repair, so callers must treat it as non-fatal.
 */
export type DesktopProfileRepairOutcome = 'not-required' | 'repaired' | 'deferred'

/** Inputs for one offline-first Profile dependency repair pass. */
export interface DesktopProfileRepairOptions {
  readonly homeDir: string
  readonly profileDir: string
  readonly platform: NodeJS.Platform
  /** Directory owning the desktop data-operation lock, normally userData. */
  readonly lockDir: string
  readonly appExecutable: string
  readonly clearEnvironmentPath: string
  readonly pnpmBinPath: string
  readonly nodeBinDir: string
  readonly nodeShimPath: string
  readonly electronVersion: string
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  /** Injectable only for headless tests; production uses node:child_process.spawn. */
  readonly spawn?: ProfileMaterializerSpawn
}

/** Classify first, repair second: a concurrent actor may have fixed the Profile already. */
export async function runDesktopProfileRepair(
  options: DesktopProfileRepairOptions,
): Promise<DesktopProfileRepairOutcome> {
  const initial = classifyProfileDependencyState(options.profileDir, false, options.platform)
  if (initial.status === 'compatible') return 'not-required'

  let lease: ReturnType<typeof acquireDesktopDataOperationLock>
  try {
    lease = acquireDesktopDataOperationLock(options.lockDir, 'profile-dependency-repair')
  } catch (cause) {
    if (cause instanceof DesktopDataDirectoryError && cause.code === 'busy') return 'deferred'
    throw cause
  }
  try {
    const rechecked = classifyProfileDependencyState(options.profileDir, false, options.platform)
    if (rechecked.status === 'compatible') return 'not-required'
    const storeDir = ensureDesktopPnpmStoreDir(options.homeDir)
    await materializeProfile({
      appExecutable: options.appExecutable,
      clearEnvironmentPath: options.clearEnvironmentPath,
      pnpmBinPath: options.pnpmBinPath,
      nodeBinDir: options.nodeBinDir,
      nodeShimPath: options.nodeShimPath,
      homeDir: options.homeDir,
      profileDir: options.profileDir,
      electronVersion: options.electronVersion,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.spawn === undefined ? {} : { spawn: options.spawn }),
      storeDir,
      offline: 'prefer',
      // The repair exists precisely to reconcile stale lockfile settings, so
      // it owns the same controlled non-frozen install the boot migration had.
      updateLockfile: true,
    })
    const repaired = classifyProfileDependencyState(options.profileDir, false, options.platform)
    if (repaired.status !== 'compatible') {
      throw new Error(`desktop profile dependency repair did not clear: ${repaired.reasons.join(', ')}`)
    }
    return 'repaired'
  } finally {
    lease.release()
  }
}

/** Bounded failure detail suitable for recovery surfaces; never leaks secrets. */
export function formatDesktopProfileRepairFailure(cause: unknown): string {
  return maskSecrets(formatProfileMaterializationFailure(cause))
}

/** One pending deferred repair; disposal cancels it before it starts. */
export interface DesktopProfileRepairSchedule {
  readonly dispose: () => void
}

/**
 * Schedule one repair pass after the Host had a fair chance to boot.
 *
 * The delay keeps first-paint latency untouched; the pass itself runs in the
 * Electron main process while the workspace is already usable, and a failure
 * only surfaces through the recovery surface on the next startup.
 */
export function scheduleDesktopProfileRepair(
  options: DesktopProfileRepairOptions & { readonly delayMs?: number },
  hooks: {
    readonly onOutcome?: (outcome: DesktopProfileRepairOutcome) => void
    readonly onFailure?: (cause: unknown) => void
  } = {},
): DesktopProfileRepairSchedule {
  const timer = setTimeout(() => {
    void runDesktopProfileRepair(options)
      .then(outcome => hooks.onOutcome?.(outcome))
      .catch(cause => hooks.onFailure?.(cause))
  }, options.delayMs ?? 30_000)
  timer.unref?.()
  return { dispose: () => { clearTimeout(timer) } }
}
