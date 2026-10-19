/** Register product-owned navigation independently of native package admission. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { HubSetupSection } from './HubSetupSection.tsx'
import { Blocks, Sparkles } from 'lucide-react'
import { HubPage, type CatalogSkill } from './HubPage.tsx'
import { startCreatorConversation } from './CreatePluginMenuItem.tsx'
import { installHubCatalogStyles } from './hub-catalog-styles.ts'
import type { DofeAccessSettings } from '../dofe-plugins.ts'
import type { DofeAccessLocaleKey } from './dofe-access.ts'

export function registerHubPages(ctx: Context, props: {
  settingsScope: ConfigForm<DofeAccessSettings>
  t: (key: DofeAccessLocaleKey) => string
  subscribeReconnect: (listener: () => void) => () => void
}): void {
  ctx.effect(installHubCatalogStyles, 'sensteed: catalog styles')
  const loadSkills = async (signal: AbortSignal): Promise<readonly CatalogSkill[]> => {
    const sessions = ctx.sessions.list.getSnapshot()
    const latest = sessions.ids.map(id => sessions.byId[id]).filter(value => value !== undefined).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (!latest) return []
    const result = await ctx.remote.skills.list({ sessionId: latest.id }, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value.skills
  }
  // The legacy page remains the default when its Host services are present.
  ctx.slots.inject('plugins.tab', () => ctx.slots.register({
    name: 'plugins.tab', id: 'sensteed-enterprise', order: 1, label: () => props.t('catalogTab'),
    locale: 'dofe.access', inject: () => ({ ...props, kind: 'plugin' as const }),
  }, HubSetupSection))
  for (const [kind, id, order, Icon, label] of [
    ['plugin', 'plugins', 0, Blocks, 'pluginsNav'],
    ['skill', 'sensteed-skill-manager', 1, Sparkles, 'skillsNav'],
  ] as const) {
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main', key: id, priority: 100, locale: 'dofe.access',
      inject: () => ({ ...props, kind, loadSkills, create: async () => { await startCreatorConversation(ctx, kind) } }),
    }, HubPage))
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist', id, priority: -100, order, label: () => props.t(label), locale: 'dofe.access',
    }, ({ size }) => <Icon size={size} aria-hidden="true" />))
  }
}
