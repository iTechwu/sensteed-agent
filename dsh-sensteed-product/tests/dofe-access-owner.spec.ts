import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import * as Managed from '../src/dofe-managed.ts'

it('preserves the existing access owner while its real Cordis fiber is still starting', async () => {
  const ctx = new Context()
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const gate = () => ({ ready: false })
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network is unavailable in this test'))
  try {
    ctx.provide('credentials', { resolve: async () => undefined } as never)
    ctx.provide('tools', { schemas: () => [] } as never)
    ctx.provide('systemPrompt', { section() {} } as never)
    ctx.provide('settings', {} as never)
    ctx.provide('dofeAccessSettings', {
      get: () => ({ setupComplete: false, validationVersion: 0, enabledPlugins: [], authMode: 'feishu' }),
      watch: () => () => {},
    } as never)
    ctx.provide('dofeAuth', { getDatasourceSession: () => undefined, watchBinding: () => () => {} } as never)
    const owner = ctx.plugin({ name: 'pending-access-owner', async apply(host: Context) {
      host.provide('dofeAccess', gate)
      await pending
    } })
    await vi.waitFor(() => expect(ctx.get('dofeAccess', false)).toBe(gate))
    expect(ctx.get('dofeAccess')).toBeUndefined()
    const managed = await ctx.plugin(Managed)
    expect(managed.state).toBe(2)
    expect(ctx.get('dofeAccess', false)).toBe(gate)
    expect(ctx.get('dofeAccess')).toBeUndefined()
    release()
    await owner
    expect(ctx.get('dofeAccess')).toBe(gate)
    expect(network).not.toHaveBeenCalled()
  } finally {
    release()
    await ctx.fiber.dispose()
    network.mockRestore()
  }
})
