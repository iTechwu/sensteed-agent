/** Sidebar foot Profile switcher (docs/1022 §6.1). 双壳共用（product 插件在 stable 与 NEXT 都加载）；
 * 渲染进程只发 Host 意图，存储与作用域都在 Host 进程。 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical, Plus } from 'lucide-react'
import { hubProfilesRequest, type HubContentProfileView, type HubContentProfileStatus } from './hub-setup-state.ts'
import { trackHubTemplate } from './hub-analytics.ts'
import type { DofeAccessLocaleKey } from './dofe-access.ts'

export interface ProfileSwitcherProps {
  wide: boolean
  t: (key: DofeAccessLocaleKey) => string
  openHub: () => void
}

const countsLine = (profile: HubContentProfileView): string =>
  `${profile.summary.skills} / ${profile.summary.plugins} / ${profile.summary.mcpEndpoints}`

const MENU_WIDTH = { wide: 240, narrow: 200 } as const

export function ProfileSwitcher({ wide, t, openHub }: ProfileSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [profiles, setProfiles] = useState<HubContentProfileView[] | undefined>(undefined)
  const [status, setStatus] = useState<HubContentProfileStatus>()
  const [loadError, setLoadError] = useState(false)
  const [epoch, setEpoch] = useState(0)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [anchor, setAnchor] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // 菜单 portal 到 body 并按触发钮矩形 fixed 定位：收起态 56px 侧栏轨道会裁剪
  // absolute 子元素（「＋ 新增 Profile」被裁成「＋ 在插」），portal 是唯一出路。
  const placeMenu = (): void => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = wide ? MENU_WIDTH.wide : MENU_WIDTH.narrow
    setAnchor({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      bottom: window.innerHeight - rect.top + 6,
    })
  }
  useEffect(() => {
    if (!open) return
    window.addEventListener('resize', placeMenu)
    return () => { window.removeEventListener('resize', placeMenu) }
  }, [open, wide])

  useEffect(() => {
    const changed = () => setEpoch(value => value + 1)
    window.addEventListener('sensteed:content-profiles-changed', changed)
    const timer = open ? setInterval(changed, 3000) : undefined
    return () => { window.removeEventListener('sensteed:content-profiles-changed', changed); clearInterval(timer) }
  }, [open])
  useEffect(() => {
    const controller = new AbortController()
    void hubProfilesRequest<HubContentProfileStatus>({ action: 'status' }, controller.signal).then(value => {
      if (controller.signal.aborted) return
      if (!Array.isArray(value?.profiles) || !value.apply) throw Error('HUB_INVALID_RESPONSE')
      setStatus(value); setProfiles(value.profiles); setLoadError(false)
    }).catch(() => { if (!controller.signal.aborted) setLoadError(true) })
    return () => controller.abort()
  }, [open, epoch])

  // 键盘可达：打开即聚焦当前项；↑↓/Home/End 在菜单项间移动，Esc 关闭并归还焦点。
  useEffect(() => {
    if (!open || !menuRef.current) return
    const items = menuRef.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    const target = [...items].find(item => item.getAttribute('aria-current') === 'true') ?? items[0]
    target?.focus()
  }, [open, profiles])
  const onMenuKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const items = [...menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []]
    if (!items.length) return
    const index = items.findIndex(item => item === document.activeElement)
    const next = event.key === 'ArrowDown' ? items[(index + 1 + items.length) % items.length]
      : event.key === 'ArrowUp' ? items[(index - 1 + items.length) % items.length]
      : event.key === 'Home' ? items[0]
      : items[items.length - 1]
    next?.focus()
  }

  const glyph = (profile: HubContentProfileView | undefined): string => (profile ? profile.name.slice(0, 1) : '·')
  const activeId = status?.appliedId ?? null
  const applying = busy || status?.apply.phase === 'applying' || status?.apply.phase === 'registering'
  const current = profiles?.find(profile => profile.id === activeId)

  const switchTo = (profile: HubContentProfileView): void => {
    if (applying) return
    if (profile.id === activeId) { setNotice(t('alreadyCurrent')); return }
    // 期望集切换后需重新应用：确认后仅改注册，物化经企业目录页的既有检查/安装管线。
    if (!window.confirm(`${t('switchHint')}「${profile.name}」`)) return
    // §6.4 应用中再操作：菜单禁用，activate 在途期间不可重复触发
    setBusy(true); setNotice(t('hubWorking'))
    void hubProfilesRequest<{ registered: boolean; skippedCount: number }>({ action: 'activate', id: profile.id }).then((result) => {
      trackHubTemplate({ event: 'PROFILE_SWITCHED', properties: { itemCount: profile.summary.skills + profile.summary.plugins } })
      setEpoch(value => value + 1)
      // 重注册按当前 release 复核，个别条目可能已不可用：显式告知，不静默缩水
      setNotice(result.skippedCount > 0 ? `${t('switched')} ${t('switchSkipped').replace('{count}', String(result.skippedCount))}` : t('switched'))
    }).catch(() => {
      trackHubTemplate({ event: 'PROFILE_APPLY_FAILED', properties: { phase: 'resolve', errorClass: 'error' } })
      // 失败时 Host 未置当前（activate 注册失败不落 setActive）：显式回退语义，不用读列表失败文案
      setNotice(t('switchFailed'))
    }).finally(() => setBusy(false))
  }

  return (
    <div style={{ position: 'relative', display: 'flex' }}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('profilesLabel')}
        title={wide ? `${t('profilesLabel')}${current ? `：${current.name}` : ''}` : current ? `${current.name}` : t('profilesLabel')}
        onClick={() => { if (!open) placeMenu(); setOpen(value => !value); setNotice('') }}
        style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {wide || !current ? <MoreVertical size={16} aria-hidden="true" /> : <span aria-hidden="true" style={{ fontSize: 12, fontWeight: 600 }}>{glyph(current)}</span>}
      </button>
      {open ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          onKeyDown={onMenuKeyDown}
          aria-label={t('profilesLabel')}
          style={{
            position: 'fixed', bottom: anchor.bottom, left: anchor.left, zIndex: 1000, width: wide ? MENU_WIDTH.wide : MENU_WIDTH.narrow,
            background: 'var(--dsw-alias-bg-layer-1, #fff)', border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)', borderRadius: 10,
            boxShadow: '0 8px 24px rgb(0 0 0 / 12%)', padding: 6, color: 'var(--dsw-alias-label-primary, inherit)',
          }}>
          {/* §6.1 第一项永远「＋ 新增 Profile」 */}
          <button type="button" role="menuitem" disabled={applying} onClick={() => { setOpen(false); openHub() }}
            style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 6, padding: '6px 8px', fontSize: 12, borderRadius: 8, textAlign: 'left' }}>
            <Plus size={14} aria-hidden="true" />{t('createHint')}
          </button>
          {loadError ? <p role="alert" style={{ margin: '4px 8px', fontSize: 12 }}>{t('loadFailed')} <button type="button" onClick={() => setEpoch(value => value + 1)}>{t('templateRetry')}</button></p> : profiles === undefined ? <p role="status" style={{ margin: '4px 8px', fontSize: 12 }}>{t('catalogLoading')}</p> : (
            <ul role="none" style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 240, overflowY: 'auto' }}>
              {profiles.length === 0 ? <li role="none" style={{ padding: '4px 8px', fontSize: 12, opacity: 0.7 }}>{t('createHint')}</li> : profiles.map(profile => {
                const isCurrent = profile.id === activeId
                const hasSkipped = profile.summary.skipped > 0
                return (
                  <li key={profile.id} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      disabled={applying}
                      onClick={() => switchTo(profile)}
                      aria-current={isCurrent ? 'true' : undefined}
                      style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, padding: '6px 8px', textAlign: 'left', borderRadius: 8, background: isCurrent ? 'var(--dsw-alias-interactive-bg-hover, #f3f4f6)' : 'transparent' }}
                    >
                      <span aria-hidden="true" style={{ fontSize: 12, fontWeight: 600 }}>{glyph(profile)}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13 }}>{profile.name}{isCurrent ? ` · ${t('current')}` : status?.registeredId === profile.id ? ` · ${t('profilePending')}` : ''}</span>
                        <span style={{ display: 'block', fontSize: 11, opacity: 0.65 }}>{countsLine(profile)}</span>
                      </span>
                      {/* §6.1 阻断项 ⚠ 徽标：创建时跳过的条目不静默 */}
                      {hasSkipped ? <span title={t('blockedBadge')}>⚠</span> : null}
                      {isCurrent ? <span aria-hidden="true">✓</span> : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {notice ? <p role="status" style={{ margin: '4px 8px', fontSize: 11, opacity: 0.8 }}>{notice}</p> : null}
        </div>, document.body) : null}
    </div>
  )
}
