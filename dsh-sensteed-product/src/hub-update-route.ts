import type { IncomingMessage, ServerResponse } from 'node:http'
import { productPackageVersion } from './package-version.ts'
import { HUB_API_ORIGIN, HUB_UPDATES_PATH, type HubPublishedUpdate } from './hub-update-contract.ts'
export { HUB_API_ORIGIN, HUB_UPDATES_PATH }
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

function statusOf(error: unknown): number | undefined {
  return error instanceof HubRequestError ? error.status : undefined
}

class HubRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

function catalogItems(value: unknown): readonly Record<string, unknown>[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  const data = (value as { data?: unknown }).data
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return []
  const items = (data as { items?: unknown }).items
  return Array.isArray(items)
    ? items.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
    : []
}

async function readCatalog(
  path: 'plugins' | 'skills',
  session: HubSession,
  fetcher: HubFetch,
  signal: AbortSignal,
): Promise<HubPublishedUpdate[]> {
  const version = encodeURIComponent(productPackageVersion())
  const query = path === 'plugins'
    ? `?page=1&limit=100&sensteedVersion=${version}`
    : '?page=1&limit=100'
  const response = await fetcher(`${HUB_API_ORIGIN}/skillhub/v1/${path}${query}`, {
    method: 'GET',
    redirect: 'error',
    signal,
    headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json' },
  })
  if (response.status === 401 || response.status === 403) throw new HubRequestError(response.status, 'hub authorization rejected')
  if (!response.ok) throw new HubRequestError(503, 'hub unavailable')
  const payload = await response.json() as unknown
  return catalogItems(payload).flatMap(item => {
    const itemId = typeof item.pluginId === 'string' ? item.pluginId : typeof item.skillId === 'string' ? item.skillId : undefined
    const displayName = typeof item.displayName === 'string' ? item.displayName : undefined
    const version = typeof item.stableVersion === 'string' ? item.stableVersion : undefined
    if (item.status !== 'active' || itemId === undefined || displayName === undefined || version === undefined) return []
    return [{ kind: path === 'plugins' ? 'plugin' : 'skill', itemId, displayName, version }]
  })
}

export async function handleHubUpdatesRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  auth: HubSessionProvider,
  fetcher: HubFetch = globalThis.fetch,
): Promise<void> {
  if (req.method !== 'GET') return finish(res, 405, { error: 'method_not_allowed' })
  if (!permitted(req, expectedOrigin)) return finish(res, 403, { error: 'forbidden' })
  const session = auth.getDatasourceSession()
  if (session === undefined) return finish(res, 401, { error: 'hub_auth_required' })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const [plugins, skills] = await Promise.all([
      readCatalog('plugins', session, fetcher, controller.signal),
      readCatalog('skills', session, fetcher, controller.signal),
    ])
    finish(res, 200, { updates: [...plugins, ...skills] })
  } catch (error) {
    const status = statusOf(error)
    finish(res, status === 401 || status === 403 ? status : 503, { error: status === 401 || status === 403 ? 'hub_auth_required' : 'hub_unavailable' })
  } finally {
    clearTimeout(timeout)
  }
}
