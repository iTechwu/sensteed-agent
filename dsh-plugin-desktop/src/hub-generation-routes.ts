/** The renderer sends intents; only the Host resolves identity, paths and grants. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from './hub-generation-manager.ts'

export const HUB_GENERATION_METHODS = ['check', 'templates', 'instantiate', 'preview', 'execute', 'status', 'restart'] as const
type Method = typeof HUB_GENERATION_METHODS[number]
export type HubGenerationIntentService = { [K in Method]: (input: unknown) => Promise<unknown> }
const MAX_BODY_BYTES = 64 * 1024

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(body))
}

export async function handleHubGenerationIntent(
  method: Method, req: IncomingMessage, res: ServerResponse,
  expectedOrigin: string, service: HubGenerationIntentService,
): Promise<void> {
  if (req.method !== 'POST') return json(res, 405, { error: 'HUB_METHOD_NOT_ALLOWED' })
  const address = req.socket.remoteAddress ?? ''
  if (!(address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.'))
    || req.headers.origin !== expectedOrigin
    || (req.headers['sec-fetch-site'] !== undefined && req.headers['sec-fetch-site'] !== 'same-origin')
    || req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return json(res, 403, { error: 'HUB_REQUEST_FORBIDDEN' })
  }
  const length = req.headers['content-length']
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) return json(res, 413, { error: 'HUB_REQUEST_TOO_LARGE' })
  let input: unknown
  try {
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of req) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
      bytes += data.length
      if (bytes > MAX_BODY_BYTES) return json(res, 413, { error: 'HUB_REQUEST_TOO_LARGE' })
      chunks.push(data)
    }
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid intent')
  } catch {
    return json(res, 400, { error: 'HUB_INVALID_INTENT' })
  }
  try {
    json(res, 200, await service[method](input))
  } catch (error) {
    // Never return credential-bearing transport errors, stack traces or filesystem paths.
    const message = error instanceof Error ? error.message : ''
    const code = /^HUB_[A-Z0-9_]{1,80}$/.test(message) ? message : 'HUB_INTENT_FAILED'
    json(res, code === 'HUB_INTENT_FAILED' ? 400 : 409, { error: code })
  }
}

export function registerHubGenerationRoutes(ctx: Context): void {
  ctx.inject(['hubGenerationManager', 'webServer', 'connection'], scope => {
    const origin = `http://127.0.0.1:${String(scope.webServer.port)}`
    for (const method of HUB_GENERATION_METHODS) {
      scope.effect(() => scope.webServer.register({
        kind: 'exact', path: `/api/desktop/hub/generations/${method}`,
        handler: (req, res) => {
          const rejection = scope.connection.requestRejection(req)
          if (rejection !== undefined) return json(res, rejection, { error: 'HUB_REQUEST_FORBIDDEN' })
          return handleHubGenerationIntent(method, req, res, origin, scope.hubGenerationManager as HubGenerationIntentService)
        },
      }), 'Desktop private Hub generation intent')
    }
  })
}
