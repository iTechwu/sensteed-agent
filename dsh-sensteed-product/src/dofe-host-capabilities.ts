/** Business artifacts declare routes; only this Host owns transports and credentials. */
import type { Context } from '@deepseek-ai/cordis'
import { apply as applyMcpClient, name as mcpClientName, inject as mcpClientInject, type Config as McpConfig } from '@deepseek-ai/dsh-mcp-client'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { DEFAULT_DOFE_PLUGIN_IDS, DOFE_ACCESS_VALIDATION_VERSION, normalizeDofeEnabledPluginIds, type DofePluginId } from './dofe-plugins.ts'
import { BRAND_TENANT, BRAND_VARIANT } from './generated-product-identity.ts'
import { observeLauncherRuntime, type DofeLauncherRuntime } from './dofe-host-auth.ts'
import type { DofeAccessGate } from './dofe-managed.ts'
import { financeMcpConfig } from './finance-mcp.ts'

export const name = 'dofe-host-capabilities'
export const inject = ['credentials', 'dofeAccessSettings', ...(BRAND_VARIANT === 'sensteed' ? ['dofeAuth'] : [])]
export interface HubMcpDeclaration { readonly capability: DofePluginId; readonly serverName: string; readonly path: string; readonly timeoutMs: number }
export interface HubMcpRegistration { dispose(): Promise<void> }
export interface HubMcpService { register(input: HubMcpDeclaration): HubMcpRegistration }
declare module '@deepseek-ai/cordis' { interface Context { hubMcp: HubMcpService } }

const McpClient = { name: mcpClientName, inject: mcpClientInject, apply: applyMcpClient }
const keyRef = credentialRef('MODELS_API_KEY')
const interrupted = Symbol('interrupted')

function declaration(input: HubMcpDeclaration): Readonly<HubMcpDeclaration> {
  if (!input || typeof input !== 'object'
    || Object.keys(input).sort().join(',') !== 'capability,path,serverName,timeoutMs'
    || !DEFAULT_DOFE_PLUGIN_IDS.includes(input.capability)
    || !/^[-a-z0-9]{1,32}$/u.test(input.serverName)
    || !/^[a-z][a-z0-9-]{0,79}(?:\/[a-z][a-z0-9-]{0,79}){0,3}$/u.test(input.path)
    || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1000 || input.timeoutMs > 600000
    || input.capability === 'finance' && (input.path !== 'finance' || input.serverName !== 'finance')
    || input.capability !== 'finance' && (input.path === 'finance' || input.serverName === 'finance')) {
    throw new Error('HUB_MCP_INVALID_DECLARATION')
  }
  return Object.freeze({ ...input })
}

/** Release the reconciliation queue even if an external provider ignores cancellation. */
async function interruptible<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T | typeof interrupted> {
  let interrupt!: () => void
  const cancelled = new Promise<typeof interrupted>(resolve => { interrupt = () => resolve(interrupted) })
  signal.addEventListener('abort', interrupt, { once: true })
  if (signal.aborted) interrupt()
  try { return await Promise.race([work, cancelled]) }
  finally { signal.removeEventListener('abort', interrupt) }
}

export async function apply(ctx: Context): Promise<void> {
  let launcher: DofeLauncherRuntime | undefined
  observeLauncherRuntime(ctx, value => { launcher = value })
  const access = ctx.dofeAccessSettings
  const auth = BRAND_VARIANT === 'sensteed' ? ctx.dofeAuth : undefined
  type Session = ReturnType<NonNullable<typeof auth>['getDatasourceSession']>
  type Entry = {
    route: Readonly<HubMcpDeclaration>
    client?: { dispose(): void | Promise<void> }
    signature?: string
    stopping?: Promise<boolean>
    removed: boolean
  }
  const entries = new Map<string, Entry>()
  let disposed = false, revision = 0, financeAllowed = false, queued = false, running = false
  let modelsKey: string | undefined, active: AbortController | undefined, tail = Promise.resolve()

  const ready = () => {
    const value = access.get()
    return value.setupComplete && value.validationVersion === DOFE_ACCESS_VALIDATION_VERSION
      && value.authMode === 'feishu' && Boolean(value.identity?.ssoSub)
      && (!auth || auth.getDatasourceSession()?.operator === value.identity?.ssoSub)
  }
  const enabled = () => {
    const value = access.get()
    return new Set(normalizeDofeEnabledPluginIds(value.enabledPlugins, BRAND_VARIANT, value.entitlements?.plugins))
  }
  ctx.provide('dofeAccess', (): DofeAccessGate => {
    const value = access.get(), granted = value.entitlements?.plugins.includes('knowledge') === true
    const entitlements = value.entitlements === undefined ? undefined : {
      ...value.entitlements,
      knowledge: granted ? { plugin: 'knowledge' as const, permissionVersion: 1 as const, accesses: ['read', 'write'] as ('read' | 'write')[] } : undefined,
    }
    return { ready: ready(), financeAllowed, enabledPlugins: [...enabled()], entitlements }
  })
  function financeAccess(allowed: boolean) {
    if (financeAllowed === allowed) return
    financeAllowed = allowed
    ctx.emit?.('dofe/access-changed')
  }
  function signature(entry: Entry, key: string | undefined, session: Session): string | undefined {
    if (!key || !ready() || entry.removed || !enabled().has(entry.route.capability)) return undefined
    // Models-backed routes do not send the SSO bearer. Refreshing it must only rotate finance.
    return JSON.stringify([key, session?.operator, session?.tenantId, entry.route.capability === 'finance' ? session?.accessToken : undefined, entry.route])
  }
  function stop(entry: Entry): Promise<boolean> {
    if (entry.stopping) return entry.stopping
    const old = entry.client
    delete entry.client
    delete entry.signature
    if (!old) return Promise.resolve(true)
    let finish!: (stopped: boolean) => void
    const stopping = new Promise<boolean>(resolve => { finish = resolve })
    entry.stopping = stopping
    const stopped = () => {
      if (entry.stopping === stopping) delete entry.stopping
      finish(true)
    }
    const failed = () => {
      // A failed disposer may still own its namespace; never start a replacement over it.
      ctx.logger.error(`Hub MCP transport "${entry.route.serverName}" could not stop`)
      finish(false)
    }
    try { void Promise.resolve(old.dispose()).then(stopped, failed) }
    catch { failed() }
    return stopping
  }
  function invalidateLocal() {
    const session = auth?.getDatasourceSession()
    for (const entry of entries.values()) {
      const expected = signature(entry, modelsKey, session)
      if (expected === undefined || entry.signature !== undefined && entry.signature !== expected) {
        void stop(entry)
        if (entry.route.capability === 'finance') financeAccess(false)
      }
    }
    if (!modelsKey || !ready() || !enabled().has('finance')) financeAccess(false)
  }
  async function sync(entry: Entry, allowed: boolean, key: string | undefined, session: Session, signal: AbortSignal) {
    const desired = allowed ? signature(entry, key, session) : undefined
    if (entry.signature === desired && !entry.stopping) return
    if (await interruptible(stop(entry), signal) !== true || signal.aborted || disposed || entry.removed || !desired || !key) return
    const config: McpConfig = entry.route.capability === 'finance' ? financeMcpConfig(key, session!.accessToken) : {
      transport: 'streamable-http', serverName: entry.route.serverName,
      url: `https://ai.hozonauto.com/mcp/${entry.route.path}`,
      headers: { Authorization: `Bearer ${key}`, 'X-Company-Code': BRAND_TENANT },
      toolCallTimeoutMs: entry.route.timeoutMs, failOnStartupError: false,
      reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 },
    }
    try {
      // Cordis returns a disposable thenable immediately, before transport startup settles.
      // Retain that handle so logout/unload can cancel an unfinished connection.
      const client = ctx.plugin(McpClient, config)
      entry.client = client
      entry.signature = desired
      void Promise.resolve(client).catch(() => {
        if (entry.client !== client) return
        ctx.logger.error(`Hub MCP transport "${entry.route.serverName}" could not activate`)
        void stop(entry)
      })
    } catch {
      ctx.logger.error(`Hub MCP transport "${entry.route.serverName}" could not activate`)
    }
  }
  async function reconcile(epoch: number, signal: AbortSignal) {
    let resolved
    try { resolved = await interruptible(ctx.credentials.resolve(keyRef), signal) }
    catch {
      if (!signal.aborted) {
        modelsKey = undefined
        invalidateLocal()
        ctx.logger.error('Hub MCP credentials could not resolve')
      }
      return
    }
    if (resolved === interrupted || epoch !== revision || disposed) return
    modelsKey = resolved?.value
    invalidateLocal()
    const key = modelsKey, session = auth?.getDatasourceSession(), baseReady = ready() && Boolean(key)
    const routes = [...entries.values()].filter(entry => !entry.removed)
    // Slow finance permission renewal must not delay unrelated MCP registration/revocation.
    for (const entry of routes.filter(entry => entry.route.capability !== 'finance')) {
      await sync(entry, baseReady, key, session, signal)
      if (signal.aborted || disposed) return
    }
    const financeEntry = routes.find(entry => entry.route.capability === 'finance')
    if (!financeEntry || !baseReady || !session || !enabled().has('finance')) {
      financeAccess(false)
      if (financeEntry) await sync(financeEntry, false, key, session, signal)
      return
    }
    // Rotate/revoke stale credentials before making the permission REST request.
    if (financeEntry.signature !== signature(financeEntry, key, session)) {
      financeAccess(false)
      if (await interruptible(stop(financeEntry), signal) !== true) return
    }
    if (signal.aborted || disposed) return
    let finance = false
    const permissionSignal = AbortSignal.any([signal, AbortSignal.timeout(30000)])
    try {
      const request = launcher?.requestDofeAuth?.bind(launcher) ?? globalThis.fetch
      const result = await interruptible((async () => {
        const response = await request('https://ds.hozonauto.com/api/finance/permissions/workspace-access', {
          method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${session.accessToken}`, 'X-Company-Code': BRAND_TENANT },
          redirect: 'error', signal: permissionSignal,
        })
        const value = await response.json() as { data?: { allowed?: boolean } }
        return response.ok && value?.data?.allowed === true
      })(), permissionSignal)
      finance = result === true
    } catch { /* Fail closed without logging an external response or bearer. */ }
    if (signal.aborted || epoch !== revision || disposed) return
    financeAccess(finance)
    await sync(financeEntry, finance, key, session, signal)
  }
  function schedule(reason: 'change' | 'poll' = 'change') {
    if (disposed) return
    revision++
    queued = true
    active?.abort()
    invalidateLocal()
    if (reason !== 'poll') ctx.emit?.('dofe/access-changed')
    if (running) return
    running = true
    tail = Promise.resolve().then(async () => {
      try {
        while (queued && !disposed) {
          queued = false
          const epoch = revision, controller = new AbortController()
          active = controller
          try { await reconcile(epoch, controller.signal) }
          catch { ctx.logger.error('Hub MCP reconciliation could not complete') }
          finally { if (active === controller) active = undefined }
        }
      } finally { running = false }
    })
  }
  ctx.provide('hubMcp', {
    register(input) {
      if (disposed) throw new Error('HUB_MCP_DISPOSED')
      const route = declaration(input)
      if (entries.has(route.serverName)) throw new Error('HUB_MCP_DUPLICATE_SERVER')
      const entry: Entry = { route, removed: false }
      entries.set(route.serverName, entry)
      schedule()
      let removal: Promise<void> | undefined
      return { dispose() {
        if (removal) return removal
        entry.removed = true
        schedule()
        return removal = stop(entry).then(stopped => {
          if (!stopped) throw new Error('HUB_MCP_DISPOSE_FAILED')
          if (entries.get(route.serverName) === entry) entries.delete(route.serverName)
        })
      } }
    },
  } satisfies HubMcpService)
  ctx.on('credentials/reference-updated', ref => { if (ref === 'MODELS_API_KEY') schedule() })
  ctx.effect(() => access.watch(() => schedule()), 'Hub MCP settings lifetime')
  if (auth) {
    let watching = false
    ctx.effect(() => auth.watchBinding(() => { if (watching) schedule() }), 'Hub MCP SSO lifetime')
    watching = true
  }
  ctx.effect(() => {
    const timer = setInterval(() => schedule('poll'), 60000)
    timer.unref()
    return () => clearInterval(timer)
  }, 'Hub MCP permission renewal')
  ctx.effect(() => async () => {
    disposed = true
    revision++
    queued = false
    active?.abort()
    financeAccess(false)
    await Promise.all([...entries.values()].map(stop))
    await tail
    entries.clear()
  }, 'Hub MCP transport lifetime')
  schedule()
  await tail
}
