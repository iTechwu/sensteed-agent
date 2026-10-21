/** Versions-and-updates settings section registered into the official Settings shell. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { DesktopUpdateSettings } from './DesktopUpdateSettings.tsx'
import type { DesktopSettingsApi } from './desktop-settings-api.ts'

/** Registration-side business face for the Versions settings section. */
export interface DesktopVersionsSectionInjected {
  readonly api: DesktopSettingsApi
  /** Installed Desktop product version rendered by the update group. */
  readonly version: string
}

/** Renderer-composed props for the versions settings section entry. */
export type DesktopVersionsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'desktop.settings'>
  & InjectFace<DesktopVersionsSectionInjected>

export function DesktopVersionsSection({ t, api, version }: DesktopVersionsSectionProps) {
  return (
    <div className="sensteedAgentSettings">
      <header className="sensteedAgentSettingsHeader">
        <h2>{t('versionsTitle')}</h2>
        <p>{t('versionsIntro')}</p>
      </header>
      <DesktopUpdateSettings api={api} version={version} t={t} />
    </div>
  )
}
