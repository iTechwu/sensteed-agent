/** Desktop management pages remain available without the native npm installer. */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Plus, Sparkles, Blocks } from 'lucide-react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DofeAccessSettings } from '../dofe-plugins.ts'
import { dofePluginsForBrand } from '../dofe-plugins.ts'
import { DofePluginCard } from './DofePluginItems.tsx'
import { HubSetupSection } from './HubSetupSection.tsx'
import type { DofeAccessLocaleKey } from './dofe-access.ts'
import type { HubKind } from './hub-setup-state.ts'

export interface CatalogSkill { name: string; description: string }
export interface HubPageProps {
  kind: HubKind
  t: (key: DofeAccessLocaleKey) => string
  settingsScope: ConfigForm<DofeAccessSettings>
  subscribeReconnect: (listener: () => void) => () => void
  create: () => Promise<void>
  loadSkills: (signal: AbortSignal) => Promise<readonly CatalogSkill[]>
}

function SkillLibrary({ loadSkills, t }: Pick<HubPageProps, 'loadSkills' | 't'>) {
  const [skills, setSkills] = useState<readonly CatalogSkill[]>(), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0), [query, setQuery] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setFailed(false); setSkills(undefined)
    void loadSkills(controller.signal).then(value => { if (!controller.signal.aborted) setSkills(value) }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [loadSkills, retry])
  const visible = skills?.filter(skill => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <section aria-label={t('localSkillsTab')}>
    <p className="dshHubHint">{t('localSkillsIntro')}</p>
    <button type="button" className="dshHubSecondary" onClick={() => setRetry(value => value + 1)}>{t('hubCheck')}</button>
    <input className="dshHubSkillSearch" type="search" aria-label={t('catalogSearch')} placeholder={t('catalogSearch')} value={query} onChange={event => setQuery(event.target.value)} />
    {failed ? <div role="alert"><p>{t('localSkillsFailed')}</p><button type="button" className="dshHubSecondary" onClick={() => setRetry(value => value + 1)}>{t('catalogRetry')}</button></div>
      : skills === undefined ? <p role="status">{t('catalogLoading')}</p>
      : visible?.length === 0 ? <p role="status" className="dshHubEmpty">{t(skills.length ? 'catalogNoMatches' : 'localSkillsEmpty')}</p>
      : <ul className="dshHubCatalog">{visible?.map(skill => <li className="dshHubCard" key={skill.name}><div className="dshHubCardHeading"><span className="dshHubGlyph"><Sparkles size={20} aria-hidden="true" /></span><h3>{skill.name}</h3></div><p className="dshHubHint">{skill.description}</p><code>/{skill.name}</code></li>)}</ul>}
  </section>
}

export function HubPage(props: HubPageProps) {
  const [connectionEpoch, setConnectionEpoch] = useState(0)
  const subscribe = useCallback((listener: () => void) => props.settingsScope.subscribe(listener), [props.settingsScope])
  const snapshot = useCallback(() => props.settingsScope.getSnapshot().value?.identity?.ssoSub, [props.settingsScope])
  const account = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => props.subscribeReconnect(() => setConnectionEpoch(value => value + 1)), [props.subscribeReconnect])
  return account ? <HubPageContent key={`${account}:${connectionEpoch}`} {...props} /> : <p role="status">{props.t('settingsLoginRequired')}</p>
}

function HubPageContent({ kind, t, create, loadSkills, ...props }: HubPageProps) {
  const [tab, setTab] = useState<'catalog' | 'installed'>('catalog'), [creating, setCreating] = useState(false), [failed, setFailed] = useState(false)
  const Icon = kind === 'plugin' ? Blocks : Sparkles
  const secondary = kind === 'plugin' ? 'builtInTab' : 'localSkillsTab'
  return <div className="dshHubPage"><div className="dshHubContent">
    <header className="dshHubHeader"><div><h1><Icon size={26} aria-hidden="true" />{t(kind === 'plugin' ? 'pluginsNav' : 'skillsNav')}</h1><p>{t(kind === 'plugin' ? 'pluginsIntro' : 'skillsIntro')}</p></div>
      <button type="button" className="dshHubPrimary" disabled={creating} onClick={() => {
        setCreating(true); setFailed(false)
        void create().catch(() => setFailed(true)).finally(() => setCreating(false))
      }}><Plus size={16} aria-hidden="true" />{t(creating ? 'catalogCreating' : kind === 'plugin' ? 'createPluginAction' : 'createSkillAction')}</button>
    </header>
    {failed && <p role="alert">{t('catalogCreateFailed')}</p>}
    <div className="dshHubTabs" role="group" aria-label={t(kind === 'plugin' ? 'pluginsNav' : 'skillsNav')}>
      <button type="button" aria-pressed={tab === 'catalog'} onClick={() => setTab('catalog')}>{t('catalogTab')}</button>
      <button type="button" aria-pressed={tab === 'installed'} onClick={() => setTab('installed')}>{t(secondary)}</button>
    </div>
    <div hidden={tab !== 'catalog'}><HubSetupSection kind={kind} t={t} {...props} /></div>
    {tab === 'installed' && (kind === 'skill' ? <SkillLibrary loadSkills={loadSkills} t={t} />
      : <ul className="dshHubCatalog">{dofePluginsForBrand('sensteed').map(plugin => <li className="dshHubCard" key={plugin.id}><h3>{plugin.name}</h3><DofePluginCard plugin={plugin} settingsScope={props.settingsScope} t={t} view="page" /></li>)}</ul>)}
  </div></div>
}
