/** docs/1022 §7 切换器埋点：fire-and-forget，打到 Hub 白名单端点；失败静默不重试。 */
// 与宿主 HUB_GENERATION_ORIGIN（dsh-plugin-desktop/src/hub-generation-store.ts）同源；
// client bundle 禁止导入宿主模块（node:* 依赖会破坏渲染端闭包冒烟）。
const HUB_GENERATION_ORIGIN = 'https://ai.hozonauto.com/plugins/api'

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
