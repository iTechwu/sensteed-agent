/** One brand-aware activation gate for every desktop distribution. */
import { BRAND_VARIANT } from '../generated-product-identity.ts'
import { SensteedUserSettingsTrigger } from './SensteedUserSettingsTrigger.tsx'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { DofeAccessSection, DofeUserSection, DofeModelSection, DofeCapabilitiesSection, installDofeAccessGate, installDofeAccessStyles } from './DofeAccessSection.tsx'
import { registerDofePluginItems } from './DofePluginItems.tsx'
import { DOFE_ACCESS_COPY } from './dofe-access.ts'
import { DOFE_ACCESS_SETTINGS_NAMESPACE, type DofeAccessSettings } from '../dofe-plugins.ts'

export function applyDofeAccess(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('dofe.access', DOFE_ACCESS_COPY), 'desktop: access dictionaries')
  ctx.effect(() => installDofeAccessStyles(), 'desktop: access styles')
  const settingsScope = ctx.configForms.get<DofeAccessSettings>(DOFE_ACCESS_SETTINGS_NAMESPACE)
  const t = ctx.locale.bind('dofe.access')
  const props = { credentials: ctx.remote.credentials, settingsApi: ctx.remote.settings, settingsScope, t }
  ctx.effect(() => installDofeAccessGate(props), 'desktop: mandatory access gate')
  // The Plugins page lists every brand-eligible DoFe datasource as a read-only
  // card; the activation switches live on the Built-in capabilities page.
  registerDofePluginItems(ctx, settingsScope, t)
  if (BRAND_VARIANT === 'sensteed') {
    ctx.slots.inject('settings.trigger', () => ctx.slots.register({
      name: 'settings.trigger', priority: -100, inject: () => ({ settingsScope }),
    }, SensteedUserSettingsTrigger))
  }
  if (BRAND_VARIANT === 'sensteed') {
    for (const section of [
      { id: 'dofe-access', order: -100, label: 'nav', component: DofeUserSection },
      { id: 'models', order: 10, label: 'modelNav', component: DofeModelSection },
      { id: 'dofe-capabilities', order: 12, label: 'capabilityNav', component: DofeCapabilitiesSection },
    ] as const) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: section.id, order: section.order,
        label: () => t(section.label), locale: 'dofe.access', inject: () => props,
      }, section.component))
    }
    return
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'dofe-access', order: 20,
    label: () => t('nav'), locale: 'dofe.access', inject: () => props,
  }, DofeAccessSection))
}
