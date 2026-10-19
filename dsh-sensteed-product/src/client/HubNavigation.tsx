/** Shared selection lets the context column drive the existing catalog page. */
import { useCallback, useState, useSyncExternalStore } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { dofePluginsForBrand, type DofeAccessSettings } from '../dofe-plugins.ts'
import { BRAND_VARIANT } from '../generated-product-identity.ts'
import { dofePluginCardState } from './DofePluginItems.tsx'
import { Blocks, Sparkles } from 'lucide-react'

export function createHubNavigation() {
  let tab: 'catalog' | 'installed' = 'catalog'
  const listeners = new Set<() => void>()
  let pluginId: string | null = null
  const emit = () => { for (const listener of listeners) listener() }
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
  return {
    getSnapshot: () => tab,
    subscribe,
    selectedPlugin: { getSnapshot: () => pluginId, subscribe },
    openPlugin: (id: string) => { pluginId = id; tab = 'installed'; emit() },
    select: (value: typeof tab) => { if (tab === value && pluginId === null) return; pluginId = null; tab = value; emit() },
  }
}
export type HubNavigation = ReturnType<typeof createHubNavigation>

export function HubContext({ kind, navigation, selectPanel, create, settingsScope }: {
  settingsScope: ConfigForm<DofeAccessSettings>
  kind: 'plugin' | 'skill'; navigation: HubNavigation
  selectPanel: (id: 'plugins' | 'sensteed-skill-manager') => void
  create: () => Promise<void>
}) {
  const selectedPlugin = useSyncExternalStore(navigation.selectedPlugin.subscribe, navigation.selectedPlugin.getSnapshot, navigation.selectedPlugin.getSnapshot)
  const tab = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const subscribeSettings = useCallback((listener: () => void) => settingsScope.subscribe(listener), [settingsScope])
  const readSettings = useCallback(() => settingsScope.getSnapshot(), [settingsScope])
  const settings = useSyncExternalStore(subscribeSettings, readSettings, readSettings).value
  const installed = settings?.identity?.ssoSub ? dofePluginsForBrand(BRAND_VARIANT).filter(plugin => ['built-in', 'enabled'].includes(dofePluginCardState(plugin, settings))) : []
  return <nav className="sensteedBusinessNavigation" aria-label="自定义导航">
    <button type="button" aria-current={kind === 'plugin' ? 'page' : undefined} onClick={() => selectPanel('plugins')}><Blocks size={16} /> 插件</button>
    <button type="button" aria-current={kind === 'skill' ? 'page' : undefined} onClick={() => selectPanel('sensteed-skill-manager')}><Sparkles size={16} /> 技能</button>
    <p className="sensteedContextGroup">{kind === 'plugin' ? '插件管理' : '技能管理'}</p>
    <button type="button" aria-current={tab === 'catalog' ? 'page' : undefined} onClick={() => navigation.select('catalog')}>发现与安装</button>
    <button type="button" aria-current={tab === 'installed' ? 'page' : undefined} onClick={() => navigation.select('installed')}>{kind === 'plugin' ? '内置与已启用' : '本地技能'}</button>
    {kind === 'plugin' && installed.length > 0 && <><p className="sensteedContextGroup">内置与已启用</p>{installed.map(plugin => <button key={plugin.id} type="button" aria-current={selectedPlugin === plugin.id ? 'page' : undefined} onClick={() => navigation.openPlugin(plugin.id)}>{plugin.name}</button>)}</>}
    <CreateAction create={create} label={kind === 'plugin' ? '创建插件' : '创建技能'} />
  </nav>
}
function CreateAction({ create, label }: { create: () => Promise<void>; label: string }) {
  // Creation remains owned by the same conversation flow as the main page.
  const [state, setState] = useState<'idle' | 'pending' | 'error'>('idle')
  return <><button type="button" disabled={state === 'pending'} onClick={() => { setState('pending'); void create().then(() => setState('idle'), () => setState('error')) }}>＋ {label}</button>{state === 'error' && <p role="alert">创建失败，请重试</p>}</>
}

/** Adapt the native manager's pinned registration store without replacing its page. */
export function nativeHubNavigation(source: {
  getSnapshot: () => { tab: string; view?: { kind: string; id?: string } }
  subscribe: (listener: () => void) => () => void
  actions: { setTab: (tab: string) => void; setView: (view: { kind: 'list' } | { kind: 'item'; id: string }) => void }
}): HubNavigation {
  return {
    getSnapshot: () => source.getSnapshot().tab === 'installed' ? 'installed' : 'catalog',
    subscribe: source.subscribe,
    selectedPlugin: { subscribe: source.subscribe, getSnapshot: () => { const view = source.getSnapshot().view; return view?.kind === 'item' ? view.id?.replace(/^dofe-/, '') ?? null : null } },
    openPlugin: id => { source.actions.setTab('installed'); source.actions.setView({ kind: 'item', id: `dofe-${id}` }) },
    select: tab => { source.actions.setView({ kind: 'list' }); source.actions.setTab(tab === 'installed' ? 'installed' : 'sensteed-enterprise') },
  }
}
