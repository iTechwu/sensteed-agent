/** Private SSO endpoints are available in the base Host before Hub business packages load. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from './dofe-host-auth.ts'
import { DOFE_AUTH_PATHS, handleDofeAuthRequest } from './dofe-auth-route.ts'

export const name = 'dofe-auth-routes'
export const inject = ['webServer', 'connection', 'dofeAuth']
export function apply(ctx: Context): void {
  const rendererOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  for (const path of DOFE_AUTH_PATHS) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact', path,
      handler: (req, res) => {
        const rejection = ctx.connection.requestRejection(req)
        if (rejection !== undefined) {
          res.writeHead(rejection)
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        return handleDofeAuthRequest(path, req, res, rendererOrigin, ctx.dofeAuth)
      },
    }), 'Sealed Host private SSO route')
  }
}
