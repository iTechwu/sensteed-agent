/** Compose Next capabilities into the official frontend. */
import { createElement, useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { installDesktopSettingsStyles } from '../../../dsh-plugin-desktop/src/client/desktop-settings-styles.ts'
import { installSidebarFooterStyles, setSidebarFooterBalanced, setSidebarFooterCompat } from '../../../dsh-plugin-desktop/src/client/sidebar-footer-styles.ts'
import { NextSettingsAdapter } from './settings-adapter.ts'
import { NextDesktopSettings, NextDesktopActions, NextVersionsSettingsPage } from './settings.tsx'
import { installWindowStyles } from './styles.ts'
import { registerPluginControls } from './plugin-controls.tsx'
import { installPluginControlsStyles } from './plugin-controls-styles.ts'
import { registerComputerUseCommandUi } from './computer-use-command-ui.tsx'
import { desktopDirectoryPicker, registerDesktopDirectoryPicker } from './directory-picker.ts'
import { SettingsRequests } from './settings-requests.tsx'
import type { DesktopSettingsLocaleKey } from '../../../dsh-plugin-desktop/src/client/desktop-settings-locales.ts'
import { installRendererRecovery } from './renderer-recovery.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Controls rendered above the official plugin cards. */
    'plugins.overview': { kind: 'list'; scope: 'root' }
    /** Bundle rows owned by the overview controls and hidden from the card list. */
    'plugins.bundle.hidden': { kind: 'keyed'; scope: 'root' }
  }
  interface LocaleNamespaceMap {
    'desktop.settings': DesktopSettingsLocaleKey | 'sidebarFooterCompat' | 'sidebarFooterCompatBody' | 'sidebarFooterBalanced' | 'sidebarFooterBalancedBody'
    'desktop-next': 'settings' | 'versions' | 'language' | 'safeMode' | 'safeModeDetail' | 'recovery' | 'dismiss'
  }
}

export const inject = ['slots', 'layout', 'locale']
let rendererBootFailed=false

export interface DesktopRemoteControlService {
  read(): Promise<{ enabled: boolean; available: boolean }>
  setEnabled(enabled: boolean): Promise<void>
  open(): Promise<void>
}

export function apply(ctx: Context): void {
  ctx.effect(installUiDiagnostics, 'AA and Plugins client lifecycle diagnostics')
  ctx.effect(() => ctx.locale.register('desktop-next', {
    zh: { settings: 'Agent 设置', versions: '版本管理', language: 'zh', safeMode: '安全模式', safeModeDetail: '当前使用临时环境。退出安全模式并重启后返回原 Profile，临时数据不会保留。', dismiss: '关闭提示', recovery: '打开恢复助手' },
    en: { settings: 'Agent settings', versions: 'Version management', language: 'en', safeMode: 'Safe mode', safeModeDetail: 'You are using a temporary environment. Exiting Safe Mode and restarting returns to the original Profile and removes the temporary data.', dismiss: 'Dismiss notice', recovery: 'Open recovery assistant' },
  }), 'Next settings and recovery labels')
  ctx.effect(() => installDesktopSettingsStyles('dsh-desktop-next'), 'Shared Desktop settings styles')
  ctx.effect(installPluginControlsStyles, 'Plugin controls and permission dialog styles')
  registerPluginControls(ctx)
  registerComputerUseCommandUi(ctx)
  // The Desktop window adds workspaces through the system folder dialog like upstream
  // Desktop, whatever directory flow the Host mounted; ordinary browsers have no bridge.
  const directoryPicker = desktopDirectoryPicker()
  if (directoryPicker) registerDesktopDirectoryPicker(ctx, directoryPicker)
  if (window.desktopNext) {
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay', id: 'desktop-next-renderer-health', order: 0,
      inject: () => ({ ctx }),
    }, RendererHealth))
    const permissions = window.desktopNext.permissions
    if (permissions) ctx.effect(() => {
      const dispose = ctx.reflect.provide('desktopPermissions', permissions)
      return () => { void dispose() }
    }, 'Native Desktop permissions')
    ctx.effect(installSidebarFooterStyles, 'Shared Desktop sidebar footer layout')
    const adapter = new NextSettingsAdapter(window.desktopNext)
    const remoteControl: DesktopRemoteControlService = {
      read: async () => {
        const state = await window.desktopNext!.state()
        return { enabled: state.features.remoteControl, available: !state.safeMode && state.phase === 'ready' }
      },
      setEnabled: async enabled => {
        const state = await window.desktopNext!.state()
        await window.desktopNext!.command({ type: 'features', features: { ...state.features, remoteControl: enabled } })
      },
      open: async () => {
        const trigger = document.querySelector<HTMLButtonElement>(
          '[data-slot="sidebar.footer.action"] button[aria-label="手机连接"][aria-haspopup="dialog"], ' +
          '[data-slot="sidebar.footer.action"] button[aria-label="Mobile connection"][aria-haspopup="dialog"], ' +
          '[data-slot="sidebar.footer.action"] button[aria-label="远程控制"][aria-haspopup="dialog"], ' +
          '[data-slot="sidebar.footer.action"] button[aria-label="Remote Control"][aria-haspopup="dialog"]',
        )
        if (!trigger) throw new Error('remote_control_unavailable')
        trigger.click()
      },
    }
    ctx.effect(() => {
      const dispose = ctx.reflect.provide('desktopRemoteControl', remoteControl)
      return () => { void dispose() }
    }, 'Desktop remote control settings service')
    ctx.effect(() => {
      const syncSidebarFooterCompat = (): void => {
        const value = adapter.desktopSettings.getSnapshot().value
        setSidebarFooterCompat(value?.sidebarFooterCompat !== false)
        setSidebarFooterBalanced(value?.sidebarFooterBalanced !== false)
      }
      syncSidebarFooterCompat()
      return adapter.desktopSettings.subscribe(syncSidebarFooterCompat)
    }, 'Sync Desktop sidebar footer compatibility setting')
    const t = ctx.locale.bind('desktop-next')
    // The shared settings shell maps the legacy section ID to our display icon.
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section', id: 'desktop', order: 100, locale: 'desktop-next', label: () => t('settings'),
      inject: () => ({ adapter, openPlugins: () => ctx.layout.selectPanel('plugins' as MainPanelId) }),
    }, DesktopSettings))
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section', id: 'versions', order: 110, locale: 'desktop-next', label: () => t('versions'),
      inject: () => ({ adapter }),
    }, NextVersionsSettings))
    ctx.slots.inject('settings.action', () => ctx.slots.register({
      name: 'settings.action', id: 'desktop-native-actions', order: 1, locale: 'desktop-next', inject: () => ({ adapter }),
    }, SettingsActions))
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay', id: 'desktop-next-settings-requests', order: 90, locale: 'desktop-next',
    }, SettingsRequests))
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay', id: 'desktop-next-safe-mode', order: 100, locale: 'desktop-next',
    }, SafeModeNotice))
  }
  ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'next-hub-health',order:110,locale:'desktop-next'},NextHubHealth))
  ctx.effect(installWindowStyles, 'Next native materials and header interactions')
}

/** The effect runs only after React mounts the assembled shell. */
function RendererHealth({ ctx }: { ctx: Context }) {
  useEffect(() => {
    const bridge = window.desktopNext?.renderer
    if (bridge) return installRendererRecovery(ctx, bridge)
  }, [ctx])
  return null
}

/** Temporary, metadata-only trace for the AA dialog and its sibling Plugins UI. */
function installUiDiagnostics(): () => void {
  const aaButton = '[data-slot="sidebar.footer.action"] button[aria-label="远程控制"], [data-slot="sidebar.footer.action"] button[aria-label="Remote Control"], [data-slot="sidebar.footer.action"] button[aria-label="Mobile connection"], [data-slot="sidebar.footer.action"] button[aria-label="手机连接"]'
  const read = () => {
    const button = document.querySelector(aaButton)
    return {
      button: button !== null,
      expanded: button?.getAttribute('aria-expanded') === 'true',
      dialog: [...document.querySelectorAll('[role="dialog"]')].some(element =>
        ['远程控制', 'Remote Control', '手机连接', 'Mobile connection', 'Agents Anywhere'].includes(element.getAttribute('aria-label') ?? '')),
      plugins: document.querySelector('[data-next-plugin-controls]') !== null,
    }
  }
  const fail = (error:unknown):void=>{rendererBootFailed=true;void window.desktopNext?.reportHubFailure?.(String(error).slice(0,4096)).catch(()=>{})}
  const onError = (event: ErrorEvent): void => { fail(event.message);console.error(`[next-ui-error] ${String(event.error?.stack ?? event.message).slice(0, 8192)}`) }
  const onRejection = (event: PromiseRejectionEvent): void => { fail(event.reason);console.error(`[next-ui-error] ${String(event.reason?.stack ?? event.reason).slice(0, 8192)}`) }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  let previous = read()
  let lastInput = 'none'
  const trace = (message: string): void => { console.warn(`[next-ui-diagnostic] ${message}`) }
  trace(`ready aa=${previous.button} dialog=${previous.dialog} plugins=${previous.plugins}`)
  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target
    if (target instanceof Element && (target.closest(aaButton) || previous.dialog)) {
      lastInput = target.closest(aaButton) ? 'aa-button' : target.closest('[role="dialog"]') ? 'dialog' : 'outside-dialog'
    }
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (previous.dialog && event.key === 'Escape') lastInput = 'Escape'
  }
  let queued = false
  const observer = new MutationObserver(() => {
    if (queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      const next = read()
      if (Object.keys(next).some(key => next[key as keyof typeof next] !== previous[key as keyof typeof next])) {
        trace(`state aa=${next.button} expanded=${next.expanded} dialog=${next.dialog} plugins=${next.plugins} lastInput=${lastInput}`)
        previous = next
        lastInput = 'none'
      }
    })
  })
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] })
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onKeyDown, true)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    observer.disconnect()
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('keydown', onKeyDown, true)
    trace('client plugin disposed')
  }
}

function SafeModeNotice({ t }: PropsLocale<'desktop-next'>) {
  const [safe, setSafe] = useState(false)
  useEffect(() => {
    let disposed = false
    void window.desktopNext?.state().then(state => { if (!disposed) setSafe(state.safeMode) }).catch(() => {})
    return () => { disposed = true }
  }, [])
  return safe ? createElement('aside', { className: 'dshNextSafeModeNotice', 'aria-label': t('safeMode') },
    createElement('button', { type: 'button', className: 'dshNextSafeModeDismiss', 'aria-label': t('dismiss'), onClick: () => setSafe(false) }, '×'),
    createElement('strong', null, t('safeMode')), createElement('p', null, t('safeModeDetail')),
    createElement('button', { type: 'button', onClick: () => { void window.desktopNext?.command({ type: 'controls', page: 'recovery' }).catch(() => {}) } }, t('recovery')),
  ) : null
}

function DesktopSettings({ t, adapter, close, openPlugins }: PropsLocale<'desktop-next'> & PropsRuntime<'settings.section'> & { adapter: NextSettingsAdapter; openPlugins(): void }) {
  return createElement(NextDesktopSettings, { adapter, language: t('language'), onOpenPlugins: () => { openPlugins(); close() } })
}

function SettingsActions({ t, adapter }: PropsLocale<'desktop-next'> & { adapter: NextSettingsAdapter }) {
  return createElement(NextDesktopActions, { adapter, language: t('language') })
}

function NextVersionsSettings({ t, adapter }: PropsLocale<'desktop-next'> & { adapter: NextSettingsAdapter }) {
  return createElement(NextVersionsSettingsPage, { adapter, language: t('language') })
}

/** Reports this mounted official document through its private preload nonce. */
function NextHubHealth(){useEffect(()=>{let second=0;const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{if(!rendererBootFailed)void window.desktopNext?.reportHubHealthy?.().catch(()=>{})})});return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second)}},[]);return null}
