/** docs/1022 §7 模板与 Profile 埋点：fire-and-forget，经 Host 意图通道中继到 Hub 白名单端点。
 * 渲染端不直连 Hub（L0 固定源纪律）；失败静默，不产生用户可见错误，也不重试。 */
export type HubTemplateEvent =
  | { event: 'PROFILE_TEMPLATE_VIEWED'; properties: { surface: 'list' } }
  | { event: 'PROFILE_TEMPLATE_SELECTED'; properties: { source: 'template' | 'custom' } }
  | { event: 'PROFILE_TEMPLATE_INSTANTIATED'; properties: { planCount: number; skippedCount: number; errorClass?: 'conflict' | 'validation' | 'forbidden' | 'error' } }
  | { event: 'PROFILE_TEMPLATE_BLOCKED_ITEM_SHOWN'; properties: { itemCount: number } }
  | { event: 'PROFILE_APPLY_FAILED'; properties: { phase: 'unload' | 'resolve' | 'install' | 'load'; errorClass: 'conflict' | 'validation' | 'forbidden' | 'error' } }
  | { event: 'PROFILE_SWITCHED'; properties: { itemCount: number } }

/** 失败静默：产品分析不产生用户可见错误，也不重试；经 Host 意图通道中继（渲染端不直连 Hub）。 */
export function trackHubTemplate(event: HubTemplateEvent): void {
  void fetch('/api/desktop/hub/generations/telemetry', {
    method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ events: [event] }),
  }).catch(() => {})
}
