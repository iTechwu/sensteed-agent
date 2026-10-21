/** Sidebar rail subscription for desktop update availability. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DesktopSettingsApi } from './desktop-settings-api.ts'
import type { DesktopUpdateStatus } from '../update-status.ts'

const POLL_INTERVAL_MS = 30 * 60 * 1000

/** Availability state and install action behind the rail's update entry. */
export interface DesktopUpdateRail {
  readonly available: boolean
  readonly latestVersion?: string
  readonly busy: boolean
  start(): Promise<void>
}

/**
 * Poll the generation-owned update status so the rail can offer the install
 * flow. Host checks coalesce per channel, and a failed poll keeps the last
 * state: a transient hub error must not hide a genuinely available update
 * that starting the flow would still install.
 */
export function useDesktopUpdateRail(api?: DesktopSettingsApi): DesktopUpdateRail {
  const [status, setStatus] = useState<DesktopUpdateStatus>()
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)
  const pending = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const apply = useCallback((next: DesktopUpdateStatus): void => {
    if (next.status !== 'failed') setStatus(next)
  }, [])
  const inspect = useCallback(async (): Promise<void> => {
    if (!api?.inspectUpdates || pending.current || document.hidden) return
    try {
      const next = await api.inspectUpdates()
      if (mounted.current) apply(next)
    } catch {
      // Availability display is best-effort; keep the previous state.
    }
  }, [api, apply])
  useEffect(() => {
    if (!api?.inspectUpdates) return
    void inspect()
    const timer = setInterval(() => { void inspect() }, POLL_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [api, inspect])
  const start = useCallback(async (): Promise<void> => {
    if (!api || pending.current) return
    pending.current = true
    setBusy(true)
    try {
      // The interactive flow spans native confirmation, download, and the
      // restart prompt; it resolves only after every dialog is settled.
      await api.checkForUpdates()
      const next = await api.inspectUpdates?.()
      if (mounted.current && next !== undefined) apply(next)
    } catch {
      // Failures already surface through native dialogs and notifications.
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }, [api, apply])
  const available = status?.status === 'update-available'
  return {
    available,
    ...(available && status?.latestVersion !== undefined ? { latestVersion: status.latestVersion } : {}),
    busy,
    start,
  }
}
