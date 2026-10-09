/** Same-origin Host route for validating model_api_key without browser CORS. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { DEFAULT_DOFE_PROTOCOL, dofeModelCatalogUrl, parseDofeModelCatalog, type DofeProtocol } from './dofe-models.ts'
import { BRAND_TENANT, BRAND_TENANT_ID } from './generated-product-identity.ts'

export const DOFE_ACCESS_VALIDATE_PATH = '/api/desktop/dofe/validate'
export const DOFE_ACCESS_MODELS_PATH = '/api/desktop/dofe/models'
export const DOFE_AUTH_CONTEXT_URL = 'https://ai.hozonauto.com/api/internal/auth/context'
const MAX_BODY_BYTES = 16 * 1024
const MODEL_GATEWAY_HEADERS = Object.freeze({ 'X-Company-Code': BRAND_TENANT })

export type DofeAccessFailureReason = 'invalid_key' | 'tenant_mismatch' | 'tenant_unavailable' | 'models_unavailable'

type AccessLogger = { error(message: string): void }

/** Log only a bounded transport code, never request headers, keys or response bodies. */
function reportAccessFailure(logger: AccessLogger | undefined, stage: 'tenant' | 'models', failure: unknown): void {
  let code = typeof failure === 'number' ? `HTTP ${failure}` : 'unavailable'
  const seen = new Set<unknown>()
  while (failure instanceof Error && !seen.has(failure)) {
    seen.add(failure)
    const candidate = (failure as NodeJS.ErrnoException).code
    if (typeof candidate === 'string' && /^(?:E[A-Z_]+|UND_ERR_[A-Z_]+)$/u.test(candidate)) code = candidate
    else if (failure.name === 'TimeoutError') code = 'timeout'
    else if (/net::ERR_[A-Z_]+/u.test(failure.message)) code = failure.message.match(/net::ERR_[A-Z_]+/u)![0]
    failure = failure.cause
  }
  logger?.error(`dofe-access: ${stage} request failed (${code})`)
}

function rejectedKey(status: number): boolean { return status === 401 || status === 403 }

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
    && req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

async function readRequest(req: IncomingMessage): Promise<{ key: string; protocol: DofeProtocol; useStored: boolean } | undefined> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += bytes.byteLength
    if (size > MAX_BODY_BYTES) return undefined
    chunks.push(bytes)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const record = value as { key?: unknown; protocol?: unknown; useStored?: unknown }
    if (Object.keys(record).some(key => key !== 'key' && key !== 'protocol' && key !== 'useStored')) return undefined
    if (typeof record.key !== 'string') return undefined
    if (record.useStored !== undefined && typeof record.useStored !== 'boolean') return undefined
    const protocol = record.protocol === undefined ? DEFAULT_DOFE_PROTOCOL : record.protocol
    if (protocol !== 'chat-completions' && protocol !== 'messages' && protocol !== 'responses') return undefined
    const key = record.key.trim()
    if (key.length > 4096) return undefined
    // An empty key is only acceptable when the host resolves the stored credential.
    const useStored = record.useStored === true
    return key.length > 0 || useStored ? { key, protocol, useStored } : undefined
  } catch {
    return undefined
  }
}

async function verifyDofeTenant(
  key: string,
  fetcher: typeof fetch,
  logger?: AccessLogger,
): Promise<{ ok: true } | { ok: false; reason: DofeAccessFailureReason }> {
  try {
    const response = await fetcher(DOFE_AUTH_CONTEXT_URL, {
      headers: { ...MODEL_GATEWAY_HEADERS, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      reportAccessFailure(logger, 'tenant', response.status)
      return { ok: false, reason: rejectedKey(response.status) ? 'invalid_key' : 'tenant_unavailable' }
    }
    const value = await response.json() as unknown
    const record = typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined
    const data = record?.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? record.data as Record<string, unknown>
      : undefined
    const candidates = [record, data, record?.tenant, data?.tenant]
      .filter((candidate): candidate is Record<string, unknown> => candidate != null && typeof candidate === 'object' && !Array.isArray(candidate))
    const tenantSlug = candidates
      .flatMap(candidate => [candidate.tenantSlug, candidate.tenant_slug, candidate.slug])
      .find(candidate => typeof candidate === 'string' && candidate.trim().length > 0)
    const tenantId = candidates
      .flatMap(candidate => [candidate.tenantId, candidate.tenant_id, candidate.id])
      .find(candidate => typeof candidate === 'string' && candidate.trim().length > 0)
    if (typeof tenantId === 'string' && tenantId.trim().length > 0) {
      return tenantId.trim().toLowerCase() === BRAND_TENANT_ID.toLowerCase()
        ? { ok: true }
        : { ok: false, reason: 'tenant_mismatch' }
    }
    if (typeof tenantSlug !== 'string' || tenantSlug.trim().length === 0) return { ok: false, reason: 'tenant_unavailable' }
    return tenantSlug.trim().toLowerCase() === BRAND_TENANT.toLowerCase()
      ? { ok: true }
      : { ok: false, reason: 'tenant_mismatch' }
  } catch (error) {
    reportAccessFailure(logger, 'tenant', error)
    return { ok: false, reason: 'tenant_unavailable' }
  }
}

export async function handleDofeAccessValidationRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  fetcher: typeof fetch = globalThis.fetch,
  // Declared for mount-loop symmetry with the catalog handler; stored-credential
  // validation is intentionally unsupported so authorization always sees the key.
  _resolveStoredKey?: () => Promise<string | undefined>,
  logger?: AccessLogger,
): Promise<void> {
  if (req.method !== 'POST') return finish(res, 405, { valid: false })
  if (!permitted(req, expectedOrigin)) return finish(res, 403, { valid: false })
  const request = await readRequest(req)
  if (request === undefined) return finish(res, 400, { valid: false })
  if (request.useStored) return finish(res, 400, { valid: false })
  const { key, protocol } = request
  try {
    const tenant = await verifyDofeTenant(key, fetcher, logger)
    if (!tenant.ok) return finish(res, 200, { valid: false, reason: tenant.reason })
    const response = await fetcher(dofeModelCatalogUrl(protocol), {
      headers: { ...MODEL_GATEWAY_HEADERS, Authorization: `Bearer ${key}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) reportAccessFailure(logger, 'models', response.status)
    finish(res, 200, response.ok ? { valid: true } : { valid: false, reason: rejectedKey(response.status) ? 'invalid_key' : 'models_unavailable' })
  } catch (error) {
    reportAccessFailure(logger, 'models', error)
    finish(res, 200, { valid: false, reason: 'models_unavailable' })
  }
}

/** Same-origin model catalog route; accepts the stored host credential when the renderer never saw the key. */
export async function handleDofeModelCatalogRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  fetcher: typeof fetch = globalThis.fetch,
  resolveStoredKey?: () => Promise<string | undefined>,
  logger?: AccessLogger,
): Promise<void> {
  if (req.method !== 'POST') return finish(res, 405, { models: [] })
  if (!permitted(req, expectedOrigin)) return finish(res, 403, { models: [] })
  const request = await readRequest(req)
  if (request === undefined) return finish(res, 400, { models: [] })
  const { key, protocol, useStored } = request
  try {
    let effectiveKey = key
    if (effectiveKey.length === 0) {
      if (!useStored || resolveStoredKey === undefined) return finish(res, 200, { models: [], reason: 'invalid_key' })
      try { effectiveKey = (await resolveStoredKey()) ?? '' }
      catch { return finish(res, 200, { models: [], reason: 'invalid_key' }) }
      if (effectiveKey.length === 0) return finish(res, 200, { models: [], reason: 'invalid_key' })
    }
    const tenant = await verifyDofeTenant(effectiveKey, fetcher, logger)
    if (!tenant.ok) return finish(res, 200, { models: [], reason: tenant.reason })
    const response = await fetcher(dofeModelCatalogUrl(protocol), {
      headers: { ...MODEL_GATEWAY_HEADERS, Authorization: `Bearer ${effectiveKey}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      reportAccessFailure(logger, 'models', response.status)
      return finish(res, 200, { models: [], reason: rejectedKey(response.status) ? 'invalid_key' : 'models_unavailable' })
    }
    finish(res, 200, { models: parseDofeModelCatalog(await response.json(), protocol) })
  } catch (error) {
    reportAccessFailure(logger, 'models', error)
    finish(res, 200, { models: [], reason: 'models_unavailable' })
  }
}
