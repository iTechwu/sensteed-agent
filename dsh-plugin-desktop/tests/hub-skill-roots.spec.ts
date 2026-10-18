import { expect, it, vi } from 'vitest'
const calls = vi.hoisted(() => ({ policy: vi.fn<(ctx: unknown, policy: unknown) => () => void>(() => () => undefined) }))
vi.mock('@deepseek-ai/dsh-skill-filesystem', () => ({ installFilesystemSkillRootPolicy: calls.policy }))
import { registerHubBootstrapSkillRoots, registerHubSkillRoots } from '../src/hub-skill-roots.ts'

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

it('seals empty enterprise roots before bootstrap providers can read bundled or custom settings',()=>{calls.policy.mockImplementation((_ctx,policy)=>{expect(policy).toEqual({generationId:'bootstrap',providerName:'hub-bootstrap',roots:[]});return()=>{}});const effect=vi.fn();registerHubBootstrapSkillRoots({effect}as never);expect(effect).toHaveBeenCalledOnce()})

it('adds the explicit user-local provider without extending enterprise roots',async()=>{calls.policy.mockImplementation((_ctx,policy)=>{expect(policy).toEqual({generationId:'bootstrap',providerName:'hub-bootstrap',roots:[],userRoots:['/private/home/skills']});return()=>{}});const configs:unknown[]=[];let mount!:()=>Promise<void>;registerHubBootstrapSkillRoots({effect:vi.fn(),inject:(_keys:string[],fn:(scope:unknown)=>Promise<void>)=>{mount=()=>fn({plugin:async(_p:unknown,c:unknown)=>{configs.push(c)}})}}as never,'/private/home/skills');await mount();expect(configs).toEqual([{providerName:'user-local',includeDefaultRoots:false,watch:false}])})
