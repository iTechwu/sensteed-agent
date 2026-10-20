/** Sealed Host identity service. It owns SSO renewal before any managed business composition. */
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_DOFE_PLUGIN_IDS, DOFE_ACCESS_SETTINGS_NAMESPACE, DOFE_ACCESS_VALIDATION_VERSION,
  supplierCapabilityUpgrade, normalizeDofeEnabledPluginIds, type DofeAccessSettings, type DofePluginId } from './dofe-plugins.ts'
import { BRAND_VARIANT } from './generated-product-identity.ts'
import { DofeAuthService } from './dofe-auth-service.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { dofeAuth: DofeAuthService; dofeAccessSettings: SettingsScope<DofeAccessSettings> }
}
export const name = 'dofe-host-auth'
export const inject = ['credentials', 'settings']
export interface DofeLauncherRuntime {
  readonly platform: NodeJS.Platform
  registerTrayItem(item: {
    group: string
    order: number
    label: () => string
    enabled: () => boolean
    invoke: () => Promise<void>
  }): { refresh(): void; dispose(): void }
  openOpenMontage(key: string): Promise<void>
  openExternal(url: string): Promise<void>
  requestDofeAuth?(url: string, init: RequestInit): Promise<Response>
}

/** Run once with the launcher runtime whenever it appears (or immediately if present). */
export function observeLauncherRuntime(ctx: Context, onReady: (runtime: DofeLauncherRuntime) => void): void {
  let observed: DofeLauncherRuntime | undefined
  const tryNow = (): void => {
    if (observed !== undefined) return
    try {
      const runtime = (ctx as { desktopRuntime?: DofeLauncherRuntime }).desktopRuntime
      if (runtime !== undefined && runtime !== null) {
        observed = runtime
        onReady(runtime)
      }
    } catch {
      // Strict service access throws while the launcher has not provided the
      // runtime; the internal/service event covers the late-arrival case.
    }
  }
  tryNow()
  const events = (ctx as { events?: { on(event: string, listener: (...args: unknown[]) => void): void } }).events
  events?.on('internal/service', (...args: unknown[]) => {
    const name = args[0]
    const value = args[1]
    if (name === 'desktopRuntime' && value) tryNow()
  })
}

/** Register this profile document exactly once, independently from business MCPs. */
export function registerDofeAccessSettings(ctx: Context): SettingsScope<DofeAccessSettings> {
  return ctx.settings.register<DofeAccessSettings>(
    DOFE_ACCESS_SETTINGS_NAMESPACE,
    z.object({
      setupComplete: z.boolean().default(false),
      validationVersion: z.number().step(1).min(0).default(0),
      supplierCapabilityInitialized: z.boolean().default(false),
      enabledPlugins: z.array(z.string()).default(DEFAULT_DOFE_PLUGIN_IDS),
      modelId: z.string().default(''),
      protocol: z.union(['chat-completions', 'messages', 'responses']).default('chat-completions'),
      authMode: z.union(['feishu', 'manual']).default('feishu'),
      identity: z.any().default(undefined),
      entitlements: z.object({ plugins: z.array(z.string()), financeAccess: z.union(['allowed', 'denied', 'unavailable']).default('unavailable'), defaultModel: z.string(), allowedProtocols: z.array(z.string()) }).default({ plugins: [], defaultModel: '', allowedProtocols: [] }),
    }),
    {
      validate: value => {
        if (!value.enabledPlugins.every(plugin => DEFAULT_DOFE_PLUGIN_IDS.includes(plugin as DofePluginId))) {
          throw new Error('dofe-managed: enabledPlugins contains an unknown built-in plugin')
        }
        if (value.setupComplete && value.validationVersion === DOFE_ACCESS_VALIDATION_VERSION && value.modelId.trim().length === 0) {
          throw new Error('dofe-managed: an active setup must select a model')
        }
      },
    },
  )
}
export async function apply(ctx: Context): Promise<void> {
  let launcher: DofeLauncherRuntime | undefined
  observeLauncherRuntime(ctx, runtime => { launcher = runtime })
  const access = registerDofeAccessSettings(ctx)
  ctx.provide('dofeAccessSettings', access)
  if (BRAND_VARIANT === 'sensteed') {
    const upgrade = supplierCapabilityUpgrade(access.get(), BRAND_VARIANT)
    if (upgrade) await ctx.settings.update(DOFE_ACCESS_SETTINGS_NAMESPACE, upgrade)
    const auth = new DofeAuthService(
      {
        openExternal: async url => {
          if (launcher === undefined) throw new Error('dofe-managed: launcher runtime is not available for SSO')
          await launcher.openExternal(url)
        },
      },
      ctx.credentials,
      (input, init) => launcher?.requestDofeAuth
        ? launcher.requestDofeAuth(String(input), init ?? {})
        : globalThis.fetch(input, init),
      async snapshot => {
      const current = access.get()
      const entitlements = snapshot.entitlements!
      const sameUser = current.identity?.ssoSub === snapshot.user!.ssoSub
      await ctx.settings.update(DOFE_ACCESS_SETTINGS_NAMESPACE, {
        authMode: 'feishu',
        identity: {
          ...(sameUser ? current.identity : {}), ...snapshot.user,
          // Models can still contain login-time profile data during an SSO
          // outage. Keep the last synchronized profile for the same account.
          ...(sameUser && snapshot.profileSynced === false ? { name: current.identity!.name, avatar: current.identity!.avatar ?? null } : {}),
          groups: snapshot.groups ?? [], groupNames: snapshot.groupNames ?? {},
        },
        entitlements,
        enabledPlugins: normalizeDofeEnabledPluginIds(sameUser ? current.enabledPlugins : entitlements.plugins, BRAND_VARIANT, entitlements.plugins),
        supplierCapabilityInitialized: sameUser ? current.supplierCapabilityInitialized ?? false : false,
        ...supplierCapabilityUpgrade({
          enabledPlugins: sameUser ? current.enabledPlugins : entitlements.plugins,
          entitlements,
          supplierCapabilityInitialized: sameUser && current.supplierCapabilityInitialized === true,
        }, BRAND_VARIANT),
        // A successful tenant-bound renewal validates an existing setup across
        // desktop upgrades; profile refresh must never complete an unfinished setup.
        validationVersion: sameUser && current.setupComplete ? DOFE_ACCESS_VALIDATION_VERSION : current.validationVersion,
        setupComplete: sameUser && current.setupComplete
          && Boolean(current.modelId) && entitlements.allowedProtocols.includes(current.protocol ?? 'chat-completions'),
      })
    }, ctx.logger)
    const restore = async () => {
      const snapshot = await auth.restore()
      // Only a definitively dead session closes the gate. A transient network
      // or provisioning failure keeps the last good state so the MCP clients
      // stay up, and the next cycle retries the refresh.
      if (snapshot.status === 'error' && snapshot.code !== 'invalid_grant') return
      if (snapshot.status !== 'bound') {
        await ctx.settings.update(DOFE_ACCESS_SETTINGS_NAMESPACE, { setupComplete: false })
      }
    }
    ctx.effect(() => {
      const timer = setInterval(() => { void restore().catch(() => ctx.logger.error('Unable to refresh desktop authorization')) }, 15 * 60_000)
      timer.unref()
      return () => { clearInterval(timer); return auth.dispose() }
    }, 'dofe-managed: SSO session lifetime')
    await restore()
    // Injection of business consumers starts only after the initial credential renewal settles.
    ctx.provide('dofeAuth', auth)
  }
}
