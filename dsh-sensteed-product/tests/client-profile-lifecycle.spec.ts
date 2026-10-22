// @vitest-environment jsdom
import { act, createElement, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { ProfileSwitcher } from '../src/client/profile-switcher.tsx'
import { ProfileTemplatesSection } from '../src/client/profile-templates.tsx'
import { HubSetupSection } from '../src/client/HubSetupSection.tsx'
import { registerHubPages } from '../src/client/register-hub-pages.tsx'
import { DOFE_ACCESS_COPY } from '../src/client/dofe-access.ts'

const t = (key: keyof typeof DOFE_ACCESS_COPY.en): string => DOFE_ACCESS_COPY.en[key]
const profiles = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: '内容创作', summary: { skills: 2, plugins: 1, mcpEndpoints: 1, skipped: 0 } },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: '数据分析', summary: { skills: 1, plugins: 0, mcpEndpoints: 2, skipped: 0 } },
]
const template = {
  id: '11111111-1111-4111-8111-111111111111', key: 'content-creation', revision: 3,
  displayName: '内容创作', description: '用于内容创作的标准组合', useCases: ['写作'], iconKey: 'pen',
  counts: { skills: 1, plugins: 0, mcpEndpoints: 0 }, updatedAt: '2026-10-22T00:00:00.000Z',
}
const preview = { templateId: template.id, revision: 3, items: [
  { item: { kind: 'skill', identity: 'writing-pro', version: '1.2.3', enabled: true }, disposition: 'installable' },
] }
const check = { channel: 'stable', profileId: 'runtime-profile', activeGenerationDigest: 'generation-a', entries: [], activeItems: [] }
const emptySubscribe = () => () => {}
const json = (value: unknown): Response => Response.json(value)
const roots: Root[] = []

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(async () => {
  await act(async () => { for (const root of roots.splice(0)) root.unmount() })
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function mount(element: ReturnType<typeof createElement>): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => root.render(element))
  return host
}
async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => button.click())
}
async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
function buttonByText(host: ParentNode, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(candidate => candidate.textContent === text)
  expect(button, `button ${text}`).toBeDefined()
  return button!
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('Profile navigation and Host projection', () => {
  it('opens the registered skill page and exposes its real template creation section from the footer', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'))
      if (url.endsWith('/templates')) return json({ list: [template], total: 1 })
      if (url.endsWith('/check')) return json(check)
      if (body.action === 'list') return json([])
      if (body.action === 'active') return json(null)
      return json({ profiles: [], registeredId: null, appliedId: null, apply: { phase: 'idle' } })
    }))
    const core = new SlotCore()
    core.register({ name: 'root', children: {
      main: { kind: 'keyed', scope: 'root' }, 'desktop.navigation.context': { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' }, 'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'plugins.tab': { kind: 'list', scope: 'root' },
    } }, (() => null) as never)
    const selectPanel = vi.fn()
    const settingsScope = { subscribe: emptySubscribe, getSnapshot: () => ({ value: { authMode: 'feishu', identity: { ssoSub: 'alice' } } }) }
    registerHubPages({ effect: vi.fn(), layout: { selectPanel }, slots: {
      inject: (_name: string, callback: () => void) => callback(), register: core.register.bind(core),
    } } as never, { settingsScope: settingsScope as never, t, subscribeReconnect: emptySubscribe })
    const footer = core.entriesOfSlot('sidebar.footer.action').find(entry => entry.options.id === 'dofe-profile-switcher')!
    const host = await mount(createElement(footer.component as ComponentType<{ wide: boolean }>, { wide: true }))
    await click(host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!)
    await click(buttonByText(document.body, t('createHint')))
    expect(selectPanel).toHaveBeenCalledWith('sensteed-skill-manager')
    const entry = core.entriesOfSlot('main').find(candidate => candidate.options.key === selectPanel.mock.calls[0]![0])!
    const page = await mount(createElement(entry.component as ComponentType<Record<string, unknown>>, entry.inject!() as Record<string, unknown>))
    expect(page.querySelector(`section[aria-label="${t('templateTitle')}"]`)?.textContent).toContain(template.displayName)
  })

  it('shows the applied Profile before the menu has been opened', async () => {
    const fetcher = vi.fn(async () => json({ profiles, registeredId: profiles[1]!.id, appliedId: profiles[0]!.id, apply: { phase: 'registered', targetId: profiles[1]!.id } }))
    vi.stubGlobal('fetch', fetcher)
    const host = await mount(createElement(ProfileSwitcher, { wide: true, t, openHub: vi.fn() }))
    await settle()
    expect(host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.title).toContain(profiles[0]!.name)
    expect(host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.title).not.toContain(profiles[1]!.name)
  })

  it('renders an explicit loading state while the Profile projection is pending', async () => {
    const response = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn(() => response.promise))
    const host = await mount(createElement(ProfileSwitcher, { wide: true, t, openHub: vi.fn() }))
    await click(host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!)
    const menu = document.body.querySelector('[role="menu"]')!
    expect(menu.querySelector('[role="status"]')?.textContent).toContain(t('catalogLoading'))
    expect(menu.textContent).not.toContain(t('loadFailed'))
    await act(async () => response.resolve(json({ profiles: [], registeredId: null, appliedId: null, apply: { phase: 'idle' } })))
  })

  it('keeps a failed list read distinct from an empty list and can recover by reopening', async () => {
    let failed = true
    vi.stubGlobal('fetch', vi.fn(async () => failed
      ? new Response('{"error":"HUB_UNAVAILABLE"}', { status: 409 })
      : json({ profiles, registeredId: profiles[0]!.id, appliedId: profiles[0]!.id, apply: { phase: 'idle' } })))
    const host = await mount(createElement(ProfileSwitcher, { wide: true, t, openHub: vi.fn() }))
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
    await click(trigger)
    expect(document.body.querySelector('[role="menu"] [role="alert"]')?.textContent ?? '').toContain(t('loadFailed'))
    failed = false
    await click(trigger)
    await click(trigger)
    expect(document.body.querySelector('[role="menu"]')?.textContent).toContain(profiles[0]!.name)
    expect(document.body.querySelector('[role="menu"] [role="alert"]')).toBeNull()
  })

  it('keeps the applied current marker after another Profile is only registered, then follows the next Host projection', async () => {
    let registeredId = profiles[0]!.id
    let appliedId = profiles[0]!.id
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/telemetry')) return json({ delivered: true })
      const body = JSON.parse(String(init?.body ?? '{}')) as { action?: string; id?: string }
      if (body.action === 'activate') { registeredId = body.id!; return json({ registered: true, skippedCount: 0 }) }
      // Legacy reads remain in the fixture so this test detects premature current-marker changes.
      if (body.action === 'list') return json(profiles)
      if (body.action === 'active') return json(appliedId)
      return json({ profiles, registeredId, appliedId, apply: { phase: registeredId === appliedId ? 'idle' : 'registered', targetId: registeredId } })
    })
    vi.stubGlobal('fetch', fetcher)
    vi.stubGlobal('confirm', vi.fn(() => true))
    const host = await mount(createElement(ProfileSwitcher, { wide: true, t, openHub: vi.fn() }))
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
    await click(trigger)
    const menu = () => document.body.querySelector('[role="menu"]')!
    const item = (name: string) => [...menu().querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent?.includes(name))!
    await click(item(profiles[1]!.name))
    expect(item(profiles[0]!.name).getAttribute('aria-current')).toBe('true')
    expect(item(profiles[1]!.name).getAttribute('aria-current')).toBeNull()
    appliedId = profiles[1]!.id
    await click(trigger)
    await click(trigger)
    expect(item(profiles[1]!.name).getAttribute('aria-current')).toBe('true')
    expect(item(profiles[0]!.name).getAttribute('aria-current')).toBeNull()
  })
})

describe('Profile template preview and naming', () => {
  it('prefills the template name so a confirmed preview can be created without retyping', async () => {
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => json(url.endsWith('/template-preview') ? preview
      : url.endsWith('/templates') ? { list: [template], total: 1 }
      : { profileId: 'runtime-profile', contentProfileId: profiles[0]!.id, templateId: template.id, revision: 3, profileName: template.displayName, items: [], mcpEndpoints: [], skippedItems: [], entries: [] }))
    vi.stubGlobal('fetch', fetcher)
    const host = await mount(createElement(ProfileTemplatesSection, { t }))
    await click(host.querySelector<HTMLButtonElement>('.dshHubCardHeading')!)
    expect(host.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe(template.displayName)
    await click(buttonByText(host, t('templateCreate')))
    const request = fetcher.mock.calls.find(([url]) => url.endsWith('/instantiate'))
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ templateId: template.id, templateRevision: 3, profileName: template.displayName })
  })

  it('cannot create while the item preview is still loading', async () => {
    const response = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/template-preview') ? response.promise : json({ list: [template], total: 1 })))
    const host = await mount(createElement(ProfileTemplatesSection, { t }))
    await click(host.querySelector<HTMLButtonElement>('.dshHubCardHeading')!)
    expect(buttonByText(host, t('templateCreate')).disabled).toBe(true)
    await act(async () => response.resolve(json(preview)))
    expect(buttonByText(host, t('templateCreate')).disabled).toBe(false)
  })

  it('exposes a failed preview, prevents creation, and retries without remounting the section', async () => {
    let attempts = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/template-preview')) {
        attempts++
        return attempts === 1 ? new Response('{"error":"HUB_UNAVAILABLE"}', { status: 409 }) : json(preview)
      }
      return json({ list: [template], total: 1 })
    }))
    const host = await mount(createElement(ProfileTemplatesSection, { t }))
    await click(host.querySelector<HTMLButtonElement>('.dshHubCardHeading')!)
    expect(host.textContent).toContain(t('templatePreviewFailed'))
    expect(buttonByText(host, t('templateCreate')).disabled).toBe(true)
    await click(buttonByText(host, t('templateRetry')))
    expect(attempts).toBe(2)
    expect(host.textContent).toContain('writing-pro')
    expect(host.textContent).not.toContain(t('templatePreviewFailed'))
    expect(buttonByText(host, t('templateCreate')).disabled).toBe(false)
  })
})

describe('Host-owned activation receipts', () => {
  it('never issues renderer mark-applied writes when a polled operation for another Profile becomes activated', async () => {
    vi.useFakeTimers()
    let statuses = 0
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/profiles')) {
        const body = JSON.parse(String(init?.body ?? '{}'))
        return json(body.action === 'active' ? profiles[1]!.id : {})
      }
      if (url.endsWith('/status')) return json({ operationId: 'operation-a', contentProfileId: profiles[0]!.id, state: ++statuses === 1 ? 'STAGED' : 'ACTIVATED', phase: statuses === 1 ? 'STAGED' : 'ACTIVATED', outboxState: 'clear' })
      return json({ ...check, operation: { operationId: 'operation-a', state: 'STAGED', phase: 'STAGED' } })
    })
    vi.stubGlobal('fetch', fetcher)
    await mount(createElement(HubSetupSection, { t }))
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(document.body.textContent).toContain('ACTIVATED')
    expect(fetcher.mock.calls.filter(([url, init]) => url.endsWith('/profiles') && JSON.parse(String(init?.body ?? '{}')).action === 'mark-applied')).toEqual([])
  })

  it('renders an already activated operation after reconnect without writing an activation receipt from the page', async () => {
    let reconnect = () => {}
    const fetcher = vi.fn(async (url: string) => json(url.endsWith('/check')
      ? { ...check, operation: { operationId: 'operation-a', state: 'ACTIVATED', phase: 'ACTIVATED', outboxState: 'clear' } }
      : {}))
    vi.stubGlobal('fetch', fetcher)
    const host = await mount(createElement(HubSetupSection, { t, subscribeReconnect: listener => { reconnect = listener; return () => { reconnect = () => {} } } }))
    await act(async () => reconnect())
    expect(host.textContent).toContain('ACTIVATED')
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/profiles'))).toEqual([])
  })
})
