import { afterEach, expect, it, vi } from 'vitest'
import {
  HUB_UPDATE_INTERVAL_MS,
  createHubUpdateMonitor,
  hubUpdateRequest,
  type HubPublishedUpdate,
} from '../src/client/hub-update-monitor.ts'

const update: HubPublishedUpdate = {
  kind: 'skill',
  itemId: 'skill-1',
  displayName: 'Skill One',
  version: '1.2.0',
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('publishes only the current account update and clears it on logout', async () => {
  vi.useFakeTimers()
  const pending: Array<{ signal: AbortSignal; resolve: (value: HubPublishedUpdate[]) => void }> = []
  const request = vi.fn((signal: AbortSignal) => new Promise<HubPublishedUpdate[]>(resolve => pending.push({ signal, resolve })))
  const publish = vi.fn()
  const monitor = createHubUpdateMonitor(request, publish, () => 0.5)

  monitor.account('alice')
  expect(request).toHaveBeenCalledOnce()
  monitor.account('bob')
  expect(pending[0]?.signal.aborted).toBe(true)
  pending[0]?.resolve([update])
  await vi.runOnlyPendingTimersAsync()
  expect(publish).not.toHaveBeenCalledWith([update])

  monitor.account(undefined)
  expect(publish).toHaveBeenLastCalledWith(undefined)
  monitor.dispose()
})

it('debounces settled checks, aborts on reconnect, and clears network/auth failures', async () => {
  vi.useFakeTimers()
  const request = vi.fn()
    .mockRejectedValueOnce(Object.assign(new Error('unauthorized'), { status: 401 }))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce([update])
  const publish = vi.fn()
  const monitor = createHubUpdateMonitor(request, publish, () => 0.5)

  monitor.account('alice')
  await Promise.resolve()
  await Promise.resolve()
  expect(publish).toHaveBeenLastCalledWith(undefined)
  expect(request).toHaveBeenCalledOnce()

  monitor.reconnect()
  await Promise.resolve()
  await Promise.resolve()
  expect(publish).toHaveBeenLastCalledWith(undefined)
  expect(request).toHaveBeenCalledTimes(2)

  await vi.advanceTimersByTimeAsync(HUB_UPDATE_INTERVAL_MS * 2)
  expect(publish).toHaveBeenLastCalledWith([update])
  monitor.dispose()
})

it('uses the private same-origin route without sending a Models key', async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('/api/desktop/hub/updates')
    expect(init?.credentials).toBe('same-origin')
    expect(init?.headers).toEqual({ Accept: 'application/json' })
    return Response.json({ updates: [update] })
  })
  vi.stubGlobal('fetch', fetcher)
  await expect(hubUpdateRequest()).resolves.toEqual([update])
  expect(JSON.stringify(fetcher.mock.calls[0])).not.toContain('MODELS_API_KEY')
})
