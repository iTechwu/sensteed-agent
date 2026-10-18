import { expect, it, vi } from 'vitest'
const calls = vi.hoisted(() => ({ policy: vi.fn<(ctx: unknown, policy: unknown) => () => void>(() => () => undefined) }))
vi.mock('@deepseek-ai/dsh-skill-filesystem', () => ({ installFilesystemSkillRootPolicy: calls.policy }))
import { registerHubSkillRoots } from '../src/hub-skill-roots.ts'

it('seals generation roots before mounting the sole Host provider', async () => {
  const order: string[] = []
  calls.policy.mockImplementation((_ctx, policy) => {
    order.push('seal')
    expect(policy).toEqual({ generationId: 'g1', providerName: 'hub-g1', roots: [{ path: '/private/g1/skills', source: 'hub', rank: 100 }] })
    return () => undefined
  })
  const mount = vi.fn(async (_plugin: unknown, config: unknown) => {
    order.push('mount')
    expect(config).toEqual({ providerName: 'hub-g1', includeDefaultRoots: false, watch: false })
  })
  let inject!: () => Promise<void>
  const ctx = {
    effect: vi.fn(),
    inject(names: string[], callback: (scope: unknown) => Promise<void>) {
      expect(names).toEqual(['skills'])
      inject = () => callback({ plugin: mount })
    },
  }
  registerHubSkillRoots(ctx as never, { generationId: 'g1', skillProviderName: 'hub-g1', skillsRoot: '/private/g1/skills' } as never)
  expect(order).toEqual(['seal'])
  await inject()
  expect(order).toEqual(['seal', 'mount'])
  expect(ctx.effect).toHaveBeenCalledOnce()
})
