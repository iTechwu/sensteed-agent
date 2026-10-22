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
    expect(document.body.textContent).toContain('内容创作')
    // portal 逃逸：收起态 56px 侧栏轨道会裁剪 absolute 子元素，菜单必须挂在 body
    expect(host.querySelector('[role="menu"]')).toBeNull()
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull()
    expect(document.body.textContent).toContain('数据分析')
    expect(document.body.textContent).toContain(t('current'))
    vi.stubGlobal('confirm', vi.fn(() => true))
    await act(async () => { document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[2]!.click() })
    await flush()
    expect(fetcher).toHaveBeenCalledWith('/api/desktop/hub/generations/profiles', expect.objectContaining({ body: JSON.stringify({ action: 'activate', id: profiles[1]!.id }) }))
    expect(document.body.textContent).toContain(t('switched'))
    expect(document.body.textContent).toContain('1 item(s) unavailable and skipped.')
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
    await act(async () => { document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[1]!.click() })
    await flush()
    expect(document.body.textContent).toContain(t('alreadyCurrent'))
    expect(fetcher).not.toHaveBeenCalledWith('/api/desktop/hub/generations/profiles', expect.objectContaining({ body: JSON.stringify({ action: 'activate', id: profiles[0]!.id }) }))
  })

  it('focuses the current item on open, moves with arrows, and closes on Escape', async () => {
    vi.stubGlobal('fetch', stubProfilesApi())
    const host = await mount()
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click() })
    await flush()
    expect(document.activeElement?.getAttribute('aria-current')).toBe('true')
    const menu = document.body.querySelector('[role="menu"]')!
    await act(async () => { menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(document.activeElement?.textContent).toContain('数据分析')
    await act(async () => { menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.body.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement?.getAttribute('aria-haspopup')).toBe('menu')
  })

  it('keeps the add entry first and flags profiles holding skipped items', async () => {
    vi.stubGlobal('fetch', stubProfilesApi())
    const host = await mount()
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click() })
    await flush()
    // §6.1 菜单第一项永远「＋ 新增 Profile」；阻断项 ⚠ 徽标（skipped>0）
    expect(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[0]!.textContent).toContain(t('createHint'))
    expect(document.body.textContent).toContain('⚠')
  })

  it('shows a dedicated failure notice and keeps the current profile when activate fails', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { action?: string }
      const path = String(input)
      if (path.endsWith('/profiles')) {
        if (body.action === 'list') return new Response(JSON.stringify(profiles), { headers: { 'content-type': 'application/json' } })
        if (body.action === 'active') return new Response(JSON.stringify(profiles[0]!.id), { headers: { 'content-type': 'application/json' } })
        if (body.action === 'activate') return new Response('{"error":"HUB_UNAVAILABLE"}', { status: 409, headers: { 'content-type': 'application/json' } })
      }
      if (path.endsWith('/telemetry')) return new Response('{"delivered":true}', { headers: { 'content-type': 'application/json' } })
      throw new Error(`unexpected fetch ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const host = await mount()
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click() })
    await flush()
    vi.stubGlobal('confirm', vi.fn(() => true))
    await act(async () => { document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[2]!.click() })
    await flush()
    // §6.2 失败：不用读列表失败文案，仍停留在原 Profile
    expect(document.body.textContent).toContain(t('switchFailed'))
    const bodies = fetcher.mock.calls.map(([, init]) => String(init?.body ?? ''))
    expect(bodies.some(body => body.includes('PROFILE_APPLY_FAILED'))).toBe(true)
  })

  it('disables menu actions while an activate is in flight', async () => {
    let release!: (value: Response) => void
    const gate = new Promise<Response>(resolve => { release = resolve })
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { action?: string }
      const path = String(input)
      if (path.endsWith('/profiles')) {
        if (body.action === 'list') return new Response(JSON.stringify(profiles), { headers: { 'content-type': 'application/json' } })
        if (body.action === 'active') return new Response(JSON.stringify(profiles[0]!.id), { headers: { 'content-type': 'application/json' } })
        if (body.action === 'activate') return gate
      }
      if (path.endsWith('/telemetry')) return new Response('{"delivered":true}', { headers: { 'content-type': 'application/json' } })
      throw new Error(`unexpected fetch ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const host = await mount()
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click() })
    await flush()
    vi.stubGlobal('confirm', vi.fn(() => true))
    await act(async () => { document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[2]!.click() })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    // §6.4 应用中再操作：菜单禁用 + 进行中提示
    expect([...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].every(item => item.disabled)).toBe(true)
    expect(document.body.textContent).toContain(t('hubWorking'))
    await act(async () => {
      release(new Response(JSON.stringify({ switched: true, skippedCount: 0 }), { headers: { 'content-type': 'application/json' } }))
      await new Promise(resolve => setTimeout(resolve, 20))
    })
    expect(document.body.textContent).toContain(t('switched'))
  })
})
