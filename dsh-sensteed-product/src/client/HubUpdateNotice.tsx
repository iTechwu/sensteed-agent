import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DofeAccessSettings } from '../dofe-plugins.ts'
import type { DofeAccessLocaleKey } from './dofe-access.ts'
import { createHubUpdateMonitor, hubUpdateRequest, type HubPublishedUpdate } from './hub-update-monitor.ts'

type Props = {
  settingsScope: ConfigForm<DofeAccessSettings>
  t: (key: DofeAccessLocaleKey) => string
  subscribeReconnect: (listener: () => void) => () => void
}

export function HubUpdateNotice({ settingsScope, t, subscribeReconnect }: Props) {
  const [updates, setUpdates] = useState<HubPublishedUpdate[]>()
  useEffect(() => {
    const monitor = createHubUpdateMonitor(signal => hubUpdateRequest(signal), setUpdates)
    let lastAccount: string | undefined
    const sync = (): void => {
      const value = settingsScope.getSnapshot().value
      const account = value?.authMode === 'feishu' ? value.identity?.ssoSub : undefined
      monitor.account(account)
      if (account !== lastAccount) { setUpdates(undefined); lastAccount = account }
    }
    const stopSettings = settingsScope.subscribe(sync)
    const stopConnection = subscribeReconnect(() => { setUpdates(undefined); monitor.reconnect() })
    sync()
    return () => { stopSettings(); stopConnection(); monitor.dispose() }
  }, [settingsScope, subscribeReconnect])
  if (updates === undefined || updates.length === 0) return null
  return <aside role="status" aria-label={t('hubUpdateNotice')} style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 1000, padding: 16, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l1, #ddd)', background: 'var(--dsw-alias-bg-layer-1, white)', maxWidth: 360, boxShadow: '0 4px 16px #0002' }}>
    <strong>{t('hubUpdateNotice')}</strong>
    <p>{t('hubUpdateAvailable')}: {updates.length}</p>
    <ul>{updates.map(update => <li key={`${update.kind}:${update.itemId}`}>{update.displayName} · {update.version}</li>)}</ul>
  </aside>
}

export function installHubUpdateNotice(props: Props): () => void {
  const node = document.createElement('div')
  node.id = 'dsh-hub-update-notice'
  document.body.append(node)
  const root = createRoot(node)
  root.render(<HubUpdateNotice {...props} />)
  return () => { root.unmount(); node.remove() }
}
