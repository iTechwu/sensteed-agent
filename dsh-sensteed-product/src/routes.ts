/** Product private routes: SSO auth, the Yootun audit outbox, and DoFe access. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import {
  DOFE_ACCESS_MODELS_PATH,
  DOFE_ACCESS_VALIDATE_PATH,
  handleDofeAccessValidationRequest,
  handleDofeModelCatalogRequest,
} from './dofe-access-route.ts'
import { DOFE_AUTH_PATHS, handleDofeAuthRequest } from './dofe-auth-route.ts'
import { watchDofeAuthAudit } from './dofe-auth-audit.ts'
import { YootunAuditModelsClient } from './yootun-audit-models-client.ts'
import { handleYootunAuditRequest, YOOTUN_AUDIT_PATH } from './yootun-audit-route.ts'
import { YootunAuditService } from './yootun-audit-service.ts'
import { YootunAuditStore } from './yootun-audit-store.ts'

export const name = 'dofe-product-routes'
export const inject = ['webServer', 'connection', 'credentials', 'dofeAuth']

export const Config = z.object({
  /** Mirrors the shell's historical volatile switch; no writer ever flips it. */
  auditSyncEnabled: z.boolean().default(true).volatile(),
})

const MODELS_API_KEY_REF = credentialRef('MODELS_API_KEY')

/** Apply the official Connection trust and browser-auth fence before a private product route. */
function rejectDesktopRequest(
  ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const rejection = ctx.connection.requestRejection(req)
  if (rejection === undefined) return false
  res.writeHead(rejection)
  res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
  return true
}

export async function apply(ctx: Context, config: { auditSyncEnabled: boolean }): Promise<void> {
  const rendererOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  const dofeAuth = ctx.dofeAuth
  for (const path of DOFE_AUTH_PATHS) {
    ctx.effect(
      () => ctx.webServer.register({
        kind: 'exact',
        path,
        handler: (req, res) => {
          if (rejectDesktopRequest(ctx, req, res)) return
          return handleDofeAuthRequest(path, req, res, rendererOrigin, dofeAuth)
        },
      }),
      '@dofe/dsh-sensteed-product: private Sensteed auth route',
    )
  }
  const dshHomePath = ctx.get('dshHomePath')
  if (dshHomePath === undefined) {
    throw new Error('@dofe/dsh-sensteed-product: dshHomePath is required for the audit outbox')
  }
  const audit = new YootunAuditService({
    store: new YootunAuditStore(dshHomePath('storages', 'yootun-audit')),
    remote: new YootunAuditModelsClient(),
    resolveApiKey: async () => (await ctx.credentials.resolve(MODELS_API_KEY_REF))?.value,
    enabled: config.auditSyncEnabled,
    logger: ctx.logger,
  })
  ctx.provide('sensteedAudit', audit)
  ctx.effect(() => watchDofeAuthAudit(ctx.dofeAuth, audit), '@dofe/dsh-sensteed-product: SSO audit binding')
  ctx.effect(() => {
    void audit.start()
    return () => { audit.dispose() }
  }, '@dofe/dsh-sensteed-product: yootun audit service lifetime')
  ctx.on('credentials/reference-updated', (ref) => {
    if (ref === 'MODELS_API_KEY') void audit.credentialUpdated()
  })
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: YOOTUN_AUDIT_PATH,
      handler: (req, res) => {
        if (rejectDesktopRequest(ctx, req, res)) return
        return handleYootunAuditRequest(req, res, rendererOrigin, audit)
      },
    }),
    '@dofe/dsh-sensteed-product: private Yootun audit route',
  )
  const dofeAccessRoutes = [
    [DOFE_ACCESS_MODELS_PATH, handleDofeModelCatalogRequest],
    [DOFE_ACCESS_VALIDATE_PATH, handleDofeAccessValidationRequest],
  ] as const
  // Lets the catalog route honor { useStored: true } without the renderer ever seeing the key.
  const resolveStoredModelsKey = async (): Promise<string | undefined> =>
    (await ctx.credentials.resolve(MODELS_API_KEY_REF))?.value
  for (const [path, handler] of dofeAccessRoutes) {
    ctx.effect(
      () => ctx.webServer.register({
        kind: 'exact',
        path,
        handler: (req, res) => {
          if (rejectDesktopRequest(ctx, req, res)) return
          return handler(req, res, rendererOrigin, globalThis.fetch, resolveStoredModelsKey)
        },
      }),
      '@dofe/dsh-sensteed-product: private DoFe access route',
    )
  }
}
