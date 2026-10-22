/** docs/1022 §7 模板埋点：fire-and-forget，打到 Hub 白名单端点（无鉴权、闭集 schema）。 */
// 与宿主 HUB_GENERATION_ORIGIN（dsh-plugin-desktop/src/hub-generation-store.ts）同源；
// client bundle 禁止导入宿主模块（node:* 依赖会破坏渲染端闭包冒烟）。
const HUB_GENERATION_ORIGIN = 'https://ai.hozonauto.com/plugins/api'

export type HubTemplateEvent =
  | { event: 'PROFILE_TEMPLATE_VIEWED'; properties: { surface: 'list' } }
  | { event: 'PROFILE_TEMPLATE_SELECTED'; properties: { source: 'template' | 'custom' } }
  | { event: 'PROFILE_TEMPLATE_INSTANTIATED'; properties: { planCount: number; skippedCount: number; errorClass?: 'conflict' | 'validation' | 'forbidden' | 'error' } }
  | { event: 'PROFILE_TEMPLATE_BLOCKED_ITEM_SHOWN'; properties: { itemCount: number } }
  | { event: 'PROFILE_APPLY_FAILED'; properties: { phase: 'unload' | 'resolve' | 'install' | 'load'; errorClass: 'conflict' | 'validation' | 'forbidden' | 'error' } }

/** 失败静默：产品分析不产生用户可见错误，也不重试。 */
export function trackHubTemplate(event: HubTemplateEvent): void {
  void fetch(`${HUB_GENERATION_ORIGIN}/analytics/track`, {
    method: 'POST', credentials: 'omit', cache: 'no-store', keepalive: true,
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ events: [event] }),
  }).catch(() => {})
}
