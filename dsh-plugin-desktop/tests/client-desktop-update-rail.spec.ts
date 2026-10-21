// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDesktopUpdateRail } from '../src/client/desktop-update-rail.ts'
import type { DesktopSettingsApi } from '../src/client/desktop-settings-api.ts'
import type { DesktopUpdateStatus } from '../src/update-status.ts'

let root: Root | undefined
let container: HTMLDivElement | undefined

const availableAt = (version: string): DesktopUpdateStatus => ({
  status: 'update-available', channel: 'stable', latestVersion: version, checkedAt: '2026-10-21T00:00:00Z',
})
const upToDate: DesktopUpdateStatus = { status: 'up-to-date', channel: 'stable', checkedAt: '2026-10-21T00:00:00Z' }
const failed: DesktopUpdateStatus = { status: 'failed', channel: 'stable', failure: 'network', checkedAt: '2026-10-21T00:00:00Z' }
const HOUR = 30 * 60 * 1000

function Probe({ api }: { api: DesktopSettingsApi | undefined }) {
  const rail = useDesktopUpdateRail(api)
  return createElement('div', { 'data-testid': 'rail-state', 'data-available': String(rail.available),
    'data-version': rail.latestVersion ?? '', 'data-busy': String(rail.busy) },
  createElement('button', { type: 'button', id: 'start', onClick: () => { void rail.start() } }))
}

async function mount(api?: DesktopSettingsApi): Promise<HTMLDivElement> {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root!.render(createElement(Probe, { api })) })
  return container
}

const state = (node: HTMLElement): HTMLElement => node.querySelector('[data-testid="rail-state"]')!
const startButton = (node: HTMLElement): HTMLButtonElement => node.querySelector<HTMLButtonElement>('#start')!
const flush = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(0) }) }

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  container = undefined
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('desktop update rail hook', () => {
  it('stays inert without an update api', async () => {
    await mount()
    expect(state(container!).dataset.available).toBe('false')
    await act(async () => { startButton(container!).click() })
    expect(state(container!).dataset.busy).toBe('false')
  })

  it('hides while up to date and exposes the version once an update is available', async () => {
    vi.useFakeTimers()
    const responses: DesktopUpdateStatus[] = [upToDate, availableAt('9.9.9')]
    const inspect = vi.fn(async (): Promise<DesktopUpdateStatus> => responses.shift() ?? availableAt('9.9.9'))
    await mount({ inspectUpdates: inspect } as unknown as DesktopSettingsApi)
    await flush()
    expect(state(container!).dataset.available).toBe('false')
    await act(async () => { await vi.advanceTimersByTimeAsync(HOUR) })
    expect(state(container!).dataset.available).toBe('true')
    expect(state(container!).dataset.version).toBe('9.9.9')
  })

  it('starts the interactive flow once, refreshes afterwards, and ignores re-entry while pending', async () => {
    let completeFlow: (() => void) | undefined
    let settle: ((value: DesktopUpdateStatus) => void) | undefined
    const check = vi.fn(() => new Promise<void>(resolve => { completeFlow = resolve }))
    const inspect = vi.fn(() => new Promise<DesktopUpdateStatus>(resolve => { settle = resolve }))
    await mount({ checkForUpdates: check, inspectUpdates: inspect } as unknown as DesktopSettingsApi)
    expect(inspect).toHaveBeenCalledTimes(1)
    await act(async () => { startButton(container!).click() })
    expect(check).toHaveBeenCalledTimes(1)
    expect(state(container!).dataset.busy).toBe('true')
    await act(async () => { startButton(container!).click() })
    expect(check).toHaveBeenCalledTimes(1)
    await act(async () => { completeFlow?.() })
    expect(inspect).toHaveBeenCalledTimes(2)
    await act(async () => { settle?.(availableAt('9.9.9')) })
    expect(state(container!).dataset.available).toBe('true')
    expect(state(container!).dataset.busy).toBe('false')
  })

  it('keeps the entry across a failed poll and clears it once up to date', async () => {
    vi.useFakeTimers()
    const responses: DesktopUpdateStatus[] = [availableAt('9.9.9'), failed, upToDate]
    const inspect = vi.fn(async (): Promise<DesktopUpdateStatus> => responses.shift() ?? upToDate)
    await mount({ inspectUpdates: inspect } as unknown as DesktopSettingsApi)
    await flush()
    expect(state(container!).dataset.available).toBe('true')
    await act(async () => { await vi.advanceTimersByTimeAsync(HOUR) })
    expect(state(container!).dataset.available).toBe('true')
    await act(async () => { await vi.advanceTimersByTimeAsync(HOUR) })
    expect(state(container!).dataset.available).toBe('false')
  })

  it('keeps the previous state when a poll rejects', async () => {
    vi.useFakeTimers()
    let count = 0
    const inspect = vi.fn(async (): Promise<DesktopUpdateStatus> => {
      count += 1
      if (count === 1) return availableAt('9.9.9')
      throw new Error('offline')
    })
    await mount({ inspectUpdates: inspect } as unknown as DesktopSettingsApi)
    await flush()
    expect(state(container!).dataset.available).toBe('true')
    await act(async () => { await vi.advanceTimersByTimeAsync(HOUR) })
    expect(state(container!).dataset.available).toBe('true')
    expect(state(container!).dataset.version).toBe('9.9.9')
  })

  it('stops polling after unmount', async () => {
    vi.useFakeTimers()
    const inspect = vi.fn(async (): Promise<DesktopUpdateStatus> => upToDate)
    await mount({ inspectUpdates: inspect } as unknown as DesktopSettingsApi)
    await flush()
    expect(inspect).toHaveBeenCalledTimes(1)
    await act(async () => { root!.unmount() })
    root = undefined
    await act(async () => { await vi.advanceTimersByTimeAsync(6 * HOUR) })
    expect(inspect).toHaveBeenCalledTimes(1)
  })
})
