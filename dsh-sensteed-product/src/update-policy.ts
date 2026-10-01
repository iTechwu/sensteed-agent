/** Mandatory update policy row: polls the version service and reports phases to the launcher. */

import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { BRAND_UPDATE_SERVICE } from './generated-product-identity.ts'
import { productPackageVersion } from './package-version.ts'
import {
  DESKTOP_MANDATORY_POLICY_STATE_FILENAME,
  DesktopMandatoryUpdatePolicyClient,
  readDesktopMandatoryPolicyState,
  writeDesktopMandatoryPolicyState,
  type DesktopMandatoryUpdateSnapshot,
} from './desktop-mandatory-policy.ts'

/** Narrow launcher surface this row consumes (probed, never required). */
interface PolicyLauncherRuntime {
  readonly platform: NodeJS.Platform
  readonly updates?: { readonly statePath?: string }
  reportMandatoryUpdatePolicy(policy: DesktopMandatoryUpdateSnapshot | null): void
  registerTrayItem(item: {
    group: string
    order: number
    label: () => string
    enabled?: () => boolean
    invoke: () => Promise<void>
  }): { refresh(): void; dispose(): void }
  notify?(options: { title: string; body: string }): void
}

/** Host-side policy surface probed by the shell's mandatory update gate. */
export interface SensteedMandatoryUpdatePolicy {
  snapshot(): { phase: 'none' | 'notice' | 'blocking'; minVersion?: string }
}

declare module '@deepseek-ai/cordis' {
  interface Context { sensteedMandatoryUpdatePolicy: SensteedMandatoryUpdatePolicy }
}

export const name = 'dofe-product-update-policy'
export const inject = []

export async function apply(ctx: Context): Promise<void> {
  let runtime: PolicyLauncherRuntime | undefined
  try {
    runtime = (ctx as { desktopRuntime?: PolicyLauncherRuntime }).desktopRuntime
  } catch {
    return
  }
  if (runtime === undefined) return

  const localeTag = (() => {
    try { return (ctx as unknown as { locale?: { bind?(): (key: string) => string } }).locale?.bind?.()('') ?? '' } catch { return '' }
  })()
  const zh = !localeTag.startsWith('en')
  let snapshot: DesktopMandatoryUpdateSnapshot = { phase: 'none', observedAt: new Date(0).toISOString() }
  let tray: { refresh(): void; dispose(): void } | undefined
  const syncSurfaces = (): void => {
    if (snapshot.phase === 'none') {
      runtime!.reportMandatoryUpdatePolicy(null)
      tray?.dispose()
      tray = undefined
      return
    }
    runtime!.reportMandatoryUpdatePolicy(snapshot)
    const minVersion = snapshot.minVersion ?? ''
    if (tray === undefined) {
      tray = runtime!.registerTrayItem({
        group: 'status',
        order: 1,
        label: () => snapshot.phase === 'blocking'
          ? (zh ? `需要更新到 ${minVersion}` : `Update to ${minVersion} required`)
          : (zh ? `建议更新到 ${minVersion}` : `Update to ${minVersion} recommended`),
        enabled: () => true,
        invoke: async () => { runtime!.notify?.({ title: snapshot.notice?.title ?? (zh ? '需要更新' : 'Update required'), body: snapshot.notice?.zh ?? snapshot.notice?.en ?? snapshot.notice?.detail ?? '' }) },
      })
    } else {
      tray.refresh()
    }
    runtime!.notify?.({
      title: snapshot.notice?.title ?? (zh ? '需要更新' : 'Update required'),
      body: snapshot.notice?.zh ?? snapshot.notice?.en ?? snapshot.notice?.detail
        ?? (zh ? `当前版本低于服务端要求的最低版本 ${minVersion}。` : `This build is below the required minimum version ${minVersion}.`),
    })
  }

  // Restore the persisted phase before the first poll so a blocking phase
  // survives restarts even when the policy service is unreachable.
  const updatesStateDir = runtime.updates?.statePath === undefined ? undefined : dirname(runtime.updates.statePath)
  const statePath = updatesStateDir === undefined ? undefined : join(updatesStateDir, DESKTOP_MANDATORY_POLICY_STATE_FILENAME)
  const persisted = statePath === undefined ? undefined : readDesktopMandatoryPolicyState(statePath)
  if (persisted !== undefined) {
    snapshot = persisted
    syncSurfaces()
  }

  ctx.provide('sensteedMandatoryUpdatePolicy', {
    snapshot: () => ({ phase: snapshot.phase, minVersion: snapshot.minVersion }),
  })
  const client = new DesktopMandatoryUpdatePolicyClient({
    endpoint: BRAND_UPDATE_SERVICE.endpoint,
    currentVersion: productPackageVersion(),
    request: (url, init) => globalThis.fetch(url, init),
    onSnapshot: next => {
      snapshot = next
      syncSurfaces()
    },
    onState: async (path, next) => { await writeDesktopMandatoryPolicyState(path, next) },
    ...(statePath === undefined ? {} : { statePath }),
  })
  ctx.effect(() => {
    client.start()
    return () => { client.dispose() }
  }, '@dofe/dsh-sensteed-product: mandatory update policy lifetime')
}
