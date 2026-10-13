/** Client-face dismissal of the preload-injected boot splash. */

import {
  DESKTOP_BOOT_SPLASH_MAX_LIFETIME_MS,
  dismissBootSplash,
} from '../boot-splash.ts'

const SURFACE_POLL_INTERVAL_MS = 100

/**
 * Fade the boot splash out once the same required surfaces the boot-health
 * reporter checks have been composed. Until then the splash keeps covering
 * the mounting client; past the splash lifetime its own cap dismisses it.
 * @param readiness - undefined when every required surface exists.
 * @param deadlineMs - polling ceiling; tests shrink this to stay fast.
 * @returns disposer that cancels the pending poll and dismissal.
 */
export function dismissBootSplashWhenSurfacesReady(
  readiness: () => string | undefined,
  deadlineMs: number = DESKTOP_BOOT_SPLASH_MAX_LIFETIME_MS,
): () => void {
  const started = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancelled = false
  const dismissOnPaint = (): void => {
    // Two frames let the shell's first paint land before the overlay fades.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) dismissBootSplash()
      })
    })
  }
  const tick = (): void => {
    if (cancelled) return
    if (readiness() === undefined) {
      dismissOnPaint()
      return
    }
    if (Date.now() - started >= deadlineMs) return
    timer = setTimeout(tick, SURFACE_POLL_INTERVAL_MS)
  }
  tick()
  return () => {
    cancelled = true
    if (timer !== undefined) clearTimeout(timer)
  }
}
