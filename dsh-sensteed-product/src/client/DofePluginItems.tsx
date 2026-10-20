/** Read-only DoFe datasource cards for the Plugins page's official group. */
import { useMemo, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { DOFE_ACCESS_VALIDATION_VERSION, type DofeAccessSettings, type DofePluginId } from '../dofe-plugins.ts'
import type { DofeAccessLocaleKey } from './dofe-access.ts'
import { dofeAccessSettingsStore } from './DofeAccessSection.tsx'
import { pluginPresentations } from '../plugin-presentations.ts'
import { BRAND_VARIANT } from '../generated-product-identity.ts'

type Copy = (key: DofeAccessLocaleKey) => string

/** How the Plugins page card reports one capability's activation. */
type DofePluginCardState = 'built-in' | 'enabled' | 'unentitled' | 'disabled'

interface DofePluginCardInjected {
  readonly plugin: { id: DofePluginId; name: string; description: string; servers: readonly string[]; access?: 'basic' | 'business'; builtIn: boolean; ownerName?: string }
  readonly settingsScope: ConfigForm<DofeAccessSettings>
  readonly t: Copy
}

type DofePluginCardProps = Pick<PropsRuntime<'plugins.item'>, 'view'> & DofePluginCardInjected

/** Derive the reported state from the same gate the settings section writes. */
export function dofePluginCardState(plugin: { id: DofePluginId; access?: 'basic' | 'business'; builtIn: boolean; ownerName?: string }, settings: DofeAccessSettings | undefined): DofePluginCardState {
  if (plugin.builtIn) return 'built-in'
  if (plugin.access === 'basic') return settings?.enabledPlugins.includes(plugin.id) ? 'enabled' : 'disabled'
  if (!settings?.setupComplete || settings.validationVersion !== DOFE_ACCESS_VALIDATION_VERSION) return 'disabled'
  if (!settings.entitlements?.plugins.includes(plugin.id)) return 'unentitled'
  return settings.enabledPlugins.includes(plugin.id) ? 'enabled' : 'disabled'
}

const STATE_LABEL_KEY: Record<DofePluginCardState, DofeAccessLocaleKey> = {
  'built-in': 'pluginStateBuiltIn',
  enabled: 'pluginStateEnabled',
  unentitled: 'pluginStateUnentitled',
  disabled: 'pluginStateDisabled',
}

/** Render the one-liner or the detail page, as the Plugins page asks. */
export function DofePluginCard(props: DofePluginCardProps) {
  const store = useMemo(() => dofeAccessSettingsStore(props.settingsScope), [props.settingsScope])
  const settings = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const { plugin, t } = props
  const state = dofePluginCardState(plugin, settings.value)
  const stateLabel = t(STATE_LABEL_KEY[state])
  const stateClass = `dshDofePluginState${state === 'built-in' || state === 'enabled' ? ' dshDofePluginStateOn' : ''}`
  if (props.view === 'summary') {
    return <span className="dshDofePluginSummary">
      <span className={stateClass}>{stateLabel}</span>
      {plugin.description}
      {plugin.ownerName && <small>由 {plugin.ownerName} 提供，共用启用与授权</small>}
    </span>
  }
  return <div className="dshDofePluginPage">
    <p className="dshDofePluginDescription">{plugin.description}</p>
    {plugin.ownerName && <p className="dshHubHint">由 {plugin.ownerName} 提供，共用启用与授权；连接健康状态以实际调用结果为准。</p>}
    <div className="dshDofeAccessField">
      <span className="dshDofeAccessLabel">{t('pluginStateTitle')}</span>
      <span className={stateClass}>{stateLabel}</span>
    </div>
    <details className="dshHubDetails"><summary>{t('pluginServersTitle')}</summary>
      {plugin.servers.length > 0
        ? <ul className="dshDofePluginServers">{plugin.servers.map(server => <li className="dshDofePluginServer" key={server}>{server}</li>)}</ul>
        : <span className="dshDofeAccessHint">{t('pluginNoServer')}</span>}
    </details>
    {!plugin.builtIn && <p className="dshDofePluginHint">{t('pluginManageHint')}</p>}
  </div>
}

/**
 * Register one Plugins page card per brand-eligible catalog capability, after
 * the upstream official plugins (orders 10-40). The cards are read-only: the
 * activation switch stays in the DoFe access settings section.
 * @param ctx - browser Cordis context carrying the slot registry.
 * @param settingsScope - the DoFe access scope the cards report from.
 * @param t - the access dictionary binding for card copy.
 */
export function registerDofePluginItems(ctx: Context, settingsScope: ConfigForm<DofeAccessSettings>, t: Copy): void {
  pluginPresentations(BRAND_VARIANT).forEach(({ key, plugin }, index) => {
    ctx.slots.inject('plugins.item', () => ctx.slots.register({
      name: 'plugins.item',
      id: `dofe-${key}`,
      order: 100 + index * 10,
      label: () => plugin.name,
      inject: () => ({ plugin, settingsScope, t }),
    }, DofePluginCard))
  })
}
