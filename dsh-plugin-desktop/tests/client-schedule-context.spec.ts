// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ScheduleContext } from '../src/client/ScheduleContext.tsx'
import type { ScheduleContextSource } from '../src/client/ScheduleContext.tsx'

it('uses the native task catalog and actions, including failed reads and retry', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const onOpenSession = vi.fn(), onNewTask = vi.fn(), onRetry = vi.fn()
  const snapshot = { records: [{ id: 'task1', sessionId: 'session1', title: '供应商日报', status: 'active' }], status: 'ready', settled: true, readRequest: 2 }
  const source = { hooks: { catalog: { subscribe: () => () => {}, getSnapshot: () => snapshot } }, onOpenSession, onNewTask, onRetry } as unknown as ScheduleContextSource
  try {
    await act(async () => root.render(createElement(ScheduleContext, { source })))
    const buttons = container.querySelectorAll('button')
    await act(async () => buttons[0]!.click())
    expect(onNewTask).toHaveBeenCalledOnce()
    await act(async () => buttons[1]!.click())
    expect(onOpenSession).toHaveBeenCalledWith('session1')
    snapshot.status = 'error'
    await act(async () => root.render(createElement(ScheduleContext, { source })))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('任务加载失败')
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '重新加载')!.click())
    expect(onRetry).toHaveBeenCalledWith(2)
  } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() }
})
