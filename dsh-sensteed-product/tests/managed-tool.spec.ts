import { describe, expect, it, vi } from 'vitest'
import { registerManagedTool } from '../src/managed-tool.ts'

describe('managed local tools', () => {
  it('does not advertise disabled tools, reacts to grants, and blocks captured tools after revocation', async () => {
    const gate = { ready: true, enabledPlugins: [] as string[], entitlements: { plugins: ['knowledge'] } }
    let changed: () => void = () => {}
    let registered: { execute(...args: unknown[]): unknown } | undefined
    const remove = vi.fn(() => { registered = undefined })
    const stop = vi.fn()
    const ctx = {
      dofeAccess: () => gate,
      on: (_event: string, callback: () => void) => { changed = callback; return stop },
      tools: { register: vi.fn(tool => { registered = tool; return remove }) },
    }
    const execute = vi.fn(async () => ({ ok: true }))
    const dispose = registerManagedTool(ctx as never, 'knowledge', { name: 'test', execute } as never)
    expect(ctx.tools.register).not.toHaveBeenCalled()
    gate.enabledPlugins = ['knowledge']
    changed()
    const captured = registered!
    await captured.execute({}, {})
    expect(execute).toHaveBeenCalledOnce()
    gate.entitlements.plugins = []
    changed()
    expect(registered).toBeUndefined()
    expect(() => captured.execute({}, {})).toThrow('not enabled')
    expect(execute).toHaveBeenCalledOnce()
    dispose()
    expect(stop).toHaveBeenCalledOnce()
  })
})
