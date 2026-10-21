/** Sidebar foot Profile switcher (docs/1022 §6.1). Intents only; storage and scoping stay in the Host. */
import { useEffect, useRef, useState } from 'react'
import { MoreVertical, Plus } from 'lucide-react'
import { trackHubSwitch } from './hub-analytics.ts'

interface ContentProfileView {
  id: string
  name: string
  summary: { skills: number; plugins: number; mcpEndpoints: number; skipped: number }
}

export interface ProfileSwitcherProps {
  wide: boolean
  t: (key: 'profilesLabel' | 'current' | 'switchHint' | 'createHint' | 'switched' | 'alreadyCurrent' | 'loadFailed') => string
  openPlugins: () => void
}

const countsLine = (profile: ContentProfileView): string =>
  `${profile.summary.skills} / ${profile.summary.plugins} / ${profile.summary.mcpEndpoints}`

export function ProfileSwitcher({ wide, t, openPlugins }: ProfileSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [profiles, setProfiles] = useState<ContentProfileView[] | undefined>(undefined)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const request = window.desktopNext?.contentProfiles?.request

  useEffect(() => {
    if (!open || !request) return
    let cancelled = false
    void Promise.all([
      request({ action: 'list' }) as Promise<ContentProfileView[]>,
      request({ action: 'active' }) as Promise<string | null>,
    ]).then(([list, active]) => {
      if (cancelled) return
      setProfiles(list); setActiveId(active)
    }).catch(() => { if (!cancelled) setProfiles([]) })
    return () => { cancelled = true }
  }, [open, request])

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

  if (!request) return null
  const glyph = (profile: ContentProfileView | undefined): string => (profile ? profile.name.slice(0, 1) : '·')
  const current = profiles?.find(profile => profile.id === activeId)

  const switchTo = (profile: ContentProfileView): void => {
    if (profile.id === activeId) { setNotice(t('alreadyCurrent')); return }
    // 期望集切换后需重新应用：确认后仅改注册，物化经企业目录页的既有检查/安装管线。
    if (!window.confirm(`${t('switchHint')}「${profile.name}」`)) return
    void request({ action: 'set-active', id: profile.id }).then(() => {
      trackHubSwitch({ event: 'PROFILE_SWITCHED', properties: { itemCount: profile.summary.skills + profile.summary.plugins } })
      setActiveId(profile.id); setNotice(t('switched'))
    }).catch(() => {
      trackHubSwitch({ event: 'PROFILE_APPLY_FAILED', properties: { phase: 'resolve', errorClass: 'error' } })
      setNotice(t('loadFailed'))
    })
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
        onClick={() => { setOpen(value => !value); setNotice('') }}
        style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {wide || !current ? <MoreVertical size={16} aria-hidden="true" /> : <span aria-hidden="true" style={{ fontSize: 12, fontWeight: 600 }}>{glyph(current)}</span>}
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          onKeyDown={onMenuKeyDown}
          aria-label={t('profilesLabel')}
          style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, zIndex: 40, minWidth: wide ? 240 : 200,
          background: 'var(--background, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 10,
          boxShadow: '0 8px 24px rgb(0 0 0 / 12%)', padding: 6,
        }}>
          {profiles === undefined ? <p role="status" style={{ margin: '4px 8px', fontSize: 12 }}>{t('loadFailed')}</p> : (
            <ul role="none" style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 240, overflowY: 'auto' }}>
              {profiles.length === 0 ? <li role="none" style={{ padding: '4px 8px', fontSize: 12, opacity: 0.7 }}>{t('createHint')}</li> : profiles.map(profile => {
                const isCurrent = profile.id === activeId
                return (
                  <li key={profile.id} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => switchTo(profile)}
                      aria-current={isCurrent ? 'true' : undefined}
                      style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, padding: '6px 8px', textAlign: 'left', borderRadius: 8, background: isCurrent ? 'var(--accent, #f3f4f6)' : 'transparent' }}
                    >
                      <span aria-hidden="true" style={{ fontSize: 12, fontWeight: 600 }}>{glyph(profile)}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13 }}>{profile.name}{isCurrent ? ` · ${t('current')}` : ''}</span>
                        <span style={{ display: 'block', fontSize: 11, opacity: 0.65 }}>{countsLine(profile)}</span>
                      </span>
                      {isCurrent ? <span aria-hidden="true">✓</span> : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <button type="button" role="menuitem" onClick={() => { setOpen(false); openPlugins() }}
            style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 6, padding: '6px 8px', fontSize: 12, borderRadius: 8, textAlign: 'left' }}>
            <Plus size={14} aria-hidden="true" />{t('createHint')}
          </button>
          {notice ? <p role="status" style={{ margin: '4px 8px', fontSize: 11, opacity: 0.8 }}>{notice}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
