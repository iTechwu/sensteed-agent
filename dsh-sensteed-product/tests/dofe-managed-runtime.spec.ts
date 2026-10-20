import { describe, expect, it, vi } from 'vitest'
import { apply as applyManaged, DOFE_MCP_BASE_URL } from '../src/dofe-managed.ts'
import { apply as applyAuth } from '../src/dofe-host-auth.ts'
import { DOFE_ACCESS_VALIDATION_VERSION, DEFAULT_DOFE_PLUGIN_IDS, normalizeDofePluginIds, type DofeAccessSettings } from '../src/dofe-plugins.ts'
import { BRAND_VARIANT } from '../src/generated-product-identity.ts'

// The first two clients created before the simulated media route failure.
const BRAND_LEADING_SERVER_NAMES = ['knowledge', 'openmontage']

function createHarness(settings: DofeAccessSettings, failAt = Number.POSITIVE_INFINITY) {
  const clients: Array<{ config: Record<string, unknown>; dispose: ReturnType<typeof vi.fn> }> = []
  const errors: unknown[][] = []
  const cleanups: Array<() => unknown> = []
  let pluginCalls = 0
  const access = {
    get: () => settings,
    watch: vi.fn(),
  }
  const services: Record<string, unknown> = {}
  const ctx = {
    get: (name: string) => services[name],
    settings: { register: vi.fn(() => access), update: vi.fn(async () => {}) },
    // The sensteed branch builds its SSO service on the credential store; this
    // harness holds no saved grant, so the periodic restore stays idle.
    credentials: { resolve: vi.fn(async () => ({ value: 'test-managed-key' })), readRecord: vi.fn(async () => undefined) },
    systemPrompt: { section: vi.fn() },
    desktopRuntime: {
      registerTrayItem: vi.fn(() => ({ refresh: vi.fn(), dispose: vi.fn() })),
      openOpenMontage: vi.fn(async () => {}),
    },
    plugin: vi.fn(async (_plugin: unknown, config: Record<string, unknown>) => {
      pluginCalls += 1
      if (pluginCalls === failAt) throw new Error('transport failed with test-managed-key')
      const client = { config, dispose: vi.fn() }
      clients.push(client)
      return client
    }),
    on: vi.fn(),
    effect: vi.fn((effect: () => void | (() => unknown)) => {
      const cleanup = effect()
      if (cleanup) cleanups.push(cleanup)
    }),
    // The sensteed brand branch provides the SSO auth service; production
    // hands it to the Host plugin through this seam.
    provide: vi.fn((name: string, value: unknown) => { services[name] = value; Object.assign(ctx, { [name]: value }) }),
    logger: { error: vi.fn((...args: unknown[]) => errors.push(args)) },
  }
  Object.assign(ctx, { dofeAccessSettings: access, dofeAuth: { getDatasourceSession: () => undefined, watchBinding: () => () => {} } })
  return { ctx, access, clients, errors, dispose: async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  } }
}

describe('dofe-managed MCP runtime', () => {
  it.skipIf(BRAND_VARIANT !== 'sensteed')('uses the native network even during the initial saved-session restore', async () => {
    const harness = createHarness({ setupComplete: false, validationVersion: 0, enabledPlugins: [], modelId: '', protocol: 'chat-completions', authMode: 'feishu' })
    harness.ctx.credentials.readRecord.mockResolvedValue({ kind: 'grant', payload: { refreshToken: 'fixture' } } as never)
    const requestDofeAuth = vi.fn(async () => { throw new Error('net::ERR_PROXY_CONNECTION_FAILED') })
    Object.assign(harness.ctx.desktopRuntime, { requestDofeAuth })
    const nodeFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('stale Node proxy'))
    try {
      await applyAuth(harness.ctx as never)
      expect(requestDofeAuth).toHaveBeenCalledWith('https://user.hozonauto.com/api/.well-known/openid-configuration', expect.objectContaining({ redirect: 'error' }))
      expect(nodeFetch).not.toHaveBeenCalled()
      // A transport failure must not invalidate the user's saved setup.
      expect(harness.ctx.settings.update).not.toHaveBeenCalledWith(expect.anything(), { setupComplete: false })
    } finally { nodeFetch.mockRestore() }
  })
  it('creates only enabled routes and keeps wrapper capabilities out of MCP clients', async () => {
    const harness = createHarness({
      setupComplete: true,
      validationVersion: DOFE_ACCESS_VALIDATION_VERSION,
      // openmontage is the dedicated-route plugin shared by every brand.
      enabledPlugins: ['openmontage'],
      modelId: 'deepseek-chat',
      protocol: 'chat-completions',
      // The sensteed brand additionally requires a bound SSO identity.
      authMode: 'feishu',
      identity: { ssoSub: 'test-user', name: 'Test User' },
      entitlements: { plugins: ['openmontage'], defaultModel: 'deepseek-chat', allowedProtocols: ['chat-completions'] },
    })

    await applyManaged(harness.ctx as never)

    expect(harness.clients).toHaveLength(2)
    expect(harness.clients[0]?.config).toMatchObject({
      serverName: 'openmontage',
      url: DOFE_MCP_BASE_URL + '/montage',
      toolCallTimeoutMs: 600_000,
      transport: 'streamable-http',
      failOnStartupError: false,
    })
    expect(harness.clients[0]?.config).not.toHaveProperty('plugin', 'opencli')
    expect(harness.clients[0]?.config).not.toHaveProperty('serverName', 'knowledge')

    const accessWatcher = harness.access.watch.mock.calls[0]?.[0] as (() => void) | undefined
    accessWatcher?.()
    await vi.waitFor(() => expect(harness.ctx.plugin).toHaveBeenCalledTimes(2))
  })

  it('publishes the shared Knowledge and Memory permission gate from live access settings', async () => {
    const settings: DofeAccessSettings = {
      setupComplete: true,
      validationVersion: DOFE_ACCESS_VALIDATION_VERSION,
      enabledPlugins: ['openmontage', 'media', 'opencli', 'connect-im', 'knowledge'],
      modelId: 'deepseek-chat',
      protocol: 'chat-completions',
      authMode: 'feishu',
      identity: { ssoSub: 'test-user', name: 'Test User' },
      entitlements: { plugins: ['knowledge'], defaultModel: 'deepseek-chat', allowedProtocols: ['chat-completions'] },
    }
    const harness = createHarness(settings)

    await applyManaged(harness.ctx as never)

    const provideCall = harness.ctx.provide.mock.calls.find(([name]) => name === 'dofeAccess')
    const getGate = provideCall?.[1] as (() => { ready: boolean; enabledPlugins?: readonly string[]; entitlements?: { plugins: string[]; knowledge?: { permissionVersion: number; accesses: string[] } } }) | undefined
    expect(getGate).toBeDefined()
    expect(getGate?.()).toMatchObject({
      ready: true,
      enabledPlugins: ['openmontage', 'media', 'opencli', 'connect-im', 'knowledge'],
      entitlements: { plugins: ['knowledge'], knowledge: { permissionVersion: 1, accesses: ['read', 'write'] } },
    })

    settings.setupComplete = false
    expect(getGate?.().ready).toBe(false)
  })

  it('disposes partial clients after activation failure without logging the managed key', async () => {
    const harness = createHarness({
      setupComplete: true,
      validationVersion: DOFE_ACCESS_VALIDATION_VERSION,
      enabledPlugins: DEFAULT_DOFE_PLUGIN_IDS,
      modelId: 'deepseek-chat',
      protocol: 'chat-completions',
      // The sensteed brand additionally requires a bound SSO identity.
      authMode: 'feishu',
      identity: { ssoSub: 'test-user', name: 'Test User' },
      entitlements: { plugins: normalizeDofePluginIds(DEFAULT_DOFE_PLUGIN_IDS, BRAND_VARIANT), defaultModel: 'deepseek-chat', allowedProtocols: ['chat-completions'] },
    }, 3)

    await applyManaged(harness.ctx as never)

    expect(harness.clients).toHaveLength(2)
    // A failure on media must release both earlier clients.
    expect(harness.clients.map(client => client.config.serverName)).toEqual(BRAND_LEADING_SERVER_NAMES)
    expect(harness.errors).toEqual([['dofe-managed: failed to activate one or more MCP clients']])
    for (const client of harness.clients) expect(client.dispose).toHaveBeenCalledOnce()
  })

  it('uses the live Host finance gate without creating business transports or requesting permissions', async () => {
    const harness = createHarness({
      setupComplete: true, validationVersion: DOFE_ACCESS_VALIDATION_VERSION,
      enabledPlugins: ['tools', 'finance', 'supplier-intelligence'], modelId: '', protocol: 'messages',
      authMode: 'feishu', identity: { ssoSub: 'test-user', name: 'Test User' },
      entitlements: { plugins: ['tools', 'finance', 'supplier-intelligence'], defaultModel: '', allowedProtocols: ['messages'] },
    })
    let financeAllowed = true
    harness.ctx.provide('dofeAccess', () => ({ ready: true, financeAllowed }))
    Object.assign(harness.ctx, { tools: { schemas: () => [{ name: 'mcp__finance__query' }] } })
    const request = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('managed must not check business permissions'))
    try {
      await applyManaged(harness.ctx as never)
      expect(harness.clients.map(client => client.config.serverName)).toEqual(['openmontage', 'media'])
      expect(request).not.toHaveBeenCalled()
      const section = harness.ctx.systemPrompt.section.mock.calls[0]?.[0] as unknown as { text(context: unknown): string }
      expect(section.text({})).toContain('财务管理')
      financeAllowed = false
      expect(section.text({})).not.toContain('财务管理')
    } finally { request.mockRestore() }
  })

  it('keeps built-in transports when only Hub capability selections change', async () => {
    const settings: DofeAccessSettings = {
      setupComplete: true, validationVersion: DOFE_ACCESS_VALIDATION_VERSION,
      enabledPlugins: ['tools'], modelId: '', protocol: 'messages',
      authMode: 'feishu', identity: { ssoSub: 'test-user', name: 'Test User' },
      entitlements: { plugins: ['tools', 'supplier-intelligence'], defaultModel: '', allowedProtocols: ['messages'] },
    }
    const harness = createHarness(settings)
    try {
      await applyManaged(harness.ctx as never)
      settings.enabledPlugins = ['tools', 'supplier-intelligence']
      const watcher = harness.access.watch.mock.calls[0]?.[0] as () => void
      watcher()
      for (let i = 0; i < 10; i++) await Promise.resolve()
      expect(harness.ctx.plugin).toHaveBeenCalledTimes(2)
      for (const client of harness.clients) expect(client.dispose).not.toHaveBeenCalled()
    } finally { await harness.dispose() }
  })

  it('drains an in-flight activation on shutdown without starting later routes', async () => {
    const harness = createHarness({
      setupComplete: true, validationVersion: DOFE_ACCESS_VALIDATION_VERSION,
      enabledPlugins: ['openmontage', 'media'], modelId: '', protocol: 'messages',
      authMode: 'feishu', identity: { ssoSub: 'test-user', name: 'Test User' },
    })
    const client = { config: {}, dispose: vi.fn() }
    let finish!: (value: typeof client) => void
    harness.ctx.plugin.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const applying = applyManaged(harness.ctx as never)
    await vi.waitFor(() => expect(harness.ctx.plugin).toHaveBeenCalledOnce())
    const disposing = harness.dispose()
    finish(client)
    await Promise.all([applying, disposing])
    expect(harness.ctx.plugin).toHaveBeenCalledOnce()
    expect(client.dispose).toHaveBeenCalledOnce()
  })
})
