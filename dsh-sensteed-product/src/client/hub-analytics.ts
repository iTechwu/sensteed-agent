/** docs/1022 §7 模板埋点：fire-and-forget，打到 Hub 白名单端点（无鉴权、闭集 schema）。 */
import { HUB_GENERATION_ORIGIN } from '../../../dsh-plugin-desktop/src/hub-generation-store.ts'

export type HubTemplateEvent =
  | { event: 'PROFILE_TEMPLATE_VIEWED'; properties: { surface: 'list' } }
  | { event: 'PROFILE_TEMPLATE_INSTANTIATED'; properties: { planCount: number; skippedCount: number; errorClass?: 'conflict' | 'validation' | 'forbidden' | 'error' } }

/** 失败静默：产品分析不产生用户可见错误，也不重试。 */
export function trackHubTemplate(event: HubTemplateEvent): void {
  void fetch(`${HUB_GENERATION_ORIGIN}/analytics/track`, {
    method: 'POST', credentials: 'omit', cache: 'no-store', keepalive: true,
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ events: [event] }),
  }).catch(() => {})
}
