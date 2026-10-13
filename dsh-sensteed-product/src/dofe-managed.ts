/** Built-in DoFe bundle: one managed key controls the CI model router and MCP tools. */
import type { Context } from '@deepseek-ai/cordis'
import { apply as applyMcpClient, name as mcpClientName, inject as mcpClientInject } from '@deepseek-ai/dsh-mcp-client'
import type { Config as McpConfig } from '@deepseek-ai/dsh-mcp-client'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_DOFE_PLUGIN_IDS,
  DOFE_ACCESS_SETTINGS_NAMESPACE,
  DOFE_ACCESS_VALIDATION_VERSION,
  type DofeAccessSettings,
  type DofePluginId,
  normalizeDofePluginIds,
} from './dofe-plugins.ts'
import { BRAND_TENANT, BRAND_VARIANT } from './generated-product-identity.ts'
import { managedCapabilitiesPrompt } from './managed-capabilities.ts'
import { DofeAuthService } from './dofe-auth-service.ts'
import { financeMcpConfig } from './finance-mcp.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { dofeAuth: DofeAuthService; dofeAccess: () => DofeAccessGate }
  interface Events { 'dofe/access-changed'(): void }
}

export const name = 'dofe-managed'
export const inject = ['credentials', 'tools', 'systemPrompt', 'settings']

/**
 * Launcher capabilities this row degrades without: the OpenMontage tray item
 * and the SSO browser open. Declared as the narrow shape the row actually
 * uses (the `tests/dofe-managed-runtime.spec.ts` mock), observed through the
 * Cordis `internal/service` event so an official shell without a launcher
 * runtime simply leaves tray and SSO open degraded instead of pending.
 */
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
function observeLauncherRuntime(ctx: Context, onReady: (runtime: DofeLauncherRuntime) => void): void {
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
const DATASOURCE_FINANCE_WORKSPACE_ACCESS_URL = 'https://ds.hozonauto.com/api/finance/permissions/workspace-access'

type ManagedMcpRoute = {
  /** Omitted for required platform capabilities that were already always-on. */
  plugin?: Exclude<DofePluginId, 'opencli'>
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
  ...[
    'platform', 'supply-chain', 'talent-discovery', 'lead-discovery', 'lead-monitor',
    'hotspot-discovery', 'custom-car-monitoring', 'viral-video', 'browser-intelligence', 'tos-upload', 'xhs-operation',
    'douyin-operation',
  ].map(path => ({ plugin: 'tools' as const, serverName: `tools-${path}`, path: `tools/${path}`, timeoutMs: 60_000 })),
]

/**
 * Resolve the managed credential for each generation and rebuild MCP clients.
 * The MCP package accepts static headers, so rebuilding on the credential event
 * is the narrowest way to keep its transport aligned with the credential seam.
 */
export async function apply(ctx: Context): Promise<void> {
  // Restore may issue requests before the tray/MCP setup below. Observe the
  // launcher first so both silent renewal and interactive login use its transport.
  let launcher: DofeLauncherRuntime | undefined
  observeLauncherRuntime(ctx, runtime => { launcher = runtime })
  const access = ctx.settings.register<DofeAccessSettings>(
    DOFE_ACCESS_SETTINGS_NAMESPACE,
    z.object({
      setupComplete: z.boolean().default(false),
      validationVersion: z.number().step(1).min(0).default(0),
      enabledPlugins: z.array(z.string()).default(DEFAULT_DOFE_PLUGIN_IDS),
      modelId: z.string().default(''),
      protocol: z.union(['chat-completions', 'messages', 'responses']).default('chat-completions'),
      authMode: z.union(['feishu', 'manual']).default('feishu'),
      identity: z.any().default(undefined),
      entitlements: z.object({ plugins: z.array(z.string()), defaultModel: z.string(), allowedProtocols: z.array(z.string()) }).default({ plugins: [], defaultModel: '', allowedProtocols: [] }),
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
  let financeAuthorized = false
  ctx.provide('dofeAccess', () => {
    const current = access.get()
    const granted = current.entitlements?.plugins.includes('knowledge') === true
    return {
      ready: current.setupComplete && current.validationVersion === DOFE_ACCESS_VALIDATION_VERSION && current.authMode === 'feishu' && Boolean(current.identity?.ssoSub),
      financeAllowed: financeAuthorized,
      enabledPlugins: normalizeDofePluginIds(current.enabledPlugins, BRAND_VARIANT)
        .filter(plugin => current.entitlements?.plugins.includes(plugin)),
      entitlements: current.entitlements === undefined ? undefined : {
        ...current.entitlements,
        knowledge: granted ? { plugin: 'knowledge', permissionVersion: 1, accesses: ['read', 'write'] } : undefined,
      },
    }
  })
  let financeAuth: DofeAuthService | undefined
  if (BRAND_VARIANT === 'sensteed') {
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
        enabledPlugins: normalizeDofePluginIds(sameUser ? current.enabledPlugins : entitlements.plugins, BRAND_VARIANT)
          .filter(plugin => entitlements.plugins.includes(plugin)),
        // A successful tenant-bound renewal validates an existing setup across
        // desktop upgrades; profile refresh must never complete an unfinished setup.
        validationVersion: sameUser && current.setupComplete ? DOFE_ACCESS_VALIDATION_VERSION : current.validationVersion,
        setupComplete: sameUser && current.setupComplete
          && Boolean(current.modelId) && entitlements.allowedProtocols.includes(current.protocol ?? 'chat-completions'),
      })
    }, ctx.logger)
    financeAuth = auth
    ctx.provide('dofeAuth', auth)
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
  }
  ctx.systemPrompt.section({
    name: 'dofe:managed-access',
    order: 4,
    text: context => managedCapabilitiesPrompt({
      ready: accessReady(access.get()),
      enabled: enabledPlugins(access.get()),
      financeAllowed: financeAuthorized,
      toolNames: ctx.tools.schemas(context.scope).map(tool => tool.name),
    }),
  })
  let routeClients: { dispose(): void | Promise<void> }[] = []
  let financeClient: { dispose(): void | Promise<void> } | undefined
  let routeSignature: string | undefined
  let financeSignature: string | undefined
  let financeAccessCache: { token: string; allowed: boolean; expiresAt: number } | undefined
  let activeKey: string | undefined
  let tray: { refresh(): void; dispose(): void } | undefined
  let reload: Promise<void> = Promise.resolve()
  observeLauncherRuntime(ctx, runtime => {
    launcher = runtime
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
    const enabled = new Set(normalizeDofePluginIds(accessSettings.enabledPlugins, BRAND_VARIANT))
    if (BRAND_VARIANT === 'sensteed') {
      for (const plugin of enabled) {
        if (!accessSettings.entitlements?.plugins.includes(plugin)) enabled.delete(plugin)
      }
    }
    return enabled
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
    const resolved = await ctx.credentials.resolve(MODELS_API_KEY_REF)
    const next = resolved?.value
    const accessSettings = access.get()
    const enabled = enabledPlugins(accessSettings)
    const ready = Boolean(next) && accessReady(accessSettings)
    const nextSignature = ready
      ? JSON.stringify({
          key: next,
          identity: accessSettings.identity?.ssoSub,
          enabled: [...enabled].sort(),
        })
      : `inactive:${accessSettings.authMode}:${accessSettings.identity?.ssoSub ?? ''}`

    activeKey = ready && enabled.has('openmontage') ? next : undefined
    tray?.refresh()
    if (routeSignature === nextSignature) return

    const old = routeClients
    routeClients = []
    routeSignature = undefined
    await Promise.all(old.map(client => client.dispose()))
    if (!ready || !next) {
      routeSignature = nextSignature
      tray?.refresh()
      return
    }

    const created: { dispose(): void | Promise<void> }[] = []
    try {
      for (const route of ROUTES) {
        if (route.plugin !== undefined && !enabled.has(route.plugin)) continue
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

  const reconcileFinance = async (): Promise<void> => {
    financeAuthorized = false
    const resolved = await ctx.credentials.resolve(MODELS_API_KEY_REF)
    const next = resolved?.value
    const accessSettings = access.get()
    const session = financeAuth?.getDatasourceSession()
    const baseReady = BRAND_VARIANT === 'sensteed' && Boolean(next) && accessReady(accessSettings) && session !== undefined
    let financeAllowed = false
    if (baseReady && session !== undefined) {
      if (financeAccessCache?.token === session.accessToken && financeAccessCache.expiresAt > Date.now()) {
        financeAllowed = financeAccessCache.allowed
      } else {
        try {
          const response = await globalThis.fetch(DATASOURCE_FINANCE_WORKSPACE_ACCESS_URL, {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${session.accessToken}`,
              'X-Company-Code': BRAND_TENANT,
            },
            redirect: 'error',
            signal: AbortSignal.timeout(30_000),
          })
          const payload = await response.json().catch(() => null) as { data?: { allowed?: boolean } } | null
          financeAllowed = response.ok && payload?.data?.allowed === true
          financeAccessCache = { token: session.accessToken, allowed: financeAllowed, expiresAt: Date.now() + 5000 }
        } catch {
          financeAccessCache = { token: session.accessToken, allowed: false, expiresAt: Date.now() + 1000 }
        }
      }
    }
    const ready = baseReady && financeAllowed
    financeAuthorized = ready
    const nextSignature = ready
      ? `${next}\0${session!.accessToken}`
      : session === undefined ? undefined : `finance-denied:${accessSettings.identity?.ssoSub ?? ''}`
    if (financeSignature === nextSignature) return

    const old = financeClient
    financeClient = undefined
    financeSignature = undefined
    if (old !== undefined) await old.dispose()
    if (!ready || !next || session === undefined) return

    try {
      financeClient = await ctx.plugin(McpClient, financeMcpConfig(next, session.accessToken))
      financeSignature = nextSignature
    } catch (error) {
      ctx.logger.error('dofe-managed: failed to activate the finance MCP client')
      void error
    }
  }

  const scheduleFinance = (): void => {
    financeAuthorized = false
    ctx.emit?.('dofe/access-changed')
    const reconcile = async () => {
      await reconcileFinance()
      ctx.emit?.('dofe/access-changed')
    }
    reload = reload.then(reconcile, reconcile)
  }

  const scheduleAll = (): void => {
    financeAuthorized = false
    ctx.emit?.('dofe/access-changed')
    reload = reload.then(async () => {
      await reconcileRoutes()
      await reconcileFinance()
      ctx.emit?.('dofe/access-changed')
    }, async () => {
      await reconcileRoutes()
      await reconcileFinance()
      ctx.emit?.('dofe/access-changed')
    })
  }

  let observingFinance = false
  if (financeAuth) ctx.effect(() => financeAuth.watchBinding(() => { if (observingFinance) scheduleFinance() }), 'dofe-managed: finance SSO renewal')
  observingFinance = true
  scheduleAll()
  ctx.on('credentials/reference-updated', ref => {
    if (ref === MODELS_API_KEY) scheduleAll()
  })
  access.watch(() => scheduleAll())
  ctx.effect(() => () => {
    tray?.dispose()
    tray = undefined
    const currentRoutes = routeClients
    routeClients = []
    const currentFinance = financeClient
    financeClient = undefined
    void Promise.all([
      ...currentRoutes.map(client => client.dispose()),
      ...(currentFinance === undefined ? [] : [currentFinance.dispose()]),
    ])
  }, 'dofe-managed: dispose MCP clients')
  await reload
}
