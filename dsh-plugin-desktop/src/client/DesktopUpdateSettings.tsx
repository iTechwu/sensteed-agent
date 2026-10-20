/** Non-blocking version inspection with an explicit, confirmed install action. */
import { useRef, useState, useEffect } from 'react'
import type { DesktopSettingsApi } from './desktop-settings-api.ts'
import type { DesktopUpdateStatus } from '../update-status.ts'
import type { zh } from './desktop-settings-locales.ts'

type Translate = (key: keyof typeof zh) => string

export function DesktopUpdateSettings({ api, version, t }: {
  readonly api: DesktopSettingsApi
  readonly version: string
  readonly t: Translate
}) {
  const [busy, setBusy] = useState<'checking' | 'installing'>()
  const [result, setResult] = useState<DesktopUpdateStatus>()
  const [failed, setFailed] = useState(false)
  const mounted = useRef(true)
  const pending = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const run = async (install = false): Promise<void> => {
    if (pending.current) return
    pending.current = true
    setBusy(install ? 'installing' : 'checking')
    setFailed(false)
    try {
      if (install || !api.inspectUpdates) await api.checkForUpdates()
      else {
        const next = await api.inspectUpdates()
        if (mounted.current) setResult(next)
      }
    } catch {
      if (mounted.current) setFailed(true)
    } finally {
      pending.current = false
      if (mounted.current) setBusy(undefined)
    }
  }
  const failureKeys = {
    network: 'updateNetworkError', timeout: 'updateTimeoutError', unpublished: 'updateUnpublished',
    service: 'updateServiceError', 'invalid-response': 'updateProtocolError',
    'invalid-version': 'updateVersionError', download: 'updateDownloadError',
    'unsupported-target': 'updateUnsupportedTarget', 'manual-migration-required': 'updateManualMigration',
  } as const
  const message = failed ? t('checkForUpdatesError')
    : busy === 'installing' ? t('updateInstalling')
    : busy === 'checking' ? t('checkingForUpdates')
    : result?.status === 'failed' ? t(failureKeys[result.failure ?? 'service'])
    : result?.status === 'up-to-date' ? t('updateCurrent')
    : result?.status === 'update-available' ? `${t('updateAvailable')} v${result.latestVersion}`
    : t('updatePolicy')
  const isError = !busy && (failed || (result?.status === 'failed' && result.failure !== 'unpublished'))

  return (
    <section className="sensteedAgentSettingsGroup" aria-labelledby="dsh-desktop-updates-title">
      <div>
        <h3 id="dsh-desktop-updates-title">{t('updatesTitle')}</h3>
        <p className="sensteedAgentSettingsGroupIntro">{t('updatesIntro')}</p>
      </div>
      <div className="sensteedAgentSettingsUpdateRow" aria-busy={busy !== undefined}>
        <span className="sensteedAgentSettingsChoiceCopy">
          <span className="sensteedAgentSettingsChoiceTitle">{t('currentVersion')}</span>
          <span className="sensteedAgentSettingsChoiceBody">{`v${version}`}</span>
          {result && <span className="sensteedAgentSettingsChoiceBody">
            {t('updateChannel')}: {t(result.channel === 'beta' ? 'updateBeta' : result.channel === 'next' ? 'updateNext' : 'updateStable')}
          </span>}
        </span>
        <button type="button" className="sensteedAgentSettingsButton" disabled={busy !== undefined}
          onClick={() => { void run() }}>
          {t(busy === 'checking' ? 'checkingForUpdates' : 'checkForUpdates')}
        </button>
      </div>
      <p className={isError ? 'sensteedAgentSettingsError' : 'sensteedAgentSettingsGroupIntro'}
        role={isError ? 'alert' : 'status'} aria-live="polite">{message}</p>
      {result && <p className="sensteedAgentSettingsGroupIntro">
        {t('updateLastChecked')}: <time dateTime={result.checkedAt}>{new Date(result.checkedAt).toLocaleString()}</time>
      </p>}
      {result?.status === 'update-available' && <button type="button" className="sensteedAgentSettingsButton"
        disabled={busy !== undefined} onClick={() => { void run(true) }}>
        {t(busy === 'installing' ? 'updateInstalling' : 'updateDownload')}
      </button>}
    </section>
  )
}
