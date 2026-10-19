/** Desktop composition: persistent modules beside the existing context column. */
import { createContext, createElement, useContext, useState, type ComponentType, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Home, PanelLeft, SquarePen } from 'lucide-react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidebarRootComponentProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
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

function RailButton({ label, active, onClick, children }: {
  label: string; active?: boolean; onClick: () => void; children: ReactNode
}) {
  return <Tooltip label={label} delayMs={250} focusDelayMs={250} portal>
    <button type="button" className="sensteedModuleButton" aria-label={label}
      aria-current={active ? 'page' : undefined} onClick={onClick}>{children}</button>
  </Tooltip>
}

/** Keep the session browser mounted while a module owns the main panel. */
export function DesktopNavigationSidebar({ collapsed, startSession, toggleSidebar, selectPanel,
  usePanels, usePanelInfo, renderSlot, t }: Omit<SidebarRootComponentProps, 'selectPanel'> & { selectPanel: (id: MainPanelId | null) => void }) {
  const target = useContext(RailTarget)
  const panels = usePanels(rows => rows)
  const active = usePanelInfo(info => info.activePanelId)
  const home = active === null || active === 'conversation'
  const zh = t('session.new') === '新会话' || t('session.new').includes('新')
  const homeLabel = zh ? '主页' : 'Home'
  const toggleLabel = collapsed ? (zh ? '展开项目与聊天' : 'Expand projects and chats')
    : (zh ? '收起项目与聊天' : 'Collapse projects and chats')
  const ordered = [...panels].sort((a, b) => {
    const rank = (id: string) => id === 'schedules' ? 0 : id === 'plugins' ? 1 : id === 'sensteed-skill-manager' ? 2 : 3
    return rank(a.id) - rank(b.id) || a.order - b.order
  })
  const rail = <>
    <div className="sensteedModuleBrand"><img src={sidebarBrandMarkDataUrl} alt="" /></div>
    <div className="sensteedModuleScroll">
      <nav aria-label={zh ? '功能模块' : 'Modules'}>
        <RailButton label={homeLabel} active={home} onClick={() => selectPanel(null)}><Home size={20} /></RailButton>
        {ordered.map(({ id, label }) => <RailButton key={id} label={label} active={active === id} onClick={() => selectPanel(id)}>
          {renderSlot('sidebar.panellist', { size: 20, active: active === id }, { only: id })}
        </RailButton>)}
      </nav>
      <div className="sensteedModuleExtensions" aria-label={zh ? '业务与扩展' : 'Business and extensions'}>
        {renderSlot('sidebar.footer.action', { wide: false })}
      </div>
    </div>
    <div className="sensteedModuleFoot">
      <RailButton label={toggleLabel} onClick={toggleSidebar}><PanelLeft size={19} /></RailButton>
      {renderSlot('sidebar.settings', { wide: false })}
    </div>
  </>
  return <>
    {target !== null && createPortal(rail, target)}
    <section className="sensteedContextSidebar" aria-label={homeLabel} hidden={collapsed}>
      <header className="sensteedContextHeader"><strong>{home ? homeLabel : panels.find(p => p.id === active)?.label}</strong>
        <RailButton label={toggleLabel} onClick={toggleSidebar}><PanelLeft size={18} /></RailButton>
      </header>
      <div data-context="home" className="sensteedContextHome" hidden={!home || collapsed}>
        <Tooltip label={t('session.new.label')} delayMs={250} portal>
          <button type="button" className="sensteedContextNew" onClick={() => startSession()}>
            <SquarePen size={17} /><span>{t('session.new')}</span>
          </button>
        </Tooltip>
        {renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => { if (collapsed) toggleSidebar() } })}
      </div>
      {!home && <div className="sensteedModuleContext">
        <p>{zh ? '当前模块的业务导航与操作在右侧工作区中。' : 'Module navigation and actions are available in the workspace.'}</p>
        <button type="button" onClick={() => selectPanel(null)}>{zh ? '返回项目与聊天' : 'Back to projects and chats'}</button>
      </div>}
    </section>
  </>
}
