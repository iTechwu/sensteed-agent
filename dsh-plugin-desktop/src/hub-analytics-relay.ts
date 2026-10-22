/** Host-side telemetry relay (docs/1022 §7). 渲染进程不直连 Hub；事件经 Host 意图通道中继到
 * 固定源白名单端点。Hub 侧逐事件闭集校验是唯一权威，这里只做体量与形状下限。 */
import { HUB_GENERATION_ORIGIN } from './hub-generation-store.ts'

const EVENT_NAME = /^PROFILE_[A-Z0-9_]{1,48}$/
const MAX_EVENTS = 64
const MAX_EVENT_BYTES = 2048

export interface HubTelemetryEvent { readonly event: string; readonly properties?: unknown }

function bounded(events: readonly unknown[]): HubTelemetryEvent[] {
  const out: HubTelemetryEvent[] = []
  for (const value of events) {
    if (!value || typeof value !== 'object') continue
    const candidate = value as { event?: unknown; properties?: unknown }
    if (typeof candidate.event !== 'string' || !EVENT_NAME.test(candidate.event)) continue
    if (JSON.stringify(candidate).length > MAX_EVENT_BYTES) continue
    out.push(candidate.properties === undefined ? { event: candidate.event } : { event: candidate.event, properties: candidate.properties })
    if (out.length >= MAX_EVENTS) break
  }
  return out
}

/** fire-and-forget：失败仅反映在返回值，不抛出、不重试。 */
export async function relayHubTelemetry(events: readonly unknown[], fetcher: typeof fetch = globalThis.fetch): Promise<{ delivered: boolean; relayed: number }> {
  const payload = bounded(events)
  if (!payload.length) return { delivered: false, relayed: 0 }
  try {
    const response = await fetcher(`${HUB_GENERATION_ORIGIN}/analytics/track`, {
      method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ events: payload }),
    })
    return { delivered: response.ok, relayed: response.ok ? payload.length : 0 }
  } catch {
    return { delivered: false, relayed: 0 }
  }
}
