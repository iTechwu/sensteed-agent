/** Built-in DoFe bundle: one managed key controls the CI model router and MCP tools. */
import type { Context } from '@deepseek-ai/cordis'
import { apply as applyMcpClient, name as mcpClientName, inject as mcpClientInject } from '@deepseek-ai/dsh-mcp-client'
import type { Config as McpConfig } from '@deepseek-ai/dsh-mcp-client'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-settings'
import {
  DOFE_ACCESS_VALIDATION_VERSION,
  type DofeAccessSettings,
  type DofePluginId,
  normalizeDofeEnabledPluginIds,
} from './dofe-plugins.ts'
import { BRAND_TENANT, BRAND_VARIANT } from './generated-product-identity.ts'
import { managedCapabilitiesPrompt } from './managed-capabilities.ts'
import type { DofeAuthService } from './dofe-auth-service.ts'
import { observeLauncherRuntime } from './dofe-host-auth.ts'
export type { DofeLauncherRuntime } from './dofe-host-auth.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { dofeAuth: DofeAuthService; dofeAccess: () => DofeAccessGate }
  interface Events { 'dofe/access-changed'(): void }
}

export const name = 'dofe-managed'
export const inject = ['credentials', 'tools', 'systemPrompt', 'settings', 'dofeAccessSettings', ...(BRAND_VARIANT === 'sensteed' ? ['dofeAuth'] : [])]

export const MODELS_API_KEY = 'MODELS_API_KEY'
const MODELS_API_KEY_REF = credentialRef(MODELS_API_KEY)
const McpClient = { name: mcpClientName, inject: mcpClientInject, apply: applyMcpClient }
export const DOFE_MCP_BASE_URL = 'https://ai.hozonauto.com/mcp'

export interface DofeAccessGate {
  readonly ready: boolean
  readonly financeAllowed?: boolean
  readonly entitlements?: DofeAccessSettings['entitlements']
  readonly enabledPlugins?: readonly DofePluginId[]
}
type ManagedMcpRoute = {
  plugin: 'knowledge' | 'openmontage' | 'media'
  serverName: string
  path: string
  timeoutMs: number
}

const ROUTES: readonly ManagedMcpRoute[] = [
  { plugin: 'knowledge', serverName: 'knowledge', path: 'knowledge', timeoutMs: 60_000 },
  { plugin: 'openmontage', serverName: 'openmontage', path: 'montage', timeoutMs: 600_000 },
  // Models 媒体直连生成：create 是普通 API 调用（60s），轮询由 Agent 显式调用
  // get_generation_task，不持有长连接等待生成完成。
  { plugin: 'media', serverName: 'media', path: 'media', timeoutMs: 60_000 },
]

/**
 * Resolve the managed credential for each generation and rebuild MCP clients.
 * The MCP package accepts static headers, so rebuilding on the credential event
 * is the narrowest way to keep its transport aligned with the credential seam.
 */
export async function apply(ctx: Context): Promise<void> {
  const access = ctx.dofeAccessSettings
  // A starting Host owner already reserves this service. Availability remains
  // strict for consumers; this lookup only avoids registering a second owner.
  if(!ctx.get?.('dofeAccess', false))ctx.provide('dofeAccess', () => {
    const current = access.get()
    const granted = current.entitlements?.plugins.includes('knowledge') === true
    return {
      ready: current.setupComplete && current.validationVersion === DOFE_ACCESS_VALIDATION_VERSION && current.authMode === 'feishu' && Boolean(current.identity?.ssoSub),
      financeAllowed: false,
      enabledPlugins: normalizeDofeEnabledPluginIds(current.enabledPlugins, BRAND_VARIANT, current.entitlements?.plugins),
      entitlements: current.entitlements === undefined ? undefined : {
        ...current.entitlements,
        knowledge: granted ? { plugin: 'knowledge', permissionVersion: 1, accesses: ['read', 'write'] } : undefined,
      },
    }
  })
  ctx.systemPrompt.section({
    name: 'dofe:managed-access',
    order: 4,
    text: context => {
      const gate = ctx.get?.('dofeAccess')?.()
      return managedCapabilitiesPrompt({
        ready: gate?.ready ?? accessReady(access.get()),
        enabled: enabledPlugins(access.get()),
        financeAllowed: gate?.financeAllowed === true,
        toolNames: ctx.tools.schemas(context.scope).map(tool => tool.name),
      })
    },
  })
  // Business plugins declare finance, supplier and tools routes through hubMcp.
  // Only the remaining built-in routes are owned here.
  let routeClients: { dispose(): void | Promise<void> }[] = []
  let routeSignature: string | undefined
  let disposed = false
  let revision = 0
  let activeKey: string | undefined
  let tray: { refresh(): void; dispose(): void } | undefined
  let reload: Promise<void> = Promise.resolve()
  observeLauncherRuntime(ctx, runtime => {
    tray = runtime.registerTrayItem({
      group: 'tools',
      order: 5,
      label: () => 'OpenMontage',
      enabled: () => activeKey !== undefined,
      invoke: async () => {
        if (activeKey !== undefined) await runtime.openOpenMontage(activeKey)
      },
    })
  })

  const enabledPlugins = (accessSettings: DofeAccessSettings): Set<DofePluginId> => {
    return new Set(normalizeDofeEnabledPluginIds(accessSettings.enabledPlugins, BRAND_VARIANT, accessSettings.entitlements?.plugins))
  }

  const accessReady = (accessSettings: DofeAccessSettings): boolean => accessSettings.setupComplete
    && accessSettings.validationVersion === DOFE_ACCESS_VALIDATION_VERSION
    && accessSettings.authMode === 'feishu'
    && Boolean(accessSettings.identity?.ssoSub)

  // The shared workflow plugin also runs in non-product hosts; this product
  // owns whether its guidance is visible to the current user and agent scope.
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    const current = access.get()
    if (!accessReady(current) || !enabledPlugins(current).has('openmontage')
      || !ctx.tools.schemas(context.scope).some(tool => tool.name.startsWith('mcp__openmontage__'))) {
      assembly.sections = assembly.sections.filter(section => section.name !== 'openmontage:guidance')
    }
    return assembly
  })

  const reconcileRoutes = async (): Promise<void> => {
    const epoch = revision
    const resolved = await ctx.credentials.resolve(MODELS_API_KEY_REF)
    if (disposed || epoch !== revision) return
    const next = resolved?.value
    const accessSettings = access.get()
    const enabled = enabledPlugins(accessSettings)
    const ready = Boolean(next) && accessReady(accessSettings)
    const nextSignature = ready
      ? JSON.stringify({
          key: next,
          identity: accessSettings.identity?.ssoSub,
          enabled: ROUTES.filter(route => enabled.has(route.plugin)).map(route => route.plugin),
        })
      : `inactive:${accessSettings.authMode}:${accessSettings.identity?.ssoSub ?? ''}`

    activeKey = ready && enabled.has('openmontage') ? next : undefined
    tray?.refresh()
    if (routeSignature === nextSignature) return

    const old = routeClients
    routeClients = []
    routeSignature = undefined
    await Promise.all(old.map(client => client.dispose()))
    if (disposed || epoch !== revision) return
    if (!ready || !next) {
      routeSignature = nextSignature
      tray?.refresh()
      return
    }

    const created: { dispose(): void | Promise<void> }[] = []
    try {
      for (const route of ROUTES) {
        if (!enabled.has(route.plugin)) continue
        const config: McpConfig = {
          transport: 'streamable-http',
          serverName: route.serverName,
          url: `${DOFE_MCP_BASE_URL}/${route.path}`,
          headers: { Authorization: `Bearer ${next}`, 'X-Company-Code': BRAND_TENANT },
          toolCallTimeoutMs: route.timeoutMs,
          failOnStartupError: false,
          reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
        }
        created.push(await ctx.plugin(McpClient, config))
        if (disposed || epoch !== revision) {
          await Promise.all(created.map(client => client.dispose()))
          return
        }
      }
      routeClients = created
      routeSignature = nextSignature
    } catch (error) {
      await Promise.all(created.map(client => client.dispose()))
      ctx.logger.error('dofe-managed: failed to activate one or more MCP clients')
      // Do not serialize the transport error: some HTTP clients include
      // request metadata, and the Authorization header must never reach logs.
      void error
    }
  }

  const scheduleAll = (): void => {
    if (disposed) return
    revision++
    reload = reload.then(reconcileRoutes, reconcileRoutes)
  }

  scheduleAll()
  ctx.on('credentials/reference-updated', ref => {
    if (ref === MODELS_API_KEY) scheduleAll()
  })
  ctx.effect(() => access.watch(scheduleAll), 'dofe-managed: access settings lifetime')
  ctx.effect(() => async () => {
    disposed = true
    revision++
    activeKey = undefined
    tray?.dispose()
    tray = undefined
    await reload
    const currentRoutes = routeClients
    routeClients = []
    await Promise.all(currentRoutes.map(client => client.dispose()))
  }, 'dofe-managed: dispose MCP clients')
  await reload
}
