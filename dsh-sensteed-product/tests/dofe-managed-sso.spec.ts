import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as applyManaged } from '../src/dofe-managed.ts'
import { apply as applyAuth } from '../src/dofe-host-auth.ts'
async function apply(ctx: Parameters<typeof applyAuth>[0]) { await applyAuth(ctx); await applyManaged(ctx) }
import { DOFE_ACCESS_VALIDATION_VERSION } from '../src/dofe-plugins.ts'

vi.mock('../src/generated-product-identity.ts', () => ({ BRAND_VARIANT: 'sensteed', BRAND_TENANT: 'sensteed' }))

function harness(overrides = {}) {
  let settings = {
    setupComplete: true, validationVersion: DOFE_ACCESS_VALIDATION_VERSION,
    modelId: 'model-a', protocol: 'messages', enabledPlugins: ['media', 'openmontage', 'finance'],
    authMode: 'feishu', identity: { ssoSub: 'user-1', name: 'User' },
    entitlements: { plugins: ['media', 'openmontage'], allowedProtocols: ['messages'], defaultModel: '' },
    ...overrides,
  }
  let grant: unknown = { kind: 'grant', payload: { refreshToken: 'refresh-old' } }
  const effects: Array<() => unknown> = []
  const tray = { enabled: () => false }
  const services: Record<string, unknown> = {}
  const ctx = {
    get: (name: string) => services[name],
    settings: {
      register: () => ({ get: () => settings, watch: vi.fn() }),
      update: vi.fn(async (_ns, patch) => { settings = { ...settings, ...patch } }),
    },
    credentials: {
      readRecord: async () => grant,
      modifyRecord: async (_key: unknown, mutate: (value: unknown) => Promise<unknown>) => { grant = await mutate(grant) },
      set: vi.fn(), resolve: async () => ({ value: 'model-key' }),
    },
    desktopRuntime: {
      openExternal: vi.fn(), openOpenMontage: vi.fn(),
      registerTrayItem: (item: typeof tray) => { tray.enabled = item.enabled; return { refresh() {}, dispose() {} } },
    },
    systemPrompt: { section: vi.fn() },
    tools: { schemas: vi.fn(() => [
      { name: 'mcp__media__create_generation_task' },
      { name: 'mcp__finance__query' },
    ]) },
    plugin: vi.fn(async () => ({ dispose() {} })),
    on: vi.fn(), emit: vi.fn(), provide: vi.fn((name: string, value: unknown) => { services[name] = value; Object.assign(ctx, { [name]: value }) }), logger: { error: vi.fn(), info: vi.fn() },
    effect: (effect: () => (() => unknown)) => { effects.push(effect()) },
  }
  return {
    ctx,
    tray,
    getSettings: () => settings,
    forgetGrant: () => { grant = undefined },
    dispose: async () => { for (const effect of effects) await effect() },
  }
}

const discovery = {
  issuer: 'https://user.hozonauto.com/api',
  authorization_endpoint: 'https://user.hozonauto.com/api/oauth/authorize',
  token_endpoint: 'https://user.hozonauto.com/api/oauth/token',
  userinfo_endpoint: 'https://user.hozonauto.com/api/oauth/userinfo',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Sensteed startup authorization', () => {
  it('persists the authorized supplier upgrade before renewal and keeps a later opt-out', async () => {
    const h = harness()
    h.forgetGrant()
    await h.ctx.settings.update('dofe-access', {
      enabledPlugins: ['tools'],
      entitlements: { plugins: ['tools'], defaultModel: '', allowedProtocols: ['messages'] },
    } as never)
    await applyAuth(h.ctx as never)
    expect(h.getSettings().enabledPlugins).toContain('supplier-intelligence')
    expect(h.getSettings()).toMatchObject({ supplierCapabilityInitialized: true })
    await h.dispose()
    await h.ctx.settings.update('dofe-access', { enabledPlugins: ['tools'] } as never)
    await applyAuth(h.ctx as never)
    expect(h.getSettings().enabledPlugins).not.toContain('supplier-intelligence')
    await h.dispose()
  })
  it('can boot identity alone with no saved grant and no business clients or network', async () => {
    const h = harness()
    h.forgetGrant()
    const fetcher = vi.fn(() => { throw new Error('base auth unexpectedly used network') })
    vi.stubGlobal('fetch', fetcher)
    const register = vi.spyOn(h.ctx.settings, 'register')
    await applyAuth(h.ctx as never)
    const service = h.ctx.get('dofeAuth') as { getStatus(): { status: string } }
    expect(service.getStatus().status).toBe('idle')
    expect(h.ctx.get('dofeAccessSettings')).toBeDefined()
    expect(h.ctx.plugin).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
    await applyManaged(h.ctx as never)
    expect(register).toHaveBeenCalledTimes(1)
    expect(h.ctx.plugin).not.toHaveBeenCalled()
    await h.dispose()
  })
  it('renews identity and removes withdrawn capabilities before starting MCP', async () => {
    const h = harness()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(discovery))
      .mockImplementationOnce(async () => {
        // The refresh runs before any gate reset: the last good state stays up
        // until the renewal finishes.
        expect(h.ctx.plugin).not.toHaveBeenCalled()
        return json({ access_token: 'access-new', refresh_token: 'refresh-new' })
      }).mockResolvedValueOnce(json({
        key: 'model-key', user: { ssoSub: 'user-1', name: 'User' },
        tenant: { tenantId: 'tenant', ssoTeamId: 'team', tenantSlug: 'sensteed' },
        entitlements: { plugins: ['media'], allowedProtocols: ['messages'] },
      })).mockResolvedValueOnce(json({ sub: 'user-1', name: 'User', picture: 'https://user.hozonauto.com/avatar/user-1.png' }))
      .mockResolvedValueOnce(json({ code: 0, data: { allowed: true } }))
      .mockResolvedValueOnce(json({ code: 0, data: { allowed: true } })))
    await apply(h.ctx as never)
    expect(h.getSettings().setupComplete).toBe(true)
    expect(h.getSettings().enabledPlugins).toEqual(['openmontage', 'media', 'opencli', 'connect-im', 'finance'])
    expect(h.ctx.plugin).toHaveBeenCalledTimes(3)
    expect(h.ctx.plugin).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      serverName: 'finance', url: 'https://ai.hozonauto.com/mcp/finance',
      headers: { Authorization: 'Bearer model-key', 'X-Sensteed-SSO-Authorization': 'Bearer access-new' },
    }))
    expect(h.tray.enabled()).toBe(true)
    const section = h.ctx.systemPrompt.section.mock.calls.find(([s]) => s.name === 'dofe:managed-access')![0]
    expect(section.text({})).toContain('财务管理')
    const getGate = h.ctx.provide.mock.calls.find(([name]) => name === 'dofeAccess')![1] as () => { financeAllowed: boolean }
    expect(getGate().financeAllowed).toBe(true)
    expect(h.ctx.emit).toHaveBeenCalledWith('dofe/access-changed')
    expect(section.text({})).toContain('图片与短视频')
    expect(h.ctx.desktopRuntime.openExternal).not.toHaveBeenCalled()
    await h.dispose()
  })

  it('does not start finance MCP when Datasource denies workspace access', async () => {
    const h = harness()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(discovery))
      .mockResolvedValueOnce(json({ access_token: 'access-new', refresh_token: 'refresh-new' }))
      .mockResolvedValueOnce(json({
        key: 'model-key', user: { ssoSub: 'user-1', name: 'User' },
        tenant: { tenantId: 'tenant', ssoTeamId: 'team', tenantSlug: 'sensteed' },
        entitlements: { plugins: ['media'], allowedProtocols: ['messages'] },
      }))
      .mockResolvedValueOnce(json({ sub: 'user-1', name: 'User' }))
      .mockResolvedValueOnce(json({ code: 0, data: { allowed: false } }))
      .mockResolvedValueOnce(json({ code: 0, data: { allowed: false } })))
    await apply(h.ctx as never)
    expect(h.ctx.plugin).toHaveBeenCalledTimes(2)
    expect(h.ctx.plugin).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ serverName: 'finance' }))
    const section = h.ctx.systemPrompt.section.mock.calls.find(([s]) => s.name === 'dofe:managed-access')![0]
    expect(section.text({})).not.toContain('财务')
    const getGate = h.ctx.provide.mock.calls.find(([name]) => name === 'dofeAccess')![1] as () => { financeAllowed: boolean }
    expect(getGate().financeAllowed).toBe(false)
    const assemble = h.ctx.on.mock.calls.find(([name]) => name === 'system-prompt/assemble')![1]
    const assembly = { sections: [{ name: 'openmontage:guidance' }, { name: 'other' }] }
    expect((await assemble(assembly, {}, async () => assembly)).sections).toEqual([{ name: 'other' }])
    expect(section.text({})).toContain('图片与短视频')
    h.ctx.tools.schemas.mockReturnValue([])
    expect(section.text({ scope: 'restricted-agent' })).not.toContain('图片与短视频')
    expect(h.ctx.tools.schemas).toHaveBeenLastCalledWith('restricted-agent')
    await h.dispose()
  })

  it('keeps the gate closed when the refresh grant expires', async () => {
    const h = harness()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(discovery))
      .mockResolvedValueOnce(json({ error: 'invalid_grant' }, 400)))
    await apply(h.ctx as never)
    expect(h.getSettings().setupComplete).toBe(false)
    expect(h.ctx.plugin).not.toHaveBeenCalled()
    expect(h.tray.enabled()).toBe(false)
    expect(h.ctx.desktopRuntime.openExternal).not.toHaveBeenCalled()
    await h.dispose()
  })

  it('keeps the last good gate state across a transient provisioning failure', async () => {
    const h = harness()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(discovery))
      .mockResolvedValueOnce(json({ access_token: 'access-new' }))
      .mockResolvedValueOnce(json({ error: 'unavailable' }, 503)))
    await apply(h.ctx as never)
    expect(h.getSettings().setupComplete).toBe(true)
    expect(h.ctx.desktopRuntime.openExternal).not.toHaveBeenCalled()
    await h.dispose()
  })

  it('closes the gate when the home has no saved session', async () => {
    const h = harness()
    h.forgetGrant()
    await apply(h.ctx as never)
    expect(h.getSettings().setupComplete).toBe(false)
    expect(h.ctx.plugin).not.toHaveBeenCalled()
    expect(h.ctx.desktopRuntime.openExternal).not.toHaveBeenCalled()
    await h.dispose()
  })
})

it.each([true, false])('preserves setup completion (%s) while refreshing profile and departments every 15 minutes', async complete => {
  vi.useFakeTimers()
  const h = harness({ setupComplete: complete, validationVersion: 1 })
  let revision = 0
  let profileUnavailable = false
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('openid-configuration')) return json(discovery)
    if (url.endsWith('/token')) return json({ access_token: 'new-access', refresh_token: 'new-refresh' })
    if (url.endsWith('/userinfo')) return profileUnavailable ? json({}, 503) : json({ sub: 'user-1', name: `Name ${revision}`, picture: revision ? null : 'https://example.com/avatar.png' })
    if (url.endsWith('/workspace-access')) return json({ code: 0, data: { allowed: true } })
    return json({
      key: 'model-key', user: { ssoSub: 'user-1', name: 'Stale name' },
      tenant: { tenantId: 'tenant', ssoTeamId: 'team', tenantSlug: 'sensteed' },
      groups: [`department-${revision}`], groupNames: { [`department-${revision}`]: `Department ${revision}` },
      entitlements: { plugins: ['media', 'openmontage'], allowedProtocols: ['messages'] },
    })
  }))
  try {
    await apply(h.ctx as never)
    expect(h.getSettings().setupComplete).toBe(complete)
    expect(h.getSettings().validationVersion).toBe(complete ? DOFE_ACCESS_VALIDATION_VERSION : 1)
    expect(h.getSettings().identity).toMatchObject({ name: 'Name 0', avatar: 'https://example.com/avatar.png' })
    profileUnavailable = true
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(h.getSettings().setupComplete).toBe(complete)
    expect(h.getSettings().identity).toMatchObject({ name: 'Name 0', avatar: 'https://example.com/avatar.png' })
    profileUnavailable = false
    revision = 1
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(h.getSettings().setupComplete).toBe(complete)
    expect(h.getSettings().modelId).toBe('model-a')
    expect(h.getSettings().enabledPlugins).toEqual(['openmontage', 'media', 'opencli', 'connect-im', 'finance'])
    expect(h.getSettings().identity).toMatchObject({ name: 'Name 1', avatar: null, groups: ['department-1'], groupNames: { 'department-1': 'Department 1' } })
    expect(h.ctx.desktopRuntime.openExternal).not.toHaveBeenCalled()
  } finally { await h.dispose() }
})
