import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import * as HostCapabilities from '../src/dofe-host-capabilities.ts'
import * as Managed from '../src/dofe-managed.ts'
import { BRAND_VARIANT } from '../src/generated-product-identity.ts'
import { DOFE_ACCESS_VALIDATION_VERSION, type DofeAccessSettings } from '../src/dofe-plugins.ts'

const transports = vi.hoisted(() => ({
  active: new Set<string>(),
  created: [] as string[],
  duplicates: [] as string[],
}))

// Exercise real Cordis fibers and the shipped business plugins without opening
// sockets. Like the real MCP client, this transport reserves names until unload.
vi.mock('@deepseek-ai/dsh-mcp-client', () => ({
  name: 'mcp-client',
  inject: [],
  async apply(ctx: Context, config: { serverName: string }) {
    ctx.effect(() => {
      if (transports.active.has(config.serverName)) {
        transports.duplicates.push(config.serverName)
        throw new Error(`serverName "${config.serverName}" is already in use`)
      }
      transports.active.add(config.serverName)
      transports.created.push(config.serverName)
      return () => { transports.active.delete(config.serverName) }
    }, 'test MCP namespace lifetime')
  },
}))

type Section = { name: string; text: string | ((context: { scope?: unknown }) => string) }

async function fixture() {
  const ctx = new Context()
  const sections: Section[] = []
  const settings: DofeAccessSettings = {
    setupComplete: true,
    validationVersion: DOFE_ACCESS_VALIDATION_VERSION,
    authMode: 'feishu',
    identity: { ssoSub: 'fixture-user', name: 'Fixture' },
    enabledPlugins: ['knowledge', 'media', 'openmontage', 'tools', 'finance', 'supplier-intelligence'],
    entitlements: {
      plugins: ['knowledge', 'tools', 'finance', 'supplier-intelligence'],
      defaultModel: 'fixture',
      allowedProtocols: ['chat-completions'],
    },
    modelId: 'fixture',
    protocol: 'chat-completions',
  }
  const requestDofeAuth = vi.fn(async () => new Response(JSON.stringify({ data: { allowed: true } })))
  ctx.provide('credentials', { resolve: async () => ({ value: 'fixture-key' }) } as never)
  ctx.provide('settings', {} as never)
  ctx.provide('dofeAccessSettings', { get: () => settings, watch: () => () => {} } as never)
  ctx.provide('dofeAuth', {
    getDatasourceSession: () => ({ operator: 'fixture-user', tenantId: 'fixture-tenant', accessToken: 'fixture-sso' }),
    watchBinding: () => () => {},
  } as never)
  ctx.provide('tools', {
    schemas: () => [...transports.active].map(server => ({
      name: `mcp__${server}__${server === 'supply-chain' ? 'supply_chain_suppliers_list' : 'query'}`,
    })),
    register: () => () => {},
  } as never)
  ctx.provide('systemPrompt', {
    section: (section: Section) => { sections.push(section); return () => {} },
  } as never)
  ctx.provide('webServer', { port: 1, register: () => () => {} } as never)
  ctx.provide('desktopRuntime', {
    requestDofeAuth,
    registerTrayItem: () => ({ refresh() {}, dispose() {} }),
    openOpenMontage: async () => {},
  } as never)
  await ctx.plugin(HostCapabilities)
  return { ctx, requestDofeAuth, sections }
}

it.skipIf(BRAND_VARIANT !== 'sensteed').each(['before', 'after'] as const)(
  'keeps one transport per shipped business declaration with managed loaded %s the business plugins',
  async order => {
    transports.active.clear()
    transports.created.length = 0
    transports.duplicates.length = 0
    vi.useFakeTimers()
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network disabled in ownership test'))
    let ctx: Context | undefined
    try {
      const f = await fixture()
      ctx = f.ctx
      if (order === 'before') await ctx.plugin(Managed)
      for (const name of ['dsh-sensteed-finance', 'dsh-sensteed-supplier-intelligence', 'dsh-tools-mcp']) {
        const plugin = await import(new URL(`../../.ci/${name}/index.js`, import.meta.url).href)
        await ctx.plugin(plugin)
      }
      if (order === 'after') await ctx.plugin(Managed)
      await vi.advanceTimersByTimeAsync(0)

      const businessServers = [...transports.active].filter(server => !['knowledge', 'media', 'openmontage'].includes(server))
      expect(businessServers).toHaveLength(14)
      expect(businessServers).toEqual(expect.arrayContaining(['finance', 'supply-chain', 'tools-supply-chain', 'tools-platform']))
      expect(transports.duplicates).toEqual([])
      const initialNames = [...transports.created]
      expect(new Set(initialNames).size).toBe(initialNames.length)
      const initialPermissionChecks = f.requestDofeAuth.mock.calls.length

      for (let cycle = 0; cycle < 3; cycle++) {
        await vi.advanceTimersByTimeAsync(60_000)
        expect(transports.duplicates).toEqual([])
        expect(transports.created).toEqual(initialNames)
        expect(transports.active.size).toBe(initialNames.length)
      }
      expect(f.requestDofeAuth.mock.calls.length).toBeGreaterThanOrEqual(initialPermissionChecks + 3)
      expect(ctx.dofeAccess().financeAllowed).toBe(true)
      const section = f.sections.find(value => value.name === 'dofe:managed-access')
      expect(section).toBeDefined()
      const prompt = typeof section!.text === 'function' ? section!.text({}) : section!.text
      expect(prompt).toContain('财务管理：已通过财务工作区权限检查')
      expect(network).not.toHaveBeenCalled()
    } finally {
      await ctx?.fiber.dispose()
      vi.useRealTimers()
      network.mockRestore()
      expect(transports.active.size).toBe(0)
    }
  },
)
