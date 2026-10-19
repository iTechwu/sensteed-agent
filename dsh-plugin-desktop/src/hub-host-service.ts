/** L0 registration shared by embedded and utility-process Hosts. No L2 runtime imports. */
import type { Context } from '@deepseek-ai/cordis'
import { HubHostClient, type HubSsoSource } from './hub-host-client.ts'

declare module '@deepseek-ai/cordis' { interface Context { hubHostClient: HubHostClient } }
/** SSO retains refresh ownership; this service only samples Host-only bearer and watches identity changes. */
export function registerHubHostService(ctx: Context): void {
  ctx.inject(['dofeAuth'], scope => {
    const auth = scope.get('dofeAuth') as unknown as HubSsoSource
    if (typeof auth?.getDatasourceSession !== 'function' || typeof auth.watchBinding !== 'function') {
      throw new Error('Hub Host SSO capability unavailable')
    }
    const client = new HubHostClient(auth)
    scope.provide('hubHostClient', client)
    scope.effect(() => () => client.dispose(), 'Desktop L0 Hub session lifetime')
  })
}
