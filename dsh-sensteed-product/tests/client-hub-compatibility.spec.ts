import { expect, it, vi } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { registerHubPages } from '../src/client/register-hub-pages.tsx'
import { HubPage } from '../src/client/HubPage.tsx'
import { DOFE_ACCESS_COPY } from '../src/client/dofe-access.ts'

it.each([true, false])('keeps legacy pages when present and falls back after disposal (legacy=%s)', legacyFirst => {
  const core = new SlotCore()
  core.register({ name: 'root', children: {
    main: { kind: 'keyed', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
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
  remove()
  expect(core.entriesOfSlot('main').find(entry => entry.options.key === 'plugins')?.component).toBe(HubPage)
})
