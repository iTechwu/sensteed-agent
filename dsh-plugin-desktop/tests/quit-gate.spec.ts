import { describe, expect, it, vi } from 'vitest'
import {
  createDesktopQuitGate,
  desktopQuitGateCopy,
  resolveDesktopQuitPrompt,
  type DesktopQuitInspectionResult,
} from '../src/quit-gate.ts'

describe('desktop quit prompt resolution', () => {
  it('resolves the inspection matrix', () => {
    expect(resolveDesktopQuitPrompt({ source: 'ready', activeTasks: false, scheduledTasks: false })).toBe('quit')
    expect(resolveDesktopQuitPrompt({ source: 'ready', activeTasks: true, scheduledTasks: false })).toBe('ask-active')
    expect(resolveDesktopQuitPrompt({ source: 'ready', activeTasks: false, scheduledTasks: true })).toBe('ask-scheduled')
    expect(resolveDesktopQuitPrompt({ source: 'ready', activeTasks: true, scheduledTasks: true })).toBe('ask-both')
    expect(resolveDesktopQuitPrompt({ source: 'unavailable' })).toBe('quit')
    expect(resolveDesktopQuitPrompt({ source: 'unknown' })).toBe('ask-unknown')
  })
})

describe('desktop quit gate', () => {
  const ready: DesktopQuitInspectionResult = { source: 'ready', activeTasks: true, scheduledTasks: false }

  function gate(overrides: {
    inspect?: () => Promise<DesktopQuitInspectionResult>
    enabled?: boolean
    canPrompt?: () => boolean
    confirm?: (copy: unknown) => Promise<boolean>
  }) {
    const inspect = vi.fn(overrides.inspect ?? (async () => ready))
    const confirm = vi.fn(overrides.confirm ?? (async () => false))
    const instance = createDesktopQuitGate({
      enabled: overrides.enabled ?? (true as boolean),
      locale: () => 'zh',
      canPrompt: overrides.canPrompt ?? ((): boolean => true),
      inspect,
      confirm,
    })
    return { instance, inspect, confirm }
  }

  it('passes through when disabled or unable to prompt', async () => {
    const disabled = gate({ enabled: false })
    await expect(disabled.instance.run()).resolves.toBe(true)
    expect(disabled.inspect).not.toHaveBeenCalled()

    const silent = gate({ canPrompt: () => false })
    await expect(silent.instance.run()).resolves.toBe(true)
    expect(silent.confirm).not.toHaveBeenCalled()
  })

  it('asks and aborts when the user cancels', async () => {
    const target = gate({ confirm: async () => false })
    await expect(target.instance.run()).resolves.toBe(false)
    expect(target.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '有正在运行的任务' }))
  })

  it('proceeds when the user confirms', async () => {
    const target = gate({ confirm: async () => true })
    await expect(target.instance.run()).resolves.toBe(true)
  })

  it('maps an unavailable probe to a silent quit without a dialog', async () => {
    const target = gate({ inspect: async () => ({ source: 'unavailable' }) })
    await expect(target.instance.run()).resolves.toBe(true)
    expect(target.confirm).not.toHaveBeenCalled()
  })

  it('maps a thrown probe to the fail-closed prompt', async () => {
    const target = gate({
      inspect: async () => { throw new Error('boom') },
      confirm: async () => false,
    })
    await expect(target.instance.run()).resolves.toBe(false)
    expect(target.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '无法确认任务状态' }))
  })

  it('shares one flight across concurrent quit requests', async () => {
    let release: ((result: DesktopQuitInspectionResult) => void) | undefined
    const target = gate({
      inspect: () => new Promise<DesktopQuitInspectionResult>(resolve => { release = resolve }),
      confirm: async () => false,
    })
    const first = target.instance.run()
    const second = target.instance.run()
    release?.({ source: 'ready', activeTasks: true, scheduledTasks: false })
    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(false)
    expect(target.inspect).toHaveBeenCalledOnce()
  })

  it('renders bilingual copy for every ask decision', () => {
    for (const decision of ['ask-active', 'ask-scheduled', 'ask-both', 'ask-unknown'] as const) {
      expect(desktopQuitGateCopy(decision, 'zh').title.length).toBeGreaterThan(0)
      expect(desktopQuitGateCopy(decision, 'en-US').detail.length).toBeGreaterThan(0)
    }
  })
})
