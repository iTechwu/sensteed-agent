/** Launcher-side cache of the Host-reported mandatory update policy snapshot. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface CachedMandatoryUpdatePolicy {
  readonly phase: 'none' | 'notice' | 'blocking'
  readonly minVersion?: string
  readonly deadline?: string
  readonly observedAt: string
}

let cached: CachedMandatoryUpdatePolicy | undefined
let reported = false

/** Record the Host's latest report (null clears a previously reported policy). */
export function setCachedMandatoryPolicy(policy: CachedMandatoryUpdatePolicy | null): void {
  reported = true
  cached = policy ?? undefined
}

/**
 * The live cached snapshot; `undefined` means the Host never reported one this
 * run (the product layer is absent, or the policy row has not activated yet).
 */
export function getCachedMandatoryPolicy(): CachedMandatoryUpdatePolicy | undefined {
  return reported ? cached : undefined
}

/**
 * Lazy fallback for the pre-Host recovery window: read the persisted snapshot
 * the policy row wrote next to the shell's update state. A missing or
 * malformed file means no block.
 */
export function readCachedMandatoryPolicyFromState(statePath: string | undefined): CachedMandatoryUpdatePolicy | undefined {
  if (statePath === undefined) return undefined
  const policyPath = join(statePath, '..', 'mandatory-policy-state.json')
  try {
    const parsed: unknown = JSON.parse(readFileSync(policyPath, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const file = parsed as { version?: unknown; snapshot?: CachedMandatoryUpdatePolicy }
    if (file.version !== 1 || file.snapshot === undefined || typeof file.snapshot.phase !== 'string') return undefined
    return file.snapshot
  } catch {
    return undefined
  }
}
