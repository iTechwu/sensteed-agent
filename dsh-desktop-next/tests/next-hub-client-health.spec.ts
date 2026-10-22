// @vitest-environment jsdom
/** Mount the actual health overlay registered by the Next client plugin. */
import { act, createElement, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('../src/client/settings.tsx', () => ({
  NextDesktopSettings: () => null,
  NextDesktopActions: () => null,
  NextVersionsSettingsPage: () => null,
}))
vi.mock('../src/client/plugin-controls.tsx', () => ({
  registerPluginControls() {},
}))
vi.mock('../src/client/settings-requests.tsx', () => ({
  SettingsRequests: () => null,
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
  document.body.replaceChildren()
})

it.each(['error', 'unhandledrejection'] as const)(
  'does not acknowledge healthy renderer after a managed client import raises %s before its first frames',
  async (failure) => {
    const { apply } = await import('../src/client/index.ts')
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrame = 0
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        const id = ++nextFrame
        frames.set(id, callback)
        return id
      }),
    )
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => frames.delete(id)),
    )
    const report = vi.fn(async () => {})
    Object.defineProperty(window, 'desktopNext', {
      configurable: true,
      value: { reportHubHealthy: report, permissions: undefined },
    })
    let Health: ComponentType | undefined
    const disposers: (() => unknown)[] = []
    const ctx = {
      effect(fn: () => unknown) {
        const dispose = fn()
        if (typeof dispose === 'function')
          disposers.push(dispose as () => unknown)
      },
      locale: { register: () => () => {}, bind: () => (key: string) => key },
      inject() {},
      reflect: { provide: () => () => {} },
      slots: {
        inject(_name: string, run: () => void) {
          run()
        },
        register(options: { id?: string }, component: ComponentType) {
          if (options.id === 'next-hub-health') Health = component
          return () => {}
        },
      },
    }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    apply(ctx as never)
    expect(Health).toBeDefined()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(createElement(Health!)))
      const event =
        failure === 'error'
          ? new ErrorEvent('error', {
              message: 'managed client bundle import failed',
              error: Error('managed client bundle import failed'),
            })
          : new Event('unhandledrejection')
      if (failure === 'unhandledrejection')
        Object.defineProperty(event, 'reason', {
          value: Error('managed client bundle import failed'),
        })
      window.dispatchEvent(event)
      for (let round = 0; round < 2; round++) {
        const callbacks = [...frames.values()]
        frames.clear()
        await act(async () => {
          for (const callback of callbacks) callback(performance.now())
        })
      }
      expect(report).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      for (const dispose of disposers.reverse()) dispose()
      delete (window as unknown as Record<string, unknown>).desktopNext
    }
  },
)
