/** Catalog browsing never narrows the complete selection sent to the Host. */
import { useState } from 'react'
import { Blocks, Sparkles, Search, PackageCheck } from 'lucide-react'
import { hubBlocked, hubKey, type HubCheck, type HubEntry, type HubKind, type HubSelection } from './hub-setup-state.ts'
import type { DofeAccessLocaleKey } from './dofe-access.ts'
type Copy = (key: DofeAccessLocaleKey) => string

function statusKey(entry: HubEntry): DofeAccessLocaleKey {
  switch (entry.disposition) {
    case 'UNPUBLISHED': return 'catalogUnpublished'
    case 'CURRENT': return 'catalogCurrent'
    case 'UPDATE': return 'catalogUpdate'
    case 'USER_REMOVED': return 'catalogRemoved'
    case 'INSTALL': case 'AVAILABLE': return 'catalogReady'
    default: return 'catalogUnavailable'
  }
}

export function HubCatalog({ check, kind, selection, disabled, change, t }: {
  check: HubCheck; kind?: HubKind | undefined; selection: HubSelection[]; disabled: boolean
  change: (entry: HubEntry, action: string) => void; t: Copy
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const entries = check.entries.filter(entry => kind === undefined || entry.kind === kind)
  const installed = new Set(check.activeItems.map(hubKey))
  const visible = entries.filter(entry => entry.displayName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    && (filter === 'all' || (filter === 'installed' ? installed.has(hubKey(entry)) : !hubBlocked(entry) && !installed.has(hubKey(entry)))))
  return <>
    <div className="dshHubToolbar">
      <label className="dshHubSearch"><Search size={16} aria-hidden="true" /><input type="search" aria-label={t('catalogSearch')} placeholder={t('catalogSearch')} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <select aria-label={t('catalogFilter')} value={filter} onChange={event => setFilter(event.target.value)}>
        <option value="all">{t('catalogAll')} ({entries.length})</option><option value="installed">{t('catalogInstalled')}</option><option value="available">{t('catalogAvailable')}</option>
      </select>
    </div>
    {visible.length === 0 ? <p className="dshHubEmpty" role="status">{t(entries.length ? 'catalogNoMatches' : 'catalogEmpty')}</p> : <ul className="dshHubCatalog">{visible.map(entry => {
      const active = installed.has(hubKey(entry)), unavailable = hubBlocked(entry)
      const chosen = selection.find(item => hubKey(item) === hubKey(entry))
      const Icon = entry.kind === 'plugin' ? Blocks : Sparkles
      return <li className="dshHubCard" key={hubKey(entry)}>
        <div className="dshHubCardHeading"><span className="dshHubGlyph"><Icon size={22} aria-hidden="true" /></span><div className="dshHubCardTitle"><h3>{entry.displayName}</h3><span className="dshHubMeta">{entry.version ?? t('hubUnpublished')}</span></div>{entry.required && <span className="dshHubBadge">{t('catalogRequired')}</span>}</div>
        <p className="dshHubStatus" data-available={!unavailable}>{active && <PackageCheck size={14} aria-hidden="true" />}{t(active && unavailable ? 'catalogInstalled' : statusKey(entry))}</p>
        {unavailable && <p className="dshHubHint">{t(entry.disposition === 'UNPUBLISHED' ? 'catalogUnpublishedHint' : 'catalogUnavailableHint')}</p>}
        <div className="dshHubCardFooter"><span className="dshHubMeta">{t(active ? 'catalogInstalled' : 'catalogNotInstalled')}</span>
          {(!unavailable || active || entry.required) && <label className="dshHubAction"><span>{t('hubAction')}</span><select aria-label={`${entry.displayName} ${t('hubAction')}`} disabled={disabled || unavailable && !active} value={chosen?.action ?? 'skip'} onChange={event => change(entry, event.target.value)}>
            {!entry.required && !active && <option value="skip">{t('hubSkip')}</option>}
            {active && <option value="retain">{t('hubRetain')}</option>}
            {!unavailable && <option value={active ? 'update' : 'install'}>{t(active ? 'hubUpdate' : 'hubInstall')}</option>}
            {unavailable && !active && entry.required && <option value="install">{t('hubBlocked')}</option>}
            {active && !entry.required && <option value="uninstall">{t('hubRemove')}</option>}
          </select></label>}
        </div>
        <details className="dshHubDetails"><summary>{t('catalogDetails')}</summary><code>{entry.itemId}</code><p>{entry.disposition}{entry.reason ? ` · ${entry.reason}` : ''}</p></details>
      </li>
    })}</ul>}
  </>
}
