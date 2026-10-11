import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import {
  registerMarketRoutes,
  registerMarketSettings,
  type MarketDesktopPlugins,
} from './host/routes.js'
import { createRestrictedHttpClient } from './network/restricted-http.js'
import {
  createMarketPackageVerifier,
  MarketInstallService,
  type MarketDesktopPnpm,
  type MarketDesktopProfile,
} from './install/service.js'

export const name = 'community-market'
export const inject = ['webServer', 'settings']
const sharedCapabilitiesKey = Symbol.for('dsh.desktop.next.capabilities')

function optionalService<T>(ctx: Context, name: string): T | undefined {
  try {
    const global = globalThis as unknown as Record<symbol, unknown>
    const globalShared = global[sharedCapabilitiesKey] as Record<string, unknown> | undefined
    if (globalShared?.[name] !== undefined) return globalShared[name] as T
    const contextual = ctx.root.get(name) as T | undefined
    if (contextual !== undefined) return contextual
    const loader = (ctx as Context & { loader?: { entries(): Iterable<{ fiber?: { ctx: Context } }> } }).loader
    for (const entry of loader?.entries() ?? []) {
      const value = entry.fiber?.ctx.get(name) as T | undefined
      if (value !== undefined) return value
    }
  } catch { /* A provider may be unloading while the route is read. */ }
  return undefined
}

interface DesktopProfilesCapability {
  readonly current: MarketDesktopProfile
}

interface DesktopActionsCapability {
  openTerminal?(): void
  requestRestart(): Promise<void>
}

const npmRegistryHttp = createRestrictedHttpClient({
  // This is a compiled-in official registry hostname, never provider input.
  syntheticProxyHostnames: ['registry.npmjs.org'],
})

export function apply(ctx: Context): void {
  const scope = registerMarketSettings(ctx)
  let installService: MarketInstallService | undefined
  let installPnpm: MarketDesktopPnpm | undefined
  let desktopActions: DesktopActionsCapability | undefined
  let desktopPlugins: MarketDesktopPlugins | undefined
  const createInstallService = (profiles: DesktopProfilesCapability, pnpm: MarketDesktopPnpm): MarketInstallService => {
    const service = new MarketInstallService(() => profiles.current, pnpm, createMarketPackageVerifier(npmRegistryHttp), {
      logFailure: message => ctx.logger.error(message),
    })
    installService = service
    installPnpm = pnpm
    return service
  }
  const installProvider = { get: () => {
    if (installService !== undefined) return installService
    const profiles = optionalService<DesktopProfilesCapability>(ctx, 'desktopProfiles')
    const pnpm = optionalService<MarketDesktopPnpm>(ctx, 'desktopPnpm')
    // The injection callback is authoritative in isolated test hosts and in
    // child Cordis scopes. Keep its live service usable when the shared lookup
    // cannot see those values, while cleanup still clears it on disposal.
    if (profiles === undefined || pnpm === undefined) return undefined
    return createInstallService(profiles, pnpm)
  } }
  // The capability fiber can be published after this plugin's optional
  // injection callback starts. Read the live service as a fallback so the
  // first state request does not report desktop actions as unavailable.
  const desktopActionsProvider = { get: () => desktopActions ?? optionalService<DesktopActionsCapability>(ctx, 'desktopActions') }
  const desktopPluginsProvider = { get: () => desktopPlugins ?? optionalService<MarketDesktopPlugins>(ctx, 'desktopPlugins') }
  ctx.effect(
    () => registerMarketRoutes(ctx, scope, installProvider, desktopActionsProvider, desktopPluginsProvider),
    'community-market: routes',
  )
  ctx.inject(['desktopActions'], (desktopCtx) => {
    const actions = desktopCtx.get('desktopActions') as DesktopActionsCapability
    desktopCtx.effect(() => {
      desktopActions = actions
      return () => {
        if (desktopActions === actions) desktopActions = undefined
      }
    }, 'community-market: optional desktop actions')
  })
  ctx.inject(['desktopPlugins'], (desktopCtx) => {
    const plugins = desktopCtx.get('desktopPlugins') as MarketDesktopPlugins
    desktopCtx.effect(() => {
      desktopPlugins = plugins
      return () => {
        if (desktopPlugins === plugins) desktopPlugins = undefined
      }
    }, 'community-market: optional desktop plugin management')
  })
  // Browsing remains portable. Desktop-only package operations appear whenever
  // the narrow profile and package-manager capabilities are live.
  ctx.inject(['desktopProfiles', 'desktopPnpm'], (desktopCtx) => {
    const profiles = desktopCtx.get('desktopProfiles') as DesktopProfilesCapability
    const pnpm = desktopCtx.get('desktopPnpm') as MarketDesktopPnpm
    desktopCtx.effect(() => {
      if (installService !== undefined && installPnpm !== pnpm) {
        void installService.dispose()
        installService = undefined
        installPnpm = undefined
      }
      const service = installService ?? createInstallService(profiles, pnpm)
      return () => {
        if (installService === service) installService = undefined
        if (installPnpm === pnpm) installPnpm = undefined
        service.dispose()
      }
    }, 'community-market: desktop package operations')
  })
}

export { marketRoutes } from './host/routes.js'
export { BUILT_IN_PROVIDERS, DefaultCatalogService } from './catalog/service.js'
export { dsh1024StoreAdapter } from './adapters/dsh-1024store.js'
export { dshfindAdapter } from './adapters/dshfind.js'
export type * from './api-types.js'
export * from './contracts/index.js'
