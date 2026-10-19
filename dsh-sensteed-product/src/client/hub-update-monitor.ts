import { HUB_UPDATES_PATH, type HubPublishedUpdate } from '../hub-update-contract.ts'

export { HUB_API_ORIGIN } from '../hub-update-contract.ts'
export type { HubPublishedUpdate } from '../hub-update-contract.ts'

export const HUB_UPDATE_INTERVAL_MS = 15 * 60 * 1000
export const HUB_UPDATE_MAX_DELAY_MS = 60 * 60 * 1000

export function hubUpdateDelay(failures: number, random: () => number = Math.random): number {
  const base = HUB_UPDATE_INTERVAL_MS * 2 ** Math.min(Math.max(failures, 0), 2)
  return Math.min(HUB_UPDATE_MAX_DELAY_MS, Math.round(base * (0.8 + Math.max(0, Math.min(1, random())) * 0.4)))
}

function parseUpdates(value: unknown): HubPublishedUpdate[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  const updates = (value as { updates?: unknown }).updates
  if (!Array.isArray(updates)) return []
  return updates.filter((item): item is HubPublishedUpdate => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return false
    const row = item as Record<string, unknown>
    return (row.kind === 'plugin' || row.kind === 'skill')
      && typeof row.itemId === 'string' && typeof row.displayName === 'string' && typeof row.version === 'string'
  })
}

export async function hubUpdateRequest(signal?: AbortSignal): Promise<HubPublishedUpdate[]> {
  const requestSignal = signal === undefined ? AbortSignal.timeout(15_000) : AbortSignal.any([signal, AbortSignal.timeout(15_000)])
  const response = await fetch(HUB_UPDATES_PATH, {
    method: 'GET', credentials: 'same-origin', redirect: 'error', signal: requestSignal,
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw Object.assign(new Error(`Hub update request failed (${response.status})`), { status: response.status })
  return parseUpdates(await response.json())
}

export function createHubUpdateMonitor(
  request: (signal: AbortSignal) => Promise<HubPublishedUpdate[]>,
  publish: (updates: HubPublishedUpdate[] | undefined) => void,
  random: () => number = Math.random,
) {
  let failures = 0
  let account: string | undefined
  let epoch = 0
  let disposed = false
  let inflight = false
  let queued = false
  let controller: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const clearTimer = (): void => { if (timer !== undefined) clearTimeout(timer); timer = undefined }
  const check = async (): Promise<void> => {
    if (disposed || account === undefined) return
    if (inflight) { queued = true; return }
    clearTimer(); inflight = true; queued = false
    const currentEpoch = epoch
    const abort = new AbortController(); controller = abort
    try {
      const updates = await request(abort.signal)
      if (!disposed && currentEpoch === epoch && !abort.signal.aborted) { failures = 0; publish(updates) }
    } catch {
      if (!disposed && currentEpoch === epoch && !abort.signal.aborted) { failures += 1; publish(undefined) }
    } finally {
      inflight = false
      if (controller === abort) controller = undefined
      if (!disposed && account !== undefined) {
        if (queued) void check()
        else timer = setTimeout(() => void check(), hubUpdateDelay(failures, random))
      }
    }
  }
  return {
    account(value: string | undefined): void {
      if (account === value || disposed) return
      account = value; failures = 0; epoch += 1; queued = false; clearTimer(); controller?.abort(); publish(undefined)
      if (value !== undefined) void check()
    },
    reconnect(): void {
      if (disposed) return
      failures = 0; epoch += 1; clearTimer(); controller?.abort(); publish(undefined); void check()
    },
    dispose(): void { disposed = true; epoch += 1; clearTimer(); controller?.abort(); publish(undefined) },
  }
}
