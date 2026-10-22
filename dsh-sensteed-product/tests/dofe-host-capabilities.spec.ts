import { afterEach, expect, it, vi } from 'vitest'
import { apply, type HubMcpDeclaration, type HubMcpService } from '../src/dofe-host-capabilities.ts'
import { DOFE_ACCESS_VALIDATION_VERSION } from '../src/dofe-plugins.ts'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const allowed = (value = true) => new Response(JSON.stringify({ data: { allowed: value } }))
const tool: HubMcpDeclaration = { capability: 'tools', serverName: 'tools-test', path: 'tools/platform', timeoutMs: 60000 }
const supplier: HubMcpDeclaration = { capability: 'supplier-intelligence', serverName: 'supply-chain', path: 'tools/supply-chain', timeoutMs: 120000 }
const finance: HubMcpDeclaration = { capability: 'finance', serverName: 'finance', path: 'finance', timeoutMs: 120000 }
async function settle() { for (let i = 0; i < 60; i++) await Promise.resolve() }

function fixture() {
  let session: { operator: string; tenantId: string; accessToken: string } | undefined = { operator: 'test-user', tenantId: 'test-tenant', accessToken: 'test-sso' }
  let key: string | undefined = 'test-models', watch = () => {}, binding = () => {}, startup: Promise<void> | undefined
  const effects: (() => unknown)[] = [], active = new Set<string>()
  type Client = { config: any; dispose: ReturnType<typeof vi.fn>; stopBarrier?: Promise<void> }
  const clients: Client[] = []
  const settings = {
    setupComplete: true, validationVersion: DOFE_ACCESS_VALIDATION_VERSION, authMode: 'feishu', identity: { ssoSub: 'test-user' },
    enabledPlugins: ['tools', 'supplier-intelligence', 'finance'],
    entitlements: { plugins: ['tools', 'supplier-intelligence', 'finance'], defaultModel: 'test', allowedProtocols: [] },
  }
  const services: Record<string, unknown> = {}, events: Record<string, Function> = {}
  const request = vi.fn(async (_url: string, _init: RequestInit): Promise<Response> => allowed())
  const resolve = vi.fn(async () => key ? { value: key } : undefined)
  const ctx: any = {
    dofeAccessSettings: { get: () => settings, watch: (fn: () => void) => { watch = fn; return () => {} } },
    dofeAuth: { getDatasourceSession: () => session, watchBinding: (fn: () => void) => { binding = fn; return () => {} } },
    credentials: { resolve }, desktopRuntime: { requestDofeAuth: request },
    provide: (name: string, value: unknown) => { services[name] = value },
    plugin: vi.fn((_plugin: unknown, config: any) => {
      // Model Cordis' synchronous disposable thenable, including namespace ownership until disposal finishes.
      if (active.has(config.serverName)) throw new Error(`serverName ${config.serverName} already in use`)
      active.add(config.serverName)
      const client: Client = { config, dispose: vi.fn(async () => { await client.stopBarrier; active.delete(config.serverName) }) }
      clients.push(client)
      const ready = startup ?? Promise.resolve()
      startup = undefined
      return Object.assign(ready.then(() => client), { dispose: client.dispose })
    }),
    on: (name: string, fn: Function) => { events[name] = fn },
    effect: (fn: () => () => unknown) => { effects.push(fn()) }, emit: vi.fn(), logger: { error: vi.fn() },
  }
  let shutdown: Promise<void> | undefined
  return {
    ctx, services, clients, request, settings, resolve, active,
    watch: () => watch(), binding: () => binding(),
    setToken: (token: string) => { session = { ...session!, accessToken: token } },
    updateKey: (value: string | undefined) => { key = value; events['credentials/reference-updated']?.('MODELS_API_KEY') },
    clear: () => { key = undefined; session = undefined },
    delayStartup: (work: Promise<void>) => { startup = work },
    gate: () => (services.dofeAccess as () => { ready: boolean; financeAllowed: boolean })(),
    dispose: () => shutdown ??= (async () => { for (const dispose of effects.reverse()) await dispose() })(),
    mcp: () => services.hubMcp as HubMcpService,
  }
}
afterEach(() => { vi.useRealTimers() })

it('applies symbolic Profile endpoints through the existing credential and single-owner transport gate', async () => {
  const f = fixture()
  await apply(f.ctx)
  try {
    f.mcp().register(tool)
    await settle()
    await f.mcp().applyProfileEndpoints([{ service: 'tools', domain: 'platform', version: '1.0.0', enabled: true }])
    expect(f.clients).toHaveLength(1)
    await f.mcp().applyProfileEndpoints([])
    expect(f.active.size).toBe(0)
    await f.mcp().applyProfileEndpoints([{ service: 'tools', domain: 'platform', version: '1.0.0', enabled: true }])
    expect(f.active.size).toBe(1)
    expect(f.clients.at(-1)?.config.headers).toEqual({ Authorization: 'Bearer test-models', 'X-Company-Code': expect.any(String) })
    await expect(f.mcp().applyProfileEndpoints([{ service: 'tools', domain: 'platform', version: '2.0.0', enabled: true }])).rejects.toThrow('HUB_MCP_ENDPOINT_VERSION_UNAVAILABLE')
    expect(f.active.size).toBe(1)
  } finally { await f.dispose() }
})

it('connects MCP-only Profiles and transfers route ownership to a later plugin without duplicate clients', async () => {
  const f = fixture()
  await apply(f.ctx)
  try {
    await f.mcp().applyProfileEndpoints([{ service: 'tools', domain: 'platform', version: '1.0.0', enabled: true }])
    expect(f.clients).toHaveLength(1)
    const first = f.clients[0]!
    f.mcp().register(tool)
    await settle()
    expect(first.dispose).toHaveBeenCalledOnce()
    expect(f.active.size).toBe(1)
    expect(f.clients.at(-1)?.config.serverName).toBe(tool.serverName)
    f.clear(); f.binding(); await settle()
    expect(f.active.size).toBe(0)
    await expect(f.mcp().applyProfileEndpoints([{ service: 'tools', domain: 'platform', version: '1.0.0', enabled: true }])).rejects.toThrow('HUB_MCP_ACCESS_REQUIRED')
  } finally { await f.dispose() }
})

it('does not replace a route whose previous Profile owner failed to stop', async () => {
  const f = fixture()
  await apply(f.ctx)
  try {
    await f.mcp().applyProfileEndpoints([{ service: 'tools', domain: 'platform', version: '1.0.0', enabled: true }])
    f.clients[0]!.dispose.mockRejectedValueOnce(Error('still owns transport'))
    f.mcp().register(tool)
    await settle()
    expect(f.clients).toHaveLength(1)
    expect(f.active.size).toBe(1)
  } finally { await f.dispose() }
})

it('hands a finance Profile transport to its plugin and rejects reuse of its namespace by another endpoint', async () => {
  const f = fixture()
  await apply(f.ctx)
  try {
    await f.mcp().applyProfileEndpoints([{ service: 'datasource', domain: 'finance', version: '1.0.0', enabled: true }])
    f.mcp().register(finance)
    await settle()
    expect(f.clients).toHaveLength(2)
    expect(f.active.size).toBe(1)
    expect(f.gate().financeAllowed).toBe(true)
    await f.mcp().applyProfileEndpoints([{ service: 'tools', domain: 'platform', version: '1.0.0', enabled: true }])
    const namespace = f.clients.at(-1)!.config.serverName
    expect(() => f.mcp().register({ ...supplier, serverName: namespace })).toThrow('HUB_MCP_DUPLICATE_SERVER')
  } finally { await f.dispose() }
})

it('owns no default business transports and rejects unsafe declarations before reserving a namespace', async () => {
  const f = fixture()
  await apply(f.ctx)
  try {
    expect(f.clients).toHaveLength(0)
    for (const path of ['https://example.com', '../finance', 'tools//x', 'tools/x?token=a', '%2fprivate', 'tools\\x']) {
      expect(() => f.mcp().register({ ...tool, path })).toThrow('INVALID')
    }
    expect(() => f.mcp().register({ ...tool, headers: { Authorization: 'bad' } } as never)).toThrow('INVALID')
    expect(() => f.mcp().register({ ...tool, serverName: 'finance' })).toThrow('INVALID')
    expect(() => f.mcp().register({ ...tool, path: 'finance' })).toThrow('INVALID')
    expect(() => f.mcp().register({ ...finance, serverName: 'finance-other' })).toThrow('INVALID')
    expect(() => f.mcp().register({ ...tool, serverName: 'x'.repeat(33) })).toThrow('INVALID')
    const registration = f.mcp().register({ ...tool, serverName: 'x'.repeat(32) })
    expect(() => f.mcp().register({ ...tool, serverName: 'x'.repeat(32) })).toThrow('DUPLICATE')
    await settle()
    expect(f.clients).toHaveLength(1)
    await registration.dispose()
  } finally { await f.dispose() }
})

it('coalesces registrations and preserves supply-chain/finance clients and the access gate across minute polls', async () => {
  vi.useFakeTimers()
  const f = fixture()
  await apply(f.ctx)
  try {
    for (const route of [tool, supplier, finance]) f.mcp().register(route)
    f.watch(); f.watch(); f.binding()
    await settle()
    expect(f.clients.map(client => client.config.serverName)).toEqual(['tools-test', 'supply-chain', 'finance'])
    expect(f.request).toHaveBeenCalledOnce()
    expect(f.resolve).toHaveBeenCalledTimes(2) // Initial empty Host plus the coalesced registrations.
    const pending = deferred<Response>()
    f.request.mockReturnValueOnce(pending.promise)
    f.ctx.emit.mockClear()
    await vi.advanceTimersByTimeAsync(60000)
    expect(f.gate().financeAllowed).toBe(true)
    expect(f.ctx.emit).not.toHaveBeenCalled()
    expect(f.clients.every(client => client.dispose.mock.calls.length === 0)).toBe(true)
    pending.resolve(allowed())
    await settle()
    await vi.advanceTimersByTimeAsync(120000)
    expect(f.clients).toHaveLength(3)
    expect(f.request).toHaveBeenCalledTimes(4)
    expect(f.ctx.logger.error).not.toHaveBeenCalled()
    expect(f.active.size).toBe(3)
  } finally { await f.dispose() }
})

it('rotates only finance on SSO bearer refresh and waits for old namespace disposal before replacement', async () => {
  const f = fixture()
  await apply(f.ctx)
  try {
    for (const route of [tool, supplier, finance]) f.mcp().register(route)
    await settle()
    const oldFinance = f.clients[2]!, stopping = deferred<void>()
    oldFinance.stopBarrier = stopping.promise
    f.setToken('renewed-sso'); f.binding()
    expect(oldFinance.dispose).toHaveBeenCalledOnce()
    expect(f.clients[0]!.dispose).not.toHaveBeenCalled()
    expect(f.clients[1]!.dispose).not.toHaveBeenCalled()
    expect(f.gate().financeAllowed).toBe(false)
    await settle()
    expect(f.clients).toHaveLength(3)
    stopping.resolve()
    await settle()
    expect(f.clients).toHaveLength(4)
    expect(f.clients[3]!.config).toMatchObject({
      url: 'https://ai.hozonauto.com/mcp/finance',
      headers: { Authorization: 'Bearer test-models', 'X-Sensteed-SSO-Authorization': 'Bearer renewed-sso' },
    })
    expect(f.gate().financeAllowed).toBe(true)
    expect(f.ctx.logger.error).not.toHaveBeenCalled()
    f.updateKey('test-models')
    await settle()
    expect(f.clients).toHaveLength(4)
    expect(f.clients[3]!.dispose).not.toHaveBeenCalled()
    f.updateKey('renewed-models')
    await settle()
    expect(f.clients.slice(0, 2).every(client => client.dispose.mock.calls.length === 1)).toBe(true)
    expect(f.clients[3]!.dispose).toHaveBeenCalledOnce()
    expect(f.clients).toHaveLength(7)
    expect(f.clients.slice(4).every(client => client.config.headers.Authorization === 'Bearer renewed-models')).toBe(true)
    expect(f.active.size).toBe(3)
  } finally { await f.dispose() }
})

it('rechecks finance permission without reconnecting allowed clients and selectively closes denied or failed renewals', async () => {
  vi.useFakeTimers()
  const f = fixture()
  await apply(f.ctx)
  try {
    f.request.mockResolvedValueOnce(allowed(false))
    for (const route of [supplier, finance]) f.mcp().register(route)
    await settle()
    expect(f.clients).toHaveLength(1)
    expect(f.gate().financeAllowed).toBe(false)
    await vi.advanceTimersByTimeAsync(60000)
    expect(f.clients).toHaveLength(2)
    expect(f.gate().financeAllowed).toBe(true)
    expect(f.request.mock.calls[0]?.[0]).toBe('https://ds.hozonauto.com/api/finance/permissions/workspace-access')
    f.request.mockResolvedValueOnce(allowed(false))
    await vi.advanceTimersByTimeAsync(60000)
    expect(f.clients[1]!.dispose).toHaveBeenCalledOnce()
    expect(f.clients[0]!.dispose).not.toHaveBeenCalled()
    expect(f.gate().financeAllowed).toBe(false)
    await vi.advanceTimersByTimeAsync(60000)
    expect(f.clients).toHaveLength(3)
    f.request.mockRejectedValueOnce(new Error('external failure with test-sso'))
    await vi.advanceTimersByTimeAsync(60000)
    expect(f.clients[2]!.dispose).toHaveBeenCalledOnce()
    expect(f.gate().financeAllowed).toBe(false)
    expect(f.ctx.logger.error).not.toHaveBeenCalled()
  } finally { await f.dispose() }
})

it('does not let a slow finance request block other routes or local revocation, and ignores its stale success', async () => {
  const f = fixture(), pending = deferred<Response>()
  await apply(f.ctx)
  try {
    f.request.mockReturnValueOnce(pending.promise)
    f.mcp().register(finance)
    await settle()
    expect(f.request).toHaveBeenCalledOnce()
    const oldSignal = f.request.mock.calls[0]?.[1].signal
    f.mcp().register(supplier)
    f.request.mockResolvedValueOnce(allowed(false))
    await settle()
    expect(oldSignal?.aborted).toBe(true)
    expect(f.clients.map(client => client.config.serverName)).toEqual(['supply-chain'])
    f.request.mockResolvedValueOnce(allowed(false))
    f.settings.enabledPlugins = ['finance']; f.watch()
    expect(f.clients[0]!.dispose).toHaveBeenCalledOnce()
    await settle()
    pending.resolve(allowed())
    await settle()
    expect(f.gate().financeAllowed).toBe(false)
    expect(f.clients.map(client => client.config.serverName)).toEqual(['supply-chain'])
    expect(f.ctx.logger.error).not.toHaveBeenCalled()
  } finally { await f.dispose() }
})

it('immediately stops live transports on SSO loss and exits while an uncancellable permission request remains pending', async () => {
  vi.useFakeTimers()
  const f = fixture(), pending = deferred<Response>()
  await apply(f.ctx)
  f.request.mockReturnValueOnce(pending.promise)
  for (const route of [supplier, finance]) f.mcp().register(route)
  await settle()
  expect(f.clients).toHaveLength(1)
  f.clear(); f.binding()
  expect(f.clients[0]!.dispose).toHaveBeenCalledOnce()
  expect(f.gate().ready).toBe(false)
  expect(f.request.mock.calls[0]?.[1].signal?.aborted).toBe(true)
  await f.dispose()
  pending.resolve(allowed())
  await settle()
  await vi.advanceTimersByTimeAsync(120000)
  expect(f.clients).toHaveLength(1)
  expect(f.active.size).toBe(0)
  expect(() => f.mcp().register(supplier)).toThrow('DISPOSED')
})

it('retains a disposable startup handle so shutdown cannot resurrect an unfinished client', async () => {
  const f = fixture(), startup = deferred<void>()
  await apply(f.ctx)
  f.delayStartup(startup.promise)
  f.mcp().register(supplier)
  await settle()
  expect(f.clients).toHaveLength(1)
  await f.dispose()
  expect(f.clients[0]!.dispose).toHaveBeenCalledOnce()
  startup.reject(new Error('startup contained test-models'))
  await settle()
  expect(f.active.size).toBe(0)
  expect(f.ctx.logger.error).not.toHaveBeenCalled()
})

it('shares removal disposal and keeps the server name reserved until asynchronous cleanup settles', async () => {
  const f = fixture(), stopping = deferred<void>()
  await apply(f.ctx)
  try {
    const registration = f.mcp().register(supplier)
    await settle()
    f.clients[0]!.stopBarrier = stopping.promise
    const first = registration.dispose(), second = registration.dispose()
    expect(first).toBe(second)
    expect(f.clients[0]!.dispose).toHaveBeenCalledOnce()
    expect(() => f.mcp().register(supplier)).toThrow('DUPLICATE')
    stopping.resolve()
    await first
    f.mcp().register(supplier)
    await settle()
    expect(f.clients).toHaveLength(2)
    expect(f.active.size).toBe(1)
  } finally { stopping.resolve(); await f.dispose() }
})

it('fails closed when credential resolution fails and keeps credential-bearing errors out of logs', async () => {
  const f = fixture()
  await apply(f.ctx)
  try {
    for (const route of [supplier, finance]) f.mcp().register(route)
    await settle()
    f.resolve.mockRejectedValueOnce(new Error('test-models and test-sso'))
    f.watch()
    await settle()
    expect(f.clients.every(client => client.dispose.mock.calls.length === 1)).toBe(true)
    expect(f.gate().financeAllowed).toBe(false)
    expect(f.ctx.logger.error).toHaveBeenCalledWith('Hub MCP credentials could not resolve')
    expect(JSON.stringify(f.ctx.logger.error.mock.calls)).not.toMatch(/test-models|test-sso/u)
  } finally { await f.dispose() }
})

it('keeps the server name reserved after a failed disposer instead of colliding with its live transport', async () => {
  const f = fixture()
  await apply(f.ctx)
  try {
    const registration = f.mcp().register(supplier)
    await settle()
    f.clients[0]!.dispose.mockRejectedValueOnce(new Error('test-models disposal failure'))
    await expect(registration.dispose()).rejects.toThrow('DISPOSE_FAILED')
    expect(() => f.mcp().register(supplier)).toThrow('DUPLICATE')
    f.watch()
    await settle()
    expect(f.clients).toHaveLength(1)
    expect(f.ctx.logger.error).toHaveBeenCalledExactlyOnceWith('Hub MCP transport "supply-chain" could not stop')
    expect(JSON.stringify(f.ctx.logger.error.mock.calls)).not.toContain('test-models')
  } finally { await f.dispose() }
})

it('cleans up rejected startup before retrying the same namespace on a later renewal', async () => {
  vi.useFakeTimers()
  const f = fixture(), startup = deferred<void>()
  await apply(f.ctx)
  try {
    f.delayStartup(startup.promise)
    f.mcp().register(supplier)
    await settle()
    startup.reject(new Error('test-models startup failure'))
    await settle()
    expect(f.clients[0]!.dispose).toHaveBeenCalledOnce()
    expect(f.active.size).toBe(0)
    await vi.advanceTimersByTimeAsync(60000)
    expect(f.clients).toHaveLength(2)
    expect(f.active.size).toBe(1)
    expect(f.ctx.logger.error).toHaveBeenCalledExactlyOnceWith('Hub MCP transport "supply-chain" could not activate')
  } finally { await f.dispose() }
})

it('resolves service/domain references only from the sealed gateway projection',async()=>{
 const f=fixture();await apply(f.ctx)
 try{
  expect(()=>f.mcp().register({...tool,path:'tools/not-published'})).toThrow('INVALID')
  expect(()=>f.mcp().registerEndpoint({capability:'tools',serverName:'test',timeoutMs:60000,endpointRef:{service:'tools',domain:'not-published'}})).toThrow('UNAVAILABLE')
  const registration=f.mcp().registerEndpoint({capability:'tools',serverName:'test',timeoutMs:60000,endpointRef:{service:'tools',domain:'douyin_operation'}})
  await settle();expect(f.clients[0]?.config.url).toBe('https://ai.hozonauto.com/mcp/tools/douyin-operation');await registration.dispose()
 }finally{await f.dispose()}
})
