import type { IncomingMessage, ServerResponse } from 'node:http'
export { HUB_API_ORIGIN, HUB_UPDATES_PATH } from './hub-update-contract.ts'
export type { HubPublishedUpdate } from './hub-update-contract.ts'

interface HubSession { accessToken: string; tenantId: string; operator: string }
interface HubSessionProvider { getDatasourceSession(): HubSession | undefined }

type HubFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

function finish(res: ServerResponse, status: number, value: object): void {
  res.statusCode = status
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(value))
}

function permitted(req: IncomingMessage, expectedOrigin: string): boolean {
  const address = req.socket.remoteAddress ?? ''
  const loopback = address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
  return loopback
    && req.headers.origin === expectedOrigin
    && (req.headers['sec-fetch-site'] === undefined || req.headers['sec-fetch-site'] === 'same-origin')
}

/** Retired catalog projection: only the L0 signed generation check may claim updates.
 * Keep a tombstone for older callers; it must never sample credentials or query catalogs.
 */
export async function handleHubUpdatesRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  _auth: HubSessionProvider,
  _fetcher: HubFetch = globalThis.fetch,
): Promise<void> {
  if (req.method !== 'GET') return finish(res, 405, { error: 'method_not_allowed' })
  if (!permitted(req, expectedOrigin)) return finish(res, 403, { error: 'forbidden' })
  return finish(res, 410, { error: 'hub_signed_check_required' })
}
