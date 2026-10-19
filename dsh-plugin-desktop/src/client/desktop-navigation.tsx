import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-shortcuts/client'
/** Desktop owns this sidebar only when profile composition removes upstream's shell. */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarPanelMetadata } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { DesktopNavigationSidebar } from './DesktopNavigation.tsx'
import { installDesktopNavigationStyles } from './desktop-navigation-styles.ts'

/** Preserve all dynamic panel registrations and plugin-owned permission gates. */
export function applyDesktopNavigation(ctx: Context): void {
  // Custom profiles retaining upstream ownership keep their complete sidebar.
  if (ctx.slots.entries('sidebar').length > 0) return
  ctx.effect(installDesktopNavigationStyles, 'desktop: navigation styles')
  const panels = createSnapshotStore<readonly SidebarPanelMetadata[]>([])
  const refresh = (): void => {
    panels.set(ctx.slots.entriesOfSlot('sidebar.panellist').map(({ options }) => ({
      id: options.id as MainPanelId, label: resolveSlotLabel(options.label) ?? options.id ?? '', order: options.order ?? 0,
    })).sort((a, b) => a.order - b.order))
  }
  ctx.slots.inject('sidebar', () => ctx.slots.register({
    name: 'sidebar', registrant: 'desktop-navigation',
    children: {
      'sidebar.brand.mark': { kind: 'single', scope: 'root' },
      'sidebar.brand.name': { kind: 'single', scope: 'root' },
      'sidebar.toggle.badge': { kind: 'single', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
      'sidebar.workspaces': { kind: 'single', scope: 'root' },
      'sidebar.settings': { kind: 'single', scope: 'root' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
    },
    inject: () => ({
      startSession: () => { ctx.uiWorkspace.startSession() },
      toggleSidebar: () => { ctx.layout.toggleSidebar() },
      selectPanel: (id: MainPanelId | null) => { ctx.layout.selectPanel(id) },
      t: (key: string) => {
        const zh = ctx.locale.getSnapshot().active.startsWith('zh')
        return key === 'session.new' || key === 'session.new.label' ? (zh ? '新聊天' : 'New chat') : key
      },
      hooks: { panels, shortcuts: ctx.shortcuts.catalog },
    }),
  }, DesktopNavigationSidebar as never))
  ctx.effect(() => ctx.slots.subscribe('sidebar.panellist', refresh), 'desktop: module registrations')
  ctx.effect(() => ctx.locale.subscribe(refresh), 'desktop: module labels')
  refresh()
}
