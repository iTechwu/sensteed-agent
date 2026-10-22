import { expect, it, vi } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { registerHubPages } from '../src/client/register-hub-pages.tsx'
import { HubPage } from '../src/client/HubPage.tsx'
import { DOFE_ACCESS_COPY } from '../src/client/dofe-access.ts'

it.each([true, false])('keeps legacy pages when present and falls back after disposal (legacy=%s)', legacyFirst => {
  const core = new SlotCore()
  core.register({ name: 'root', children: {
    main: { kind: 'keyed', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' }, 'sidebar.footer.action': { kind: 'list', scope: 'root' },
    'desktop.navigation.context': { kind: 'keyed', scope: 'root' },
    'plugins.tab': { kind: 'list', scope: 'root' },
  } }, (() => null) as never)
  const Legacy = () => null
  const mountLegacy = () => core.register({ name: 'main', key: 'plugins' }, Legacy)
  let remove = legacyFirst ? mountLegacy() : undefined
  registerHubPages({ effect: vi.fn(), slots: {
    inject: (_name: string, callback: () => void) => callback(), register: core.register.bind(core),
  } } as never, { settingsScope: {} as never, t: key => DOFE_ACCESS_COPY.zh[key], subscribeReconnect: () => () => {} })
  if (!remove) remove = mountLegacy()
  expect(core.entriesOfSlot('main').find(entry => entry.options.key === 'plugins')?.component).toBe(Legacy)
  expect(core.entriesOfSlot('plugins.tab').map(entry => entry.options.id)).toEqual(['sensteed-enterprise'])
  expect(core.entriesOfSlot('sidebar.panellist').map(entry => entry.options.id)).toEqual(['plugins', 'sensteed-skill-manager'])
  expect(core.entriesOfSlot('desktop.navigation.context').map(entry => entry.options.key)).toEqual(['plugins', 'sensteed-skill-manager'])
  remove()
  expect(core.entriesOfSlot('main').find(entry => entry.options.key === 'plugins')?.component).toBe(HubPage)
})

it('retains and opens a session before querying its skill catalog', async () => {
  const core = new SlotCore()
  core.register({ name: 'root', children: {
    main: { kind: 'keyed', scope: 'root' }, 'desktop.navigation.context': { kind: 'keyed', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' }, 'sidebar.footer.action': { kind: 'list', scope: 'root' }, 'plugins.tab': { kind: 'list', scope: 'root' },
  } }, (() => null) as never)
  let retained = false
  const list = vi.fn(async () => { expect(retained).toBe(true); return { ok: true, value: { skills: [{ name: 'local' }] } } })
  const using = vi.fn(async (_id, _options, run) => { retained = true; try { return await run({ binding: { session: { getSnapshot: () => ({ openState: 'open' }) } } }) } finally { retained = false } })
  registerHubPages({ effect: vi.fn(), sessions: { list: { getSnapshot: () => ({ ids: ['child', 's1'], byId: { child: { id: 'child', updatedAt: 99, origin: 'subagent' }, s1: { id: 's1', updatedAt: 1 } } }) }, using }, remote: { skills: { list } }, slots: {
    inject: (_name: string, callback: () => void) => callback(), register: core.register.bind(core),
  } } as never, { settingsScope: {} as never, t: key => DOFE_ACCESS_COPY.zh[key], subscribeReconnect: () => () => {} })
  const props = core.entriesOfSlot('main').find(entry => entry.options.key === 'sensteed-skill-manager')!.inject!() as { loadSkills: (signal: AbortSignal) => Promise<unknown> }
  expect(await props.loadSkills(new AbortController().signal)).toEqual([{ name: 'local' }])
  expect(using.mock.calls[0]?.[0]).toBe('s1')
  expect(using).toHaveBeenCalledOnce(); expect(list).toHaveBeenCalledOnce(); expect(retained).toBe(false)
})


it('declares the skills remote dependency used by the local catalog', async () => {
  const { inject } = await import('../src/client/index.ts')
  expect(inject).toContain('remote.skills')
})
