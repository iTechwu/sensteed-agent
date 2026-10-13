import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { applyDofeAccess } from './register-dofe-access.ts'

/** Services required by the DoFe access surface. */
export const inject = [
  'slots',
  'locale',
  'remote',
  'remote.credentials',
  'remote.settings',
  'configForms',
]

/** Register the DoFe access gate and settings section. @param ctx - browser Cordis context. */
export function apply(ctx: ClientContext): void {
  // Loader-focused tests and compatibility probes may provide only the client
  // presentation services. The real client always supplies `remote` via the
  // injection contract, so defer the access surface until that service exists.
  if (ctx.remote !== undefined) applyDofeAccess(ctx)
}
