/** Desktop composition: persistent modules beside the existing context column. */
import { createContext, createElement, useContext, useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Home, PanelLeft, SquarePen, Database, Gauge, ShieldCheck, Clock, Blocks, Sparkles } from 'lucide-react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRenderSlots, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidebarRootComponentProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from './business-navigation-contract.ts'
import type { DesktopClientPlatform } from './environment.ts'
import { sidebarBrandMarkDataUrl } from './generated-brand-assets.ts'

const RailTarget = createContext<HTMLElement | null>(null)

/** The original frame continues to own its store, responsive solve and chrome. */
export function DesktopNavigationFrame({ Frame, frameProps, platform }: {
  Frame: ComponentType<Record<string, unknown>>
  frameProps: Record<string, unknown>
  platform: DesktopClientPlatform
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  return <RailTarget.Provider value={target}>
    <div className="sensteedNavigationFrame" data-navigation-platform={platform}>
      <aside ref={setTarget} className="sensteedModuleRail" aria-label="Modules" />
      <div className="sensteedNavigationContent">{createElement(Frame, frameProps)}</div>
    </div>
  </RailTarget.Provider>
}

function RailButton({ label, active, onClick, children, hint = true }: {
  label: string; active?: boolean; onClick: () => void; children: ReactNode; hint?: boolean
}) {
  return <PluginRailSeat hintEnabled={hint}>
    <button type="button" className="sensteedModuleButton" aria-label={label}
      aria-current={active ? 'page' : undefined} onClick={onClick}>{children}</button>
  </PluginRailSeat>
}

/** Retain plugin permission checks while portalling help outside the scroll rail. */
function PluginRailSeat({ children, beforeNavigate, hintEnabled = true, icon, active }: { icon?: ReactNode; active?: boolean; children: ReactNode; hintEnabled?: boolean; beforeNavigate?: ((action: () => void) => void) | undefined }) {
  const seat = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (active === undefined) return
    const button = seat.current?.querySelector('button')
    if (active) button?.setAttribute('aria-current', 'page')
    else button?.removeAttribute('aria-current')
  }, [active])
  const replaying = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [hint, setHint] = useState<{ label: string; top: number; left: number }>()
  const hide = () => { clearTimeout(timer.current); setHint(undefined) }
  useEffect(() => {
    const dismiss = () => { clearTimeout(timer.current); setHint(undefined) }
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => { clearTimeout(timer.current); window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss) }
  }, [])
  const show = (target: EventTarget | null) => {
    if (!hintEnabled || !(target instanceof Element)) return
    const button = target.closest('button')
    const label = button?.getAttribute('aria-label')
    if (!button || !label) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { const box = button.getBoundingClientRect(); setHint({ label, top: box.top + box.height / 2, left: box.right + 8 }) }, 250)
  }
  return <div ref={seat} className="sensteedPluginRailSeat" data-module-icon={icon ? true : undefined} data-active={active || undefined} onClickCapture={event => {
    const button = event.target instanceof Element ? event.target.closest('button') : null
    if (!beforeNavigate || replaying.current || !(button instanceof HTMLButtonElement)) return
    event.preventDefault(); event.stopPropagation()
    beforeNavigate(() => { if (!button.isConnected || button.disabled) return; replaying.current = true; try { button.click() } finally { replaying.current = false } })
  }} onPointerOver={event => show(event.target)} onPointerLeave={hide}
    onFocus={event => show(event.target)} onBlur={hide} onPointerDown={hide} onKeyDown={hide}>
    {children}
    {icon && <span className="sensteedRailGlyph" aria-hidden="true">{icon}</span>}
    {hint && createPortal(<div role="tooltip" className="sensteedRailTooltip" style={{ top: Math.max(16, Math.min(window.innerHeight - 24, hint.top)), left: hint.left }}>{hint.label}</div>, document.body)}
  </div>
}

/** Keep the session browser mounted while a module owns the main panel. */
export function DesktopNavigationSidebar({ collapsed, startSession, toggleSidebar, selectPanel,
  usePanels, usePanelInfo, useExtensions, renderSlot, t }: Omit<SidebarRootComponentProps, 'selectPanel' | 'renderSlot'> & PropsRenderSlots<'sidebar.brand.mark' | 'sidebar.brand.name' | 'sidebar.toggle.badge' | 'sidebar.panellist' | 'sidebar.workspaces' | 'sidebar.settings' | 'sidebar.footer.action' | 'desktop.navigation.context'> & { selectPanel: (id: MainPanelId | null) => void; useExtensions: SnapshotSelectorHook<readonly string[]> }) {
  const target = useContext(RailTarget)
  const [preview, setPreview] = useState<string | null>(null)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const openPreview = (id?: string) => { clearTimeout(previewTimer.current); if (collapsed && id) setPreview(id) }
  const closePreview = () => { clearTimeout(previewTimer.current); previewTimer.current = setTimeout(() => setPreview(null), 180) }
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreview(null) }
    window.addEventListener('keydown', dismiss)
    return () => { clearTimeout(previewTimer.current); window.removeEventListener('keydown', dismiss) }
  }, [])
  useEffect(() => { setPreview(null) }, [collapsed])
  const leaveGuard = useRef<((action: () => void) => void) | undefined>(undefined)
  const registerLeaveGuard = useCallback((guard: (action: () => void) => void) => {
    leaveGuard.current = guard
    return () => { if (leaveGuard.current === guard) leaveGuard.current = undefined }
  }, [])
  const navigate = (id: MainPanelId | null) => { const action = () => selectPanel(id); if (leaveGuard.current) leaveGuard.current(action); else action() }
  const onAccessDenied = useCallback(() => selectPanel(null), [selectPanel])
  const panels = usePanels(rows => rows)
  const extensions = useExtensions(ids => ids)
  const active = usePanelInfo(info => info.activePanelId)
  const home = active === null || active === 'conversation'
  const zh = t('session.new') === '新会话' || t('session.new').includes('新')
  const homeLabel = zh ? '主页' : 'Home'
  const businessLabels: Record<string, string> = {
    'sensteed-knowledge': zh ? '知识与记忆' : 'Knowledge & memory',
    'sensteed-finance': zh ? '财务管理' : 'Finance',
    'supplier-risk': zh ? '供应链管理' : 'Supply chain',
  }
  const contextLabel = home ? homeLabel : panels.find(p => p.id === active)?.label ?? businessLabels[active ?? ''] ?? (zh ? '业务工作区' : 'Business workspace')
  const previewHome = preview === 'home'
  const shownLabel = preview ? previewHome ? homeLabel : panels.find(p => p.id === preview)?.label ?? businessLabels[preview] ?? contextLabel : contextLabel
  const contextTarget = home ? (zh ? '项目与聊天' : 'projects and chats') : `${contextLabel}${zh ? '导航' : ' navigation'}`
  const toggleLabel = collapsed ? (zh ? `展开${contextTarget}` : `Expand ${contextTarget}`) : (zh ? `收起${contextTarget}` : `Collapse ${contextTarget}`)
  const extensionActive = (id: string) => id === active || id === 'dofe-sensteed-finance' && active === 'sensteed-finance'
  const ordered = [...panels].sort((a, b) => {
    const rank = (id: string) => id === 'schedules' ? 0 : id === 'plugins' ? 1 : id === 'sensteed-skill-manager' ? 2 : 3
    return rank(a.id) - rank(b.id) || a.order - b.order
  })
  const rail = <>
    <div className="sensteedModuleBrand"><span aria-hidden="true" style={{ maskImage: `url(${sidebarBrandMarkDataUrl})`, WebkitMaskImage: `url(${sidebarBrandMarkDataUrl})` }} /></div>
    <div className="sensteedModuleScroll">
      <nav aria-label={zh ? '功能模块' : 'Modules'}>
        <div onPointerEnter={() => openPreview('home')} onPointerLeave={closePreview} onFocus={() => openPreview('home')}>
          <RailButton label={homeLabel} hint={!collapsed} active={home} onClick={() => navigate(null)}><Home size={20} /></RailButton>
        </div>
        {extensions.includes('dofe-sensteed-knowledge') && <div className="sensteedKnowledgeModule" onPointerEnter={() => openPreview('sensteed-knowledge')} onPointerLeave={closePreview} onFocus={() => openPreview('sensteed-knowledge')} data-active={active === 'sensteed-knowledge' || undefined}>
          <PluginRailSeat icon={<Database size={20} />} active={active === 'sensteed-knowledge'} hintEnabled={!collapsed} beforeNavigate={action => { if (leaveGuard.current) leaveGuard.current(action); else action() }}>{renderSlot('sidebar.footer.action', { wide: false }, { only: 'dofe-sensteed-knowledge' })}</PluginRailSeat>
        </div>}
        {ordered.map(({ id, label }) => <div key={id} onPointerEnter={() => openPreview(id)} onPointerLeave={closePreview} onFocus={() => openPreview(id)}><RailButton label={label} hint={!collapsed} active={active === id} onClick={() => navigate(id)}>
          {id === 'schedules' ? <Clock size={20} /> : id === 'plugins' ? <Blocks size={20} /> : id === 'sensteed-skill-manager' ? <Sparkles size={20} /> : renderSlot('sidebar.panellist', { size: 20, active: active === id }, { only: id })}
        </RailButton></div>)}
      </nav>
      <div className="sensteedModuleExtensions" aria-label={zh ? '业务与扩展' : 'Business and extensions'}>
        {extensions.filter(id => id !== 'dofe-sensteed-knowledge').map(id => <div key={id} className="sensteedExtensionModule" onPointerEnter={() => openPreview(id === 'dofe-sensteed-finance' ? 'sensteed-finance' : id === 'dofe-supplier-risk' ? 'supplier-risk' : id)} onPointerLeave={closePreview} onFocus={() => openPreview(id === 'dofe-sensteed-finance' ? 'sensteed-finance' : id === 'dofe-supplier-risk' ? 'supplier-risk' : id)} data-active={extensionActive(id) || undefined}>
          <PluginRailSeat icon={id === 'dofe-sensteed-finance' ? <Gauge size={20} /> : id === 'supplier-risk' ? <ShieldCheck size={20} /> : undefined} active={extensionActive(id)} hintEnabled={!collapsed} beforeNavigate={action => { if (leaveGuard.current) leaveGuard.current(action); else action() }}>{renderSlot('sidebar.footer.action', { wide: false }, { only: id })}</PluginRailSeat>
        </div>)}
      </div>
    </div>
    <div className="sensteedModuleFoot">
      <RailButton label={toggleLabel} onClick={toggleSidebar}><PanelLeft size={19} /></RailButton>
      <PluginRailSeat>{renderSlot('sidebar.settings', { wide: false })}</PluginRailSeat>
    </div>
  </>
  return <>
    {target !== null && createPortal(rail, target)}
    <section className="sensteedContextSidebar" data-preview={collapsed && !!preview || undefined} onPointerEnter={() => { clearTimeout(previewTimer.current) }} onPointerLeave={closePreview} onFocus={() => { clearTimeout(previewTimer.current) }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closePreview() }} aria-label={shownLabel} hidden={collapsed && !preview}>
      <header className="sensteedContextHeader"><strong>{shownLabel}</strong>
        <RailButton label={toggleLabel} onClick={toggleSidebar}><PanelLeft size={18} /></RailButton>
      </header>
      <div data-context="home" className="sensteedContextHome" hidden={preview ? !previewHome : !home || collapsed}>
        <Tooltip label={t('session.new.label')} delayMs={250} portal>
          <button type="button" className="sensteedContextNew" onClick={() => startSession()}>
            <SquarePen size={17} /><span>{t('session.new')}</span>
          </button>
        </Tooltip>
        {renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => { if (collapsed) toggleSidebar() } })}
      </div>
      {!home && <div hidden={!!preview && preview !== active} style={{ display: preview && preview !== active ? 'none' : 'contents' }}>{renderSlot('desktop.navigation.context', { onAccessDenied, registerLeaveGuard }, { entryKey: active, fallback: <div className="sensteedModuleContext">
        <p>{zh ? '当前模块的业务导航与操作在右侧工作区中。' : 'Module navigation and actions are available in the workspace.'}</p>
        <button type="button" onClick={() => selectPanel(null)}>{zh ? '返回项目与聊天' : 'Back to projects and chats'}</button>
      </div> })}</div>}
      {preview && !previewHome && preview !== active && <div style={{ display: 'contents' }}>{renderSlot('desktop.navigation.context', { onAccessDenied: () => {}, registerLeaveGuard: () => () => {} }, { entryKey: preview, fallback: <div className="sensteedModuleContext"><p>{zh ? '打开模块查看业务导航。' : 'Open this module to view its navigation.'}</p><button type="button" onClick={() => navigate(preview as MainPanelId)}>{zh ? `打开${shownLabel}` : `Open ${shownLabel}`}</button></div> })}</div>}

    </section>
  </>
}
