/** docs/1022 §7 切换器埋点：fire-and-forget，打到 Hub 白名单端点；失败静默不重试。 */
import { HUB_GENERATION_ORIGIN } from '../../../dsh-plugin-desktop/src/hub-generation-store.ts'

export type HubSwitchEvent =
  | { event: 'PROFILE_SWITCHED'; properties: { itemCount: number } }
  | { event: 'PROFILE_APPLY_FAILED'; properties: { phase: 'unload' | 'resolve' | 'install' | 'load'; errorClass: 'conflict' | 'validation' | 'forbidden' | 'error' } }

export function trackHubSwitch(event: HubSwitchEvent): void {
  void fetch(`${HUB_GENERATION_ORIGIN}/analytics/track`, {
    method: 'POST', credentials: 'omit', cache: 'no-store', keepalive: true,
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ events: [event] }),
  }).catch(() => {})
}
