// @vitest-environment jsdom
import { act, createElement, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/src/client/registry.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyDesktopNavigation } from '../src/client/desktop-navigation.tsx'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

describe('desktop navigation composition', () => {
  it('owns only sidebar declarations and releases them on unload', async () => {
    const ctx = new Context(); contexts.push(ctx)
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', { subscribe: () => () => {}, getSnapshot: () => ({ active: 'zh' }) } as never)
    const Root = () => null
    const marker = vi.fn()
    ctx.slots.register({ name: 'root', children: { sidebar: { kind: 'single', scope: 'root' } } } as never, Root)
    const fiber = await ctx.plugin({ inject: ['slots', 'locale'], apply: applyDesktopNavigation }).await()
    const entry = ctx.slots.entriesOfSlot('sidebar')[0]!
    expect(entry.registrant).toBe('desktop-navigation')
    expect(entry.children).toHaveProperty('sidebar.workspaces')
    expect(entry.children).toHaveProperty('sidebar.settings')
    expect(ctx.slots.entriesOfSlot('root')[0]?.component).toBe(Root)
    const permissionAwareLauncher = () => null
    const disposeKnowledge = ctx.slots.register({ name: 'sidebar.footer.action', id: 'dofe-sensteed-knowledge',
      inject: () => ({ t: (key: string) => key === 'open' ? '企业知识' : 'unchanged', onOpen: marker }),
    }, permissionAwareLauncher)
    await vi.waitFor(() => expect(ctx.slots.entriesOfSlot('sidebar.footer.action')[0]?.registrant).toBe('desktop-knowledge-label'))
    const knowledge = ctx.slots.entriesOfSlot('sidebar.footer.action')[0]!
    expect(knowledge.component).toBe(permissionAwareLauncher)
    const props = knowledge.inject?.() as { t: (key: string) => string; onOpen: unknown }
    expect(props.t('open')).toBe('知识与记忆')
    expect(props.t('other')).toBe('unchanged')
    expect(props.onOpen).toBe(marker)
    disposeKnowledge()
    await vi.waitFor(() => expect(ctx.slots.entriesOfSlot('sidebar.footer.action')).toHaveLength(0))
    await fiber.dispose()
    expect(ctx.slots.entriesOfSlot('sidebar')).toHaveLength(0)
  })

  it('keeps navigation mounted when the context column collapses and preserves the workspace tree across module switches', async () => {
    const { DesktopNavigationFrame, DesktopNavigationSidebar } = await import('../src/client/DesktopNavigation.tsx')
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div'); document.body.append(container)
    const root = createRoot(container)
    const selectPanel = vi.fn()
    let active: string | null = null, mounts = 0
    const Tree = () => { mounts++; return createElement('input', { 'aria-label': 'workspace search', defaultValue: 'retained' }) }
    const Component = (props: Record<string, unknown>) => createElement(DesktopNavigationSidebar as ComponentType<Record<string, unknown>>, {
      ...props, collapsed: true, width: 0, toggleSidebar: vi.fn(), startSession: vi.fn(), selectPanel,
      useExtensions: (select: (ids: readonly string[]) => unknown) => select(['dofe-sensteed-knowledge', 'finance']),
      usePanelInfo: (select: (value: { activePanelId: string | null }) => unknown) => select({ activePanelId: active }),
      usePanels: (select: (value: unknown) => unknown) => select([{ id: 'plugins', label: '插件', order: 0 }, { id: 'schedules', label: '定时任务', order: 5 }]),
      t: (key: string) => key === 'session.new' ? '新聊天' : key,
      renderSlot: (name: string) => name === 'sidebar.workspaces' ? createElement(Tree) : createElement('span', { 'data-slot': name }),
    })
    const render = async () => { await act(async () => root.render(createElement(DesktopNavigationFrame, { Frame: Component, frameProps: {}, platform: 'linux' }))) }
    try {
      await render()
      expect(container.querySelector('[aria-label="主页"]')).not.toBeNull()
      expect(container.querySelector('[aria-label="展开项目与聊天"]')).not.toBeNull()
      expect(container.querySelector('[data-context="home"]')?.hasAttribute('hidden')).toBe(true)
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="插件"]')!.click())
      expect(selectPanel).toHaveBeenCalledWith('plugins')
      active = 'plugins'; await render()
      expect(container.querySelector<HTMLInputElement>('[aria-label="workspace search"]')?.value).toBe('retained')
      expect(mounts).toBeGreaterThan(0)
      const nav = container.querySelector('nav')!
      expect([...nav.querySelectorAll('button')].map(button => button.getAttribute('aria-label'))).toEqual(['主页', '定时任务', '插件'])
      expect(container.querySelector('[data-slot="sidebar.settings"]')).not.toBeNull()
    } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() }
  })
})
