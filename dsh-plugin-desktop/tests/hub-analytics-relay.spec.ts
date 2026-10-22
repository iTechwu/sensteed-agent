/** Host telemetry 中继：体量边界、闭集名下限与固定源（docs/1022 §7）。 */
import { describe, expect, it, vi } from 'vitest'
import { relayHubTelemetry } from '../src/hub-analytics-relay.ts'

describe('relayHubTelemetry', () => {
  it('forwards bounded closed-name events to the fixed Hub origin', async () => {
    const fetcher = vi.fn(async () => new Response('{"code":200}', { status: 200 }))
    const result = await relayHubTelemetry([
      { event: 'PROFILE_TEMPLATE_VIEWED', properties: { surface: 'list' } },
      { event: 'NOT_PROFILE_EVENT' },
      'junk',
      { event: 'PROFILE_SWITCHED', properties: { itemCount: 3 } },
    ], fetcher as unknown as typeof fetch)
    expect(result).toEqual({ delivered: true, relayed: 2 })
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://ai.hozonauto.com/plugins/api/analytics/track')
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error' })
    expect(JSON.parse(String(init.body)).events).toHaveLength(2)
  })
  it('drops oversized payloads and reports failure without throwing', async () => {
    const ok = vi.fn(async () => new Response('ok', { status: 200 }))
    expect(await relayHubTelemetry([{ event: 'PROFILE_X', properties: { blob: 'x'.repeat(4096) } }], ok as unknown as typeof fetch)).toEqual({ delivered: false, relayed: 0 })
    expect(ok).not.toHaveBeenCalled()
    const failing = vi.fn(async () => new Response('nope', { status: 502 }))
    expect(await relayHubTelemetry([{ event: 'PROFILE_X' }], failing as unknown as typeof fetch)).toEqual({ delivered: false, relayed: 0 })
    const throwing = vi.fn(async () => { throw new Error('offline') })
    expect(await relayHubTelemetry([{ event: 'PROFILE_X' }], throwing as unknown as typeof fetch)).toEqual({ delivered: false, relayed: 0 })
  })
})
