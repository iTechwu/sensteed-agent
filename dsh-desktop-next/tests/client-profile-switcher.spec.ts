/** Profile 切换器（docs/1022 §6.1）：意图通道交互与当前标识。 */
// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProfileSwitcher } from '../src/client/profile-switcher.tsx'

const profiles = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: '内容创作', summary: { skills: 2, plugins: 1, mcpEndpoints: 1, skipped: 0 } },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: '数据分析', summary: { skills: 1, plugins: 0, mcpEndpoints: 2, skipped: 1 } },
]

function bridge() {
  const request = vi.fn(async (input: { action: string; id?: string }) => {
    if (input.action === 'list') return profiles
    if (input.action === 'active') return profiles[0]!.id
    if (input.action === 'set-active') return true
    throw new Error('unexpected action')
  })
  vi.stubGlobal('dshContentProfiles', undefined)
  ;(window as unknown as { desktopNext?: unknown }).desktopNext = { contentProfiles: { request } }
  return request
}

describe('ProfileSwitcher', () => {
  const roots: Root[] = []
  afterEach(() => { for (const root of roots.splice(0)) root.unmount(); vi.unstubAllGlobals(); delete (window as unknown as { desktopNext?: unknown }).desktopNext })

  async function mount(props?: { wide?: boolean }): Promise<HTMLElement> {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    roots.push(root)
    await act(async () => root.render(createElement(ProfileSwitcher, { wide: props?.wide ?? true, t: key => ({
      profilesLabel: 'Profile', current: '当前', switchHint: '切换后需要重新应用', createHint: '在插件与技能安装中创建',
      switched: '已切换', alreadyCurrent: '已是当前 Profile', loadFailed: '读取失败',
    })[key]!, openPlugins: vi.fn() })))
    return host
  }

  it('renders the foot button without a bridge', async () => {
    const host = await mount()
    expect(host.querySelector('button')).toBeNull()
  })

  it('lists profiles with the current marker and switches on confirm', async () => {
    const request = bridge()
    const host = await mount()
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click() })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(host.textContent).toContain('内容创作')
    expect(host.textContent).toContain('数据分析')
    expect(host.textContent).toContain('当前')
    vi.stubGlobal('confirm', vi.fn(() => true))
    const items = host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    await act(async () => { items[1]!.click() })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(request).toHaveBeenCalledWith({ action: 'set-active', id: profiles[1]!.id })
    expect(host.textContent).toContain('已切换')
  })

  it('focuses the current item on open, moves with arrows, and closes on Escape', async () => {
    const request = bridge()
    const host = await mount()
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click() })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(document.activeElement?.getAttribute('aria-current')).toBe('true')
    const menu = host.querySelector('[role="menu"]')!
    await act(async () => { menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(document.activeElement?.textContent).toContain('数据分析')
    await act(async () => { menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(host.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement?.getAttribute('aria-haspopup')).toBe('menu')
  })

  it('keeps the current profile without a confirm when reselected', async () => {
    const request = bridge()
    const host = await mount()
    await act(async () => { host.querySelector<HTMLButtonElement>('aria-haspopup, button[aria-haspopup="menu"]')!.click() })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    const current = host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[0]!
    await act(async () => { current.click() })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(host.textContent).toContain('已是当前 Profile')
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'set-active' }))
  })
})
