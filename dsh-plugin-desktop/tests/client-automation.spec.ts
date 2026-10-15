// @vitest-environment jsdom
import { createElement, act, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { Context } from '@deepseek-ai/cordis'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyDesktopAutomation, automationPrompt, createAutomationStarter } from '../src/client/automation.tsx'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function fixture() {
  const ctx = new Context(); contexts.push(ctx)
  const slots = new SlotCore()
  slots.onMutate(key => { ctx.emit('slots/changed', key) })
  ctx.provide('slots', slots as never)
  const create = vi.fn(async () => 'new-automation' as SessionId)
  const send = vi.fn(async (_text: string) => {})
  const release = vi.fn()
  const open = vi.fn()
  const binding = { ctx: { conversation: { send } } }
  const using = vi.fn(async (_id: SessionId, _options: unknown, operation: (ref: { ready: Promise<typeof binding> }) => Promise<void>) => {
    try { await operation({ ready: Promise.resolve(binding) }) } finally { release() }
  })
  ctx.provide('sessions', { create, using, list: { getSnapshot: () => ({ byId: {
    older: { updatedAt: 10 }, recent: { updatedAt: 20 },
  } }) } } as never)
  ctx.provide('workspaces', { list: { getSnapshot: () => ({ items: [
    { workspaceId: 'old-project', sessionIds: ['older'] },
    { workspaceId: 'recent-project', sessionIds: ['recent'] },
  ] }) } } as never)
  ctx.provide('uiWorkspace', { openSession: open } as never)
  ctx.provide('locale', { getSnapshot: () => ({ active: 'zh' }) } as never)
  return { ctx, create, send, release, open, using }
}

describe('Desktop automation creation', () => {
  it('sends an explicit skill invocation before opening the new Session, inheriting the latest project', async () => {
    const test = await fixture()
    await createAutomationStarter(test.ctx).start()
    expect(test.create).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'recent-project' as WorkspaceId })
    expect(test.send).toHaveBeenCalledExactlyOnceWith(automationPrompt('zh', Intl.DateTimeFormat().resolvedOptions().timeZone))
    expect(test.send.mock.calls[0]?.[0]).toMatch(/^\/sensteed-automation /)
    expect(test.open).toHaveBeenCalledExactlyOnceWith('new-automation')
    expect(test.send.mock.invocationCallOrder[0]).toBeLessThan(test.open.mock.invocationCallOrder[0]!)
    expect(test.release).toHaveBeenCalledOnce()
  })

  it('works without a project and sends localized instructions with the actual time zone', async () => {
    const test = await fixture()
    vi.spyOn(test.ctx.workspaces.list, 'getSnapshot').mockReturnValue({ items: [] } as never)
    vi.spyOn(test.ctx.locale, 'getSnapshot').mockReturnValue({ active: 'en' } as never)
    await createAutomationStarter(test.ctx).start()
    expect(test.create).toHaveBeenCalledExactlyOnceWith({})
    expect(test.send.mock.calls[0]?.[0]).toContain('Help me create an automation.')
    expect(automationPrompt('en', 'America/New_York')).toContain('America/New_York')
  })

  it('shares concurrent clicks and lets a later deliberate action start another conversation', async () => {
    const test = await fixture()
    let finish!: () => void
    test.send.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const starter = createAutomationStarter(test.ctx)
    const first = starter.start()
    expect(starter.start()).toBe(first)
    await vi.waitFor(() => expect(test.send).toHaveBeenCalledOnce())
    finish(); await first
    await starter.start()
    expect(test.create).toHaveBeenCalledTimes(2)
  })

  it('retries a rejected send in the same Session and releases its reference on both outcomes', async () => {
    const test = await fixture()
    test.send.mockRejectedValueOnce(new Error('admission failed'))
    const starter = createAutomationStarter(test.ctx)
    await expect(starter.start()).rejects.toThrow('admission failed')
    expect(test.open).not.toHaveBeenCalled()
    await starter.start()
    expect(test.create).toHaveBeenCalledOnce()
    expect(test.send).toHaveBeenCalledTimes(2)
    expect(test.release).toHaveBeenCalledTimes(2)
    expect(test.open).toHaveBeenCalledOnce()
  })

  it('does not send or navigate after a creation failure and allows retry', async () => {
    const test = await fixture()
    test.create.mockRejectedValueOnce(new Error('creation refused'))
    const starter = createAutomationStarter(test.ctx)
    await expect(starter.start()).rejects.toThrow('creation refused')
    expect(test.send).not.toHaveBeenCalled()
    expect(test.open).not.toHaveBeenCalled()
    await starter.start()
    expect(test.send).toHaveBeenCalledOnce()
  })

  it('preserves the task page actions, invokes the skill from either creation button, and restores the upstream seat', async () => {
    const test = await fixture()
    const ctx = test.ctx
    ctx.slots.register({ name: 'root', children: { main: { kind: 'keyed', scope: 'root' } } } as never, () => null)
    const fiber = await ctx.plugin({ apply: applyDesktopAutomation }).await()
    const oldNewTask = vi.fn()
    const retryCatalog = vi.fn()
    const Page = (props: Record<string, unknown>) => createElement('section', null,
      createElement('button', { onClick: props.onNewTask as () => void }, '新建自动化任务'),
      createElement('button', { onClick: props.onNewTask as () => void }, '空列表新建'),
    )
    let removeOriginal = ctx.slots.register({ name: 'main', key: 'schedules',
      inject: () => ({ onNewTask: oldNewTask, onRetry: retryCatalog }),
    }, Page as never)
    const entry = ctx.slots.entriesOfSlot('main')[0]!
    expect(entry.component).not.toBe(Page)
    expect(entry.inject?.().onRetry).toBe(retryCatalog)
    const container = document.createElement('div'); document.body.append(container)
    const root = createRoot(container)
    const actEnv = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const previous = actEnv.IS_REACT_ACT_ENVIRONMENT; actEnv.IS_REACT_ACT_ENVIRONMENT = true
    try {
      await act(async () => { root.render(createElement(entry.component as ComponentType<Record<string, unknown>>, entry.inject?.())) })
      test.send.mockRejectedValueOnce(new Error('offline'))
      await act(async () => { container.querySelector('button')!.click() })
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('无法开始创建自动化任务')
      await act(async () => { container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click() })
      expect(test.create).toHaveBeenCalledOnce()
      expect(test.open).toHaveBeenCalledOnce()
      expect(container.querySelector('[role="alert"]')).toBeNull()
      await act(async () => { container.querySelectorAll('section button')[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(test.create).toHaveBeenCalledTimes(2)
      expect(oldNewTask).not.toHaveBeenCalled()
    } finally {
      await act(async () => { root.unmount() }); container.remove()
      if (previous === undefined) delete actEnv.IS_REACT_ACT_ENVIRONMENT
      else actEnv.IS_REACT_ACT_ENVIRONMENT = previous
    }
    removeOriginal()
    expect(ctx.slots.entriesOfSlot('main')).toEqual([])
    removeOriginal = ctx.slots.register({ name: 'main', key: 'schedules' }, Page as never)
    expect(ctx.slots.entriesOfSlot('main')[0]?.component).not.toBe(Page)
    await fiber.dispose()
    expect(ctx.slots.entriesOfSlot('main')[0]?.component).toBe(Page)
    removeOriginal()
  })
})
