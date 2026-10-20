/** Launcher-side cache of the Host-reported mandatory update policy snapshot. */

import { readDesktopMandatoryPolicyState, evaluateDesktopMandatoryUpdate } from '@dofe/dsh-sensteed-product/desktop-mandatory-policy'
import { join } from 'node:path'

export interface CachedMandatoryUpdatePolicy {
  readonly phase: 'none' | 'notice' | 'blocking'
  readonly minVersion?: string
  readonly deadline?: string
  readonly channel?:'stable'|'beta'|'next'
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
export function readCachedMandatoryPolicyFromState(statePath: string | undefined,currentVersion?:string,channel:'stable'|'beta'|'next'='stable'): CachedMandatoryUpdatePolicy | undefined {
  if(statePath===undefined)return undefined
  const snapshot=readDesktopMandatoryPolicyState(join(statePath,'..','mandatory-policy-state.json'))
  if(!snapshot||(snapshot.channel??'stable')!==channel)return undefined
  if(currentVersion===undefined)return snapshot
  return {...snapshot,...evaluateDesktopMandatoryUpdate({directive:snapshot.minVersion?{minVersion:snapshot.minVersion,...(snapshot.deadline?{deadline:snapshot.deadline}:{})}:undefined,currentVersion})}
}
