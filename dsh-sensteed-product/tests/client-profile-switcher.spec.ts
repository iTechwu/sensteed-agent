/** Profile 切换器（docs/1022 §6.1）：Host 意图通道交互、当前标识与键盘可达。 */
// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProfileSwitcher } from '../src/client/profile-switcher.tsx'
import { DOFE_ACCESS_COPY } from '../src/client/dofe-access.ts'

const t = (key: keyof typeof DOFE_ACCESS_COPY.en): string => DOFE_ACCESS_COPY.en[key]
const profiles = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: '内容创作', summary: { skills: 2, plugins: 1, mcpEndpoints: 1, skipped: 0 } },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: '数据分析', summary: { skills: 1, plugins: 0, mcpEndpoints: 2, skipped: 1 } },
]

function stubProfilesApi() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { action?: string; id?: string }
    const path = String(input)
    if (path.endsWith('/profiles')) {
      if (body.action === 'list') return new Response(JSON.stringify(profiles), { headers: { 'content-type': 'application/json' } })
      if (body.action === 'active') return new Response(JSON.stringify(profiles[0]!.id), { headers: { 'content-type': 'application/json' } })
      if (body.action === 'activate') return new Response(JSON.stringify({ switched: true, skippedCount: 1 }), { headers: { 'content-type': 'application/json' } })
    }
    if (path.endsWith('/telemetry')) return new Response('{"delivered":true}', { headers: { 'content-type': 'application/json' } })
    throw new Error(`unexpected fetch ${path}`)
  })
}

describe('ProfileSwitcher', () => {
  const roots: Root[] = []
  afterEach(() => { for (const root of roots.splice(0)) root.unmount(); vi.unstubAllGlobals() })

  async function mount(): Promise<HTMLElement> {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    roots.push(root)
    await act(async () => root.render(createElement(ProfileSwitcher, { wide: true, t, openHub: vi.fn() })))
    return host
  }
  const flush = async (): Promise<void> => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) }) }

  it('lists profiles with the current marker and switches on confirm via Host intents', async () => {
    const fetcher = stubProfilesApi()
    vi.stubGlobal('fetch', fetcher)
    const host = await mount()
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click() })
    await flush()
    expect(host.textContent).toContain('内容创作')
    expect(host.textContent).toContain('数据分析')
    expect(host.textContent).toContain(t('current'))
    vi.stubGlobal('confirm', vi.fn(() => true))
    await act(async () => { host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[1]!.click() })
    await flush()
    expect(fetcher).toHaveBeenCalledWith('/api/desktop/hub/generations/profiles', expect.objectContaining({ body: JSON.stringify({ action: 'activate', id: profiles[1]!.id }) }))
    expect(host.textContent).toContain(t('switched'))
    expect(host.textContent).toContain('1 item(s) unavailable and skipped.')
    // 切换成功经 Host 中继发 PROFILE_SWITCHED
    const bodies = fetcher.mock.calls.map(([, init]) => String(init?.body ?? ''))
    expect(bodies.some(body => body.includes('PROFILE_SWITCHED'))).toBe(true)
  })

  it('keeps the current profile without a confirm when reselected', async () => {
    const fetcher = stubProfilesApi()
    vi.stubGlobal('fetch', fetcher)
    const host = await mount()
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click() })
    await flush()
    await act(async () => { host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[0]!.click() })
    await flush()
    expect(host.textContent).toContain(t('alreadyCurrent'))
    expect(fetcher).not.toHaveBeenCalledWith('/api/desktop/hub/generations/profiles', expect.objectContaining({ body: JSON.stringify({ action: 'activate', id: profiles[0]!.id }) }))
  })

  it('focuses the current item on open, moves with arrows, and closes on Escape', async () => {
    vi.stubGlobal('fetch', stubProfilesApi())
    const host = await mount()
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click() })
    await flush()
    expect(document.activeElement?.getAttribute('aria-current')).toBe('true')
    const menu = host.querySelector('[role="menu"]')!
    await act(async () => { menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(document.activeElement?.textContent).toContain('数据分析')
    await act(async () => { menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(host.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement?.getAttribute('aria-haspopup')).toBe('menu')
  })
})
