/** Keep upstream HTTP routing while requiring Host credentials for Market routes. */
import { hostLog, hostOperation } from './host/logging.ts'
import WebServer, { type WebResourceRoute, type WebRoute, type WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import { decideDesktopBrowserAccess, nextBrowserAccess, DESKTOP_RENDERER_ACCESS_HEADER } from './desktop-browser-access.ts'
import type { Duplex } from 'node:stream'

export default class NextWebServer extends WebServer {
  static override Config = WebServer.Config
  private readonly browserSockets = new Set<Duplex>()

  /** Revoke existing browser streams as well as new requests; native streams stay alive. */
  setBrowserAccess(enabled: boolean): void {
    const access = nextBrowserAccess()
    if (!access) throw new Error('Native browser-access policy is unavailable')
    access.setOrdinaryBrowserEnabled(enabled)
    if (!enabled) {
      for (const socket of this.browserSockets) socket.destroy()
      this.browserSockets.clear()
    }
  }

  private permits(request: Parameters<WebRoute['handler']>[0]): boolean {
    const access = nextBrowserAccess()
    return !access || decideDesktopBrowserAccess(access, request) !== 'denied'
  }

  /** 资源形态(fetch 签名)的浏览器访问门,与 permits 的 req/res 判定同契约。 */
  private permitsResource(request: Request): boolean {
    const access = nextBrowserAccess()
    if (!access) return true
    // fetch Headers 是访问器对象,转成判定函数期望的普通头形态。
    const headers = { [DESKTOP_RENDERER_ACCESS_HEADER]: request.headers.get(DESKTOP_RENDERER_ACCESS_HEADER) ?? undefined }
    return decideDesktopBrowserAccess(access, { headers, url: request.url }) !== 'denied'
  }

  private denyResource(): Response {
    return new Response('Browser access is disabled', { status: 403, headers: { 'cache-control': 'no-store' } })
  }

  override register(route: WebRoute | WebResourceRoute): () => void {
    // rc.3 的资源路由不带 handler;无条件展开会让分发器拿到 undefined(400)。
    if (!('handler' in route) || typeof route.handler !== 'function') {
      const resource = (route as WebResourceRoute).resource
      return super.register({ ...(route as WebResourceRoute), resource: async (request, peer) => {
        if (!this.permitsResource(request)) return this.denyResource()
        return resource(request, peer)
      } })
    }
    return super.register({ ...route, handler: this.observeHttp(route.path, async (request, response) => {
      if (!this.permits(request)) { response.writeHead(403, { 'cache-control': 'no-store' }); response.end('Browser access is disabled'); return }
      if (route.path !== '/api/community-market' && !route.path.startsWith('/api/community-market/')) {
        await route.handler(request, response); return
      }
      const connection = this.ctx.get('connection')
      const rejection = connection === undefined ? 503 : connection.requestRejection(request)
      if (rejection !== undefined) {
        response.writeHead(rejection, { 'cache-control': 'no-store' })
        response.end('Market request authentication required')
        return
      }
      await (route.handler as WebRoute['handler'])(request, response)
    }) })
  }

  private observeHttp(route: string, handler: WebRoute['handler']): WebRoute['handler'] {
    return async (request, response) => {
      const end = hostOperation('host.http', 'request', { route, method: request.method ?? '' }, true)
      const finish = () => { end(undefined, { status: response.statusCode, aborted: !response.writableFinished }); response.off('finish', finish); response.off('close', finish) }
      response.once('finish', finish); response.once('close', finish)
      try { await handler(request, response) } catch (error) { response.off('finish', finish); response.off('close', finish); end(error); throw error }
    }
  }

  override registerFallback(fallback: WebRoute['handler'] | Pick<WebResourceRoute, 'resource'>): () => void {
    if (typeof fallback === 'function') {
      return super.registerFallback(this.observeHttp('fallback', async (request, response) => {
        if (!this.permits(request)) { response.writeHead(403, { 'cache-control': 'no-store' }); response.end('Browser access is disabled'); return }
        await fallback(request, response)
      }))
    }
    // rc.3 资源形态的 SPA fallback:同样过浏览器访问门。
    const resource = fallback.resource
    return super.registerFallback({ resource: async (request, peer) => {
      if (!this.permitsResource(request)) return this.denyResource()
      return resource(request, peer)
    } })
  }

  override registerUpgrade(route: WebUpgradeRoute): () => void {
    return super.registerUpgrade({ ...route, handler: (request, socket, head) => {
      hostLog({ source: 'host.http', event: 'upgrade', fields: { route: route.path }, developer: true })
      if (!this.permits(request)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return }
      const access = nextBrowserAccess()
      if (access && decideDesktopBrowserAccess(access, request) === 'browser') {
        this.browserSockets.add(socket)
        socket.once('close', () => this.browserSockets.delete(socket))
      }
      return route.handler(request, socket, head)
    } })
  }
}
