/** Branded first-paint boot surface injected by the Desktop renderer preload. */

/** DOM id of the boot splash overlay; shared with the client face that dismisses it. */
export const DESKTOP_BOOT_SPLASH_ID = 'sensteed-agent-boot-splash'
/** DOM id of the one stylesheet the splash installs. */
export const DESKTOP_BOOT_SPLASH_STYLE_ID = 'sensteed-agent-boot-splash-style'
/** Attribute set while the splash fades out, so repeat dismissals stay one transition. */
export const DESKTOP_BOOT_SPLASH_LEAVING = 'data-sensteed-agent-boot-leaving'

/**
 * The splash must never outlive a broken boot by more than the surface
 * watchdog needs; past this point renderer recovery owns the window.
 */
export const DESKTOP_BOOT_SPLASH_MAX_LIFETIME_MS = 20_000
export const DESKTOP_BOOT_SPLASH_FADE_MS = 240

const BOOT_SPLASH_CSS = `
#${DESKTOP_BOOT_SPLASH_ID} {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: grid;
  place-content: center;
  justify-items: center;
  row-gap: 18px;
  background: #202124;
  color: #e8eaed;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  pointer-events: none;
  opacity: 1;
  transition: opacity ${DESKTOP_BOOT_SPLASH_FADE_MS}ms ease;
}
#${DESKTOP_BOOT_SPLASH_ID}[${DESKTOP_BOOT_SPLASH_LEAVING}="true"] { opacity: 0; }
#${DESKTOP_BOOT_SPLASH_ID} .sensteedAgentBootSplashName {
  font-size: 15px;
  letter-spacing: .04em;
}
#${DESKTOP_BOOT_SPLASH_ID} .sensteedAgentBootSplashBar {
  position: relative;
  width: 96px;
  height: 2px;
  overflow: hidden;
  border-radius: 999px;
  background: #ffffff1f;
}
#${DESKTOP_BOOT_SPLASH_ID} .sensteedAgentBootSplashBar::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 36px;
  border-radius: 999px;
  background: #7aaaff;
  animation: sensteedAgentBootSplashSlide 1.1s ease-in-out infinite;
}
@keyframes sensteedAgentBootSplashSlide {
  from { transform: translateX(-40px); }
  to { transform: translateX(100px); }
}
@media (prefers-reduced-motion: reduce) {
  #${DESKTOP_BOOT_SPLASH_ID} .sensteedAgentBootSplashBar::after { animation: none; }
  #${DESKTOP_BOOT_SPLASH_ID} { transition: none; }
}
`

/**
 * Paint a branded launch surface the moment the window first renders, so a
 * cold start or restart shows a transition instead of an empty dark frame.
 * The client face dismisses it once the shell surfaces exist; the lifetime
 * cap bounds the case where they never do.
 */
export function installBootSplash(brandName: string): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(DESKTOP_BOOT_SPLASH_ID) !== null) return
  if (document.getElementById(DESKTOP_BOOT_SPLASH_STYLE_ID) === null) {
    const style = document.createElement('style')
    style.id = DESKTOP_BOOT_SPLASH_STYLE_ID
    style.textContent = BOOT_SPLASH_CSS
    ;(document.head ?? document.documentElement).appendChild(style)
  }
  const splash = document.createElement('div')
  splash.id = DESKTOP_BOOT_SPLASH_ID
  splash.setAttribute('role', 'status')
  splash.setAttribute('aria-label', `${brandName} loading`)
  const name = document.createElement('span')
  name.className = 'sensteedAgentBootSplashName'
  name.textContent = brandName
  const bar = document.createElement('span')
  bar.className = 'sensteedAgentBootSplashBar'
  bar.setAttribute('aria-hidden', 'true')
  splash.appendChild(name)
  splash.appendChild(bar)
  ;(document.body ?? document.documentElement).appendChild(splash)
  setTimeout(dismissBootSplash, DESKTOP_BOOT_SPLASH_MAX_LIFETIME_MS)
}

/** Fade the splash out once; later calls during the fade are no-ops. */
export function dismissBootSplash(): void {
  if (typeof document === 'undefined') return
  const splash = document.getElementById(DESKTOP_BOOT_SPLASH_ID)
  if (splash === null) return
  if (splash.getAttribute(DESKTOP_BOOT_SPLASH_LEAVING) === 'true') return
  splash.setAttribute(DESKTOP_BOOT_SPLASH_LEAVING, 'true')
  setTimeout(() => { splash.remove() }, DESKTOP_BOOT_SPLASH_FADE_MS)
}
