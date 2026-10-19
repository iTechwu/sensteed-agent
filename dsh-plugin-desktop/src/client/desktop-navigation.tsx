import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-shortcuts/client'
/** Desktop owns this sidebar only when profile composition removes upstream's shell. */
import type {} from './business-navigation-contract.ts'
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
  const extensions = createSnapshotStore<readonly string[]>([])
  const refresh = (): void => {
    extensions.set(ctx.slots.entriesOfSlot('sidebar.footer.action').flatMap(entry => entry.options.id ? [entry.options.id] : []))
    panels.set(ctx.slots.entriesOfSlot('sidebar.panellist').map(({ options }) => ({
      id: options.id as MainPanelId, label: resolveSlotLabel(options.label) ?? options.id ?? '', order: options.order ?? 0,
    })).sort((a, b) => a.order - b.order))
  }
  ctx.slots.inject('sidebar', () => ctx.slots.register({
    name: 'sidebar', registrant: 'desktop-navigation',
    children: {
      'desktop.navigation.context': { kind: 'keyed', scope: 'root' },
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
      hooks: { panels, extensions, shortcuts: ctx.shortcuts.catalog },
    }),
  }, DesktopNavigationSidebar as never))
  ctx.effect(() => ctx.slots.subscribe('sidebar.panellist', refresh), 'desktop: module registrations')
  ctx.effect(() => ctx.slots.subscribe('sidebar.footer.action', refresh), 'desktop: extension registrations')
  ctx.effect(() => ctx.slots.subscribe('main', () => {
    const id = ctx.layout.panelInfo.getSnapshot().activePanelId
    if (id !== null && !ctx.slots.entries('main').some(entry => entry.options.key === id)) ctx.layout.selectPanel(null)
  }), 'desktop: unloaded module fallback')
  ctx.effect(() => ctx.locale.subscribe(refresh), 'desktop: module labels')
  ctx.effect(() => {
    let source: import('@deepseek-ai/dsh-client-ui-slots').StoredEntry | undefined
    let remove: (() => void) | undefined
    let updating = false
    const sync = (): void => {
      if (updating) return
      const entry = ctx.slots.entries('sidebar.footer.action').find(row => row.options.id === 'dofe-sensteed-knowledge' && row.registrant !== 'desktop-knowledge-label')
      if (entry === source) return
      updating = true
      try {
        remove?.(); remove = undefined; source = entry
        if (!entry) return
        remove = ctx.slots.register({ name: 'sidebar.footer.action', id: 'dofe-sensteed-knowledge', priority: -100,
          registrant: 'desktop-knowledge-label', order: entry.options.order ?? 45,
          inject: () => {
            const props = entry.inject?.() ?? {}
            const original = props.t
            return { ...props, t: (key: string) => key === 'open'
              ? (ctx.locale.getSnapshot().active.startsWith('zh') ? '知识与记忆' : 'Knowledge & memory')
              : typeof original === 'function' ? original(key) : key }
          },
        }, entry.component as never)
      } finally { updating = false }
    }
    const off = ctx.slots.subscribe('sidebar.footer.action', sync)
    sync()
    return () => { off(); remove?.() }
  }, 'desktop: knowledge navigation label')
  refresh()
}
