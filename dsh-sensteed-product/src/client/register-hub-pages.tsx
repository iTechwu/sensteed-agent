/** Register product-owned navigation independently of native package admission. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { sensteedHubCatalog: unknown }
}

import { createHubNavigation, nativeHubNavigation, HubContext } from './HubNavigation.tsx'
import { HubSetupSection } from './HubSetupSection.tsx'
import { ProfileSwitcher } from './profile-switcher.tsx'
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
    const latest = sessions.ids.map(id => sessions.byId[id]).filter(value => value !== undefined).filter(value => value.origin !== 'subagent').sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (!latest) return []
    return ctx.sessions.using(latest.id, { source: 'sensteedHubCatalog', signal }, async reference => {
      signal.throwIfAborted()
      const session = reference.binding.session.getSnapshot()
      if (session.openState !== 'open') throw session.openError ?? new Error('Session unavailable')
      const result = await ctx.remote.skills.list({ sessionId: latest.id }, signal)
      signal.throwIfAborted()
      if (!result.ok) throw new Error(result.error.message)
      return result.value.skills
    })
  }
  // The legacy page remains the default when its Host services are present.
  ctx.slots.inject('plugins.tab', () => ctx.slots.register({
    name: 'plugins.tab', id: 'sensteed-enterprise', order: 1, label: () => props.t('catalogTab'),
    locale: 'dofe.access', inject: () => ({ ...props, kind: 'plugin' as const }),
  }, HubSetupSection))
    // docs/1022 §6.1：sidebar 底部 Profile 切换器（官方 footer.action 槽；双壳共用）。
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
      name: 'sidebar.footer.action', id: 'dofe-profile-switcher', order: 5, locale: 'dofe.access',
    }, ({ wide }) => <ProfileSwitcher wide={wide} t={props.t} openHub={() => ctx.layout.selectPanel('plugins' as Parameters<typeof ctx.layout.selectPanel>[0])} />))
    for (const [kind, id, order, Icon, label] of [
    ['plugin', 'plugins', 0, Blocks, 'pluginsNav'],
    ['skill', 'sensteed-skill-manager', 1, Sparkles, 'skillsNav'],
  ] as const) {
    const navigation = createHubNavigation()
    const create = async () => { await startCreatorConversation(ctx, kind) }
    ctx.slots.inject('desktop.navigation.context' as never, () => ctx.slots.register({
      name: 'desktop.navigation.context', key: id,
      inject: () => {
        const main = ctx.slots.entriesOfSlot('main').find(entry => entry.options.key === id)
        // Native plugin manager pins one instance in its registration handle.
        const native = kind === 'plugin' && main?.component !== HubPage && main?.store && 'create' in main.store ? main.store.create() : undefined
        return { kind, navigation: native ? nativeHubNavigation(native as unknown as Parameters<typeof nativeHubNavigation>[0]) : navigation,
          create, settingsScope: props.settingsScope,
          selectPanel: (panel: 'plugins' | 'sensteed-skill-manager') => ctx.layout.selectPanel(panel as Parameters<typeof ctx.layout.selectPanel>[0]) }
      },
    } as never, HubContext))
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main', key: id, priority: 100, locale: 'dofe.access',
      inject: () => ({ ...props, kind, loadSkills, create, navigation }),
    }, HubPage))
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist', id, priority: -100, order, label: () => props.t(label), locale: 'dofe.access',
    }, ({ size }) => <Icon size={size} aria-hidden="true" />))
  }
}
