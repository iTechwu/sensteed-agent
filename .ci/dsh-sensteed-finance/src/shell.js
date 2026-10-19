// 片段 6/7：外壳（tab 导航/全局筛选/上下文加载）、入口按钮、样式注入与插件挂载点

const sfAnalysisGrid = '.sf-analysis-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}.sf-analysis-card{display:grid;gap:10px;align-content:start;padding:16px}.sf-analysis-head{display:flex;align-items:center;gap:8px}.sf-analysis-head h2{margin:0;font-size:13px}.sf-analysis-card>p{margin:0;color:var(--sf-ink2);font-size:12px;line-height:1.55}.sf-analysis-card>div:last-child{justify-self:start}'

// 版块元数据对齐 datasource 网页端 sectionCopy：标题 + 描述随页签切换
const SECTION_META = {
  overview: ['tabOverview', 'descOverview'],
  budget: ['tabBudget', 'descBudget'],
  operations: ['tabOperations', 'descOperations'],
  cash: ['tabCash', 'descCash'],
  alerts: ['tabAlerts', 'descAlerts'],
  datacenter: ['tabDatacenter', 'descDatacenter'],
  entry: ['tabEntry', 'descEntry'],
  analyze: ['tabAnalyze', 'descAnalyze'],
  bom: ['tabBom', 'descBom'],
  engine: ['tabEngine', 'descEngine'], comparisons: ['tabComparisons', 'descComparisons'], review: ['tabReview', 'descReview'], sources: ['tabSources', 'descSources'], facts: ['tabFacts', 'descFacts'], notifications: ['tabNotifications', 'descNotifications'], permissions: ['tabPermissions', 'descPermissions'],
}

function Dashboard({ t, embedded = false, onClose = closeOverlay }) {
  const active = embedded || opened
  const capabilities = useFinanceCapabilities()
  const financeWriter = ['FINANCE_STAFF', 'FINANCE_OWNER'].includes(capabilities.role)
  const identity = { ...capabilities, financeWriter }
  const canOpen = section => financeSectionAllowed(section, identity)
  const navigation = useFinanceNavigation(String(new Date().getFullYear()))
  const { tab, params: drillParams, year, orgId } = navigation.current
  const setYear = value => navigation.update({ year: value, viewState: {} })
  const setOrgId = value => navigation.update({ orgId: value, viewState: {} })
  const setDrillParams = value => navigation.update(route => ({ params: typeof value === 'function' ? value(route.params) : value }))
  const contentRef = useRef(null)
  const [revision, setRevision] = useState(0)
  const [context, setContext] = useState(null) // { orgs, departments }
  const [operator, setOperator] = useState(null) // 登录身份（审计可见性；写操作由宿主自动注入）
  const [brief, setBrief] = useState(null) // 总览/经营共用的全景快照
  const [briefState, setBriefState] = useState('loading')
  const [workQueue, setWorkQueue] = useState(null)
  const shellRef = useRef(null)
  const entryLeaveRef = useRef(null)
  const registerEntryLeave = useCallback(guard => { entryLeaveRef.current = guard }, [])
  const closeSafely = () => { if (entryLeaveRef.current) entryLeaveRef.current(onClose); else onClose() }
  // 同步请求锁：brief 取数在途时丢弃重复刷新，避免 revision 连击叠加请求
  const loadingRef = useRef(false)

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    void api('/context').then(value => { if (!cancelled) setContext(value) }).catch(() => {})
    // 登录身份（sensteed 品牌宿主提供；路由不存在/未登录时静默隐藏）
    void fetch('/api/desktop/auth/feishu/status', { method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      .then(response => response.json().catch(() => null))
      .then(snapshot => { if (!cancelled && snapshot?.status === 'bound' && snapshot.user?.name) setOperator(snapshot.user.name) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [active, revision])

  // 总览/经营共用 brief；其余视图自取数
  useEffect(() => {
    if (!active) return undefined
    if (tab !== 'overview' && tab !== 'operations') return undefined
    let cancelled = false
    loadingRef.current = true
    setBrief(null)
    setBriefState('loading')
    api(`/brief?year=${year}${orgId ? `&orgId=${orgId}` : ''}`)
      .then(value => { if (!cancelled) { setBrief(value); setBriefState('ok') } })
      .catch(() => { if (!cancelled) setBriefState('error') })
      .finally(() => { loadingRef.current = false })
    return () => { cancelled = true; loadingRef.current = false }
  }, [active, tab, year, orgId, revision])

  useEffect(() => {
    if (!active || tab !== 'overview') return undefined
    let cancelled = false
    setWorkQueue({ state: 'loading' })
    const requests = financeWriter ? [
      financeRest('/finance/review/summary'), api('/quality'), api(`/alerts-summary?year=${year}${orgId ? `&orgId=${orgId}` : ''}`),
    ] : [financeRest(`/finance/filing/assignments/summary?year=${year}`)]
    Promise.allSettled(requests).then(results => {
      if (cancelled) return
      const value = index => results[index]?.status === 'fulfilled' ? results[index].value.data ?? results[index].value.quality ?? null : null
      const failed = results.filter(result => result.status === 'rejected').length
      setWorkQueue({ state: failed === results.length ? 'error' : failed ? 'partial' : 'ready', financeWriter, review: financeWriter ? value(0) : null, assignments: financeWriter ? null : value(0), quality: financeWriter ? value(1) : null, alerts: financeWriter ? value(2) : null })
    })
    return () => { cancelled = true }
  }, [active, tab, year, orgId, revision, financeWriter])

  const refresh = () => { if (loadingRef.current) return; setRevision(value => value + 1) }
  useEffect(() => {
    if (!active) return undefined
    window.addEventListener('sf:refresh', refresh)
    const key = event => { if (event.key === 'Escape') closeSafely() }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('sf:refresh', refresh); window.removeEventListener('keydown', key) }
  }, [active])

  useEffect(() => { if (active) requestAnimationFrame(() => shellRef.current?.focus?.()) }, [active])

  const orgs = context?.data?.orgs || []
  const departments = context?.data?.departments || []
  const onDrill = (target, params) => {
    const item = financeNavigationItem(target, params)
    if (!canOpen(target) || (item && !financeNavigationAllowed(item, identity))) return
    const navigate = () => {
      const next = { year, orgId, ...params }
      navigation.navigate(target, next, contentRef.current?.scrollTop || 0)
    }
    if (entryLeaveRef.current) entryLeaveRef.current(navigate)
    else navigate()
  }
  const ctx = { year, orgId, orgs, departments, revision, drillParams, viewState: navigation.current.viewState, permissions: capabilities.permissions || [], financeWriter, role: capabilities.role, fullAccess: capabilities.fullAccess, onNavigate: onDrill }
  const activeItem = financeNavigationItem(tab, drillParams)
  useEffect(() => { if (capabilities.permissions !== null && (!canOpen(tab) || (activeItem && !financeNavigationAllowed(activeItem, identity)))) { navigation.reset() } }, [tab, capabilities.permissions, financeWriter, capabilities.role, activeItem])
  const previous = navigation.previous
  const previousItem = previous ? financeNavigationItem(previous.tab, previous.params) : null
  const canBack = previous && canOpen(previous.tab) && (!previousItem || financeNavigationAllowed(previousItem, identity))
  const goBack = () => {
    if (!canBack) return
    if (entryLeaveRef.current) entryLeaveRef.current(navigation.back)
    else navigation.back()
  }
  useEffect(() => restoreFinanceScroll(contentRef.current, navigation.current.scrollTop), [navigation.current.id])
  const briefProps = { brief, t, onDrill, orgId }

  // 各 tab 的错误/空态由视图内部处理；这里只处理 brief 类视图的加载与失败
  const body = !canOpen(tab) ? h('p', { role: 'alert' }, '当前账号没有此页面权限') : (tab === 'overview' || tab === 'operations') && briefState === 'loading' && !brief
    ? h('div', { className: 'sf-loading', role: 'status' }, h(Glyph, { name: 'loading' }), t('loading'))
    : (tab === 'overview' || tab === 'operations') && briefState === 'error' && !brief
      ? h('div', { className: 'sf-fatal', role: 'alert' }, h(Glyph, { name: 'warning' }), h('strong', null, t('loadError')), h(GhostButton, { onClick: refresh }, t('retry')))
      : h(React.Fragment, { key: `${navigation.current.id}-${tab}-${year}-${JSON.stringify(drillParams)}` },
        tab === 'overview' ? h(OverviewView, { key: `ov-${year}-${orgId}-${revision}`, ...briefProps, workQueue }) : null,
        tab === 'operations' ? h(OperationsView, { key: `op-${year}-${orgId}-${revision}`, ...briefProps }) : null,
        tab === 'budget' ? ctx.drillParams?.lineId ? h(BudgetSavedRecordView, { ctx, t }) : h(BudgetView, { ctx, t }) : null,
        tab === 'cash' ? h(CashView, { ctx, t, onDrill }) : null,
        tab === 'alerts' ? h(AlertsView, { ctx, t, onDrill }) : null,
        tab === 'costitems' ? h(FinanceCostItemsView, { ctx, t }) : null,
        tab === 'datacenter' ? h(DataCenterView, { ctx, t }) : null,
        tab === 'entry' ? h(EntryPanel, { year, orgId, orgs, departments, role: ctx.role, t, onSaved: refresh, onYearChange: setYear, onNavigate: onDrill, onLeaveGuardChange: registerEntryLeave }) : null,
        tab === 'budget-filing' ? h(BudgetFilingView, { key: `budget-filing-${year}-${drillParams?.taskId || ''}`, ctx, t }) : null,
        tab === 'filing' ? h(FilingParityView, { key: `filing-${year}-${drillParams?.section || 'assignments'}-${drillParams?.taskId || ''}`, ctx, t }) : null,
        tab === 'identity' ? drillParams?.directorySection === 'members' ? h(FinanceMembersView, { ctx, t }) : drillParams?.directorySection === 'directory' ? h(FinanceDirectoryView, { ctx }) : h(FinanceEmploymentView, { ctx, t }) : null,
        tab === 'bom' && canOpen('bom') ? h(BomView, { ctx, t }) : null,
        tab === 'analyze' ? h(AnalyzeView, { ctx, t }) : null,
        tab === 'engine' ? h(EngineView, { ctx, t }) : null,
        tab === 'comparisons' ? h(ComparisonsView, { ctx, t }) : null,
        tab === 'review' ? h(ReviewView, { ctx, t }) : null,
        tab === 'sources' ? h(SourcesView, { ctx, t }) : null,
        tab === 'facts' ? h(FactsView, { ctx, t }) : null,
        tab === 'notifications' ? h(NotificationsView, { ctx, t, onDrill }) : null,
        tab === 'permissions' ? h(PermissionsView, { ctx, t }) : null)

  return h('div', { className: `sf-overlay sf-root${embedded ? ' sf-page' : ''}`, role: embedded ? 'region' : 'dialog', 'aria-modal': embedded ? undefined : true, 'aria-labelledby': 'sf-title' },
    h('main', { className: 'sf-shell', 'aria-labelledby': 'sf-title', ref: shellRef, tabIndex: -1 },
      h('div', { className: 'sf-sidebar-brand' },
        h('span', { className: 'sf-sidebar-brand-mark' }, h(Glyph, { name: 'data', size: 18 })),
        h('div', null, h('strong', null, '有谦财务数据中心'), h('small', null, t('hubSubtitle')))),
      h('header', { className: 'sf-header' },
        h('div', { className: 'sf-header-main' },
          h('p', { className: 'sf-eyebrow' }, t('eyebrow')),
          canBack ? h(GhostButton, { onClick: goBack, 'aria-label': `返回${previousItem?.[1] || '上一页'}` }, h(Glyph, { name: 'left', size: 12 }), `返回${previousItem?.[1] || '上一页'}`) : null,
          h('h1', { id: 'sf-title' }, activeItem?.[1] ?? t(SECTION_META[tab]?.[0] ?? 'title')),
          h('p', { className: 'sf-desc' }, [operator ? `${t('operatorAs')} ${operator}` : null, tab === 'budget-filing' ? '本人填报、两级审核与部门预算确认' : tab === 'filing' ? '完成部门填报并跟踪提交、退回与确认进度' : tab === 'identity' ? '维护成员职责、组织身份与部门归属' : t(SECTION_META[tab]?.[1] ?? 'subtitle')].filter(Boolean).join(' · '))),
        h('div', { className: 'sf-header-side' },
          !['entry', 'identity', 'bom', 'sources', 'datacenter', 'costitems', 'review', 'notifications', 'permissions'].includes(tab) ? h('label', { className: 'sf-filter' }, h('span', null, t('year')), h(Select, { value: year, onChange: value => { setYear(value); setDrillParams(current => current ? { ...current, year: value, taskId: undefined, versionId: undefined, lineId: undefined } : null) }, options: yearOptions(year) })) : null,
          ['overview', 'operations', 'cash', 'alerts', 'analyze'].includes(tab) ? h('label', { className: 'sf-filter' }, h('span', null, t('org')), h(SearchSelect, { value: orgId, onChange: value => { setOrgId(value); setDrillParams(null) }, options: orgs.filter(org => org.type !== 'GROUP').map(org => [org.id, org.name]), placeholder: t('allOrgs') })) : null,
          h('div', { className: 'sf-header-buttons' },
            h(Tooltip, { label: t('refresh') }, h('button', { type: 'button', className: 'sf-icon-button', 'aria-label': t('refresh'), onClick: refresh }, h(IconRefreshOutlineRegular, { size: 16 }))),
            h(Tooltip, { label: t('close') }, h('button', { type: 'button', className: 'sf-icon-button', 'aria-label': t('close'), onClick: closeSafely }, h(IconCloseOutlineRegular, { size: 16 })))))),
      h('nav', { className: 'sf-tabs', 'aria-label': t('title') }, ...FINANCE_NAVIGATION.map(([label, items]) => {
        const visible = items.filter(item => financeNavigationAllowed(item, identity))
        return visible.length ? h('section', { key: label, className: 'sf-nav-group', 'aria-label': label },
          h('h2', null, label), ...visible.map(item => h('button', { type: 'button', key: item[0], 'aria-current': activeItem?.[0] === item[0] ? 'page' : undefined, onClick: () => onDrill(item[2], financeSidebarParams(item, tab, drillParams, year)) }, item[1]))) : null
      })),
      h('label', { className: 'sf-mobile-nav' }, h('span', null, '前往页面'),
        h('select', { value: activeItem?.[0] || 'overview', onChange: event => {
          const item = FINANCE_NAVIGATION.flatMap(([, items]) => items).find(item => item[0] === event.target.value)
          if (item) onDrill(item[2], financeSidebarParams(item, tab, drillParams, year))
        } }, ...FINANCE_NAVIGATION.map(([label, items]) => {
          const visible = items.filter(item => financeNavigationAllowed(item, identity))
          return visible.length ? h('optgroup', { key: label, label }, ...visible.map(item => h('option', { key: item[0], value: item[0] }, item[1]))) : null
        }))),
      h('div', { ref: contentRef, className: `sf-content${briefState === 'loading' && !brief ? ' sf-refreshing' : ''}`, 'aria-busy': briefState === 'loading' && !brief }, body)))
}

function Button({ wide, t, onOpen = openOverlay }) {
  const allowed = useFinanceWorkspaceAccess()
  if (allowed !== true) return null
  return h(Tooltip, { label: t('open'), disabled: wide }, h('button', { type: 'button', className: `sf-button${wide ? ' sf-wide' : ''}`, 'aria-label': t('open'), onClick: onOpen }, h(IconGaugeOutlineRegular, { size: wide ? 14 : 18 }), wide ? h('span', null, t('open')) : null))
}

function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, copy), 'dofe-sensteed-finance: dictionaries')
  ctx.effect(() => { window.addEventListener(OVERLAY_EVENT, closeOtherOverlay); return () => window.removeEventListener(OVERLAY_EVENT, closeOtherOverlay) }, 'dofe-sensteed-finance: exclusive-overlay')
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = '@dofe/dsh-sensteed-finance'; style.textContent = css + sfAnalysisGrid; document.head.appendChild(style); return () => style.remove() }, 'dofe-sensteed-finance: styles')
  // 深度分析入口走宿主 conversation 服务（由 desktop 宿主在浏览器侧注册）；
  // 通过惰性 getter 注入，避免插件客户端与宿主模块产生编译期耦合。
  ctx.effect(() => {
    // Keep only operation state and a session receipt for this plugin lifetime.
    // View navigation must not lose accepted work or create another in-flight request.
    let state = { starting: false, submitted: null }
    let operation = null
    const listeners = new Set()
    const publish = patch => { state = { ...state, ...patch }; for (const listener of listeners) listener() }
    const conversationBridge = {
      getSnapshot: () => state,
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
      send(prompt) {
        if (operation) return operation
        if (state.submitted) return Promise.resolve(state.submitted)
        publish({ starting: true })
        operation = Promise.resolve().then(() => submit(prompt)).finally(() => {
          operation = null
          publish({ starting: false })
        })
        return operation
      },
    }
    globalThis.__sensteed_finance_conversation = () => conversationBridge
    async function submit(prompt) {
      const sessions = ctx.get?.('sessions')
      const navigation = ctx.get?.('uiWorkspace')
      if (!sessions || !navigation) throw new Error('conversation_unavailable')
      const skillName = /^\/(finance-[a-z0-9-]+)(?:\s|$)/.exec(prompt)?.[1]
      if (!ANALYSIS_ENTRIES.some(entry => entry.skill === skillName)) throw new Error('analysis_skill_invalid')
      // Recheck on each click: an open panel may outlive its login or assistant permission.
      let access
      try { access = await api('/access?permission=finance.assistant.read') }
      catch (error) {
        if (error.status === 401) throw new Error('analysis_login_required')
        if (error.status === 403) throw new Error('analysis_access_denied')
        throw new Error('analysis_access_unavailable')
      }
      if (access?.ok !== true || typeof access.allowed !== 'boolean') throw new Error('analysis_access_unavailable')
      if (!access.allowed) throw new Error('analysis_access_denied')
      // 每次深度分析都从独立会话开始，避免把上一次分析的上下文带入本次结论。
      const id = await sessions.create()
      // Retain until ready, catalog check and submission finish; an unknown /skill is plain prose to the Host.
      let accepted = false
      const receipt = { sessionId: id, opened: false, open: async () => {
        await navigation.openSession(id)
        receipt.opened = true
        publish({ submitted: null })
      } }
      try { await sessions.using(id, { source: 'controllerOperation' }, async reference => {
        await reference.ready
        const scoped = sessions.scope(id)
        if (!scoped) throw new Error('session_unavailable')
        const skills = ctx.get?.('remote.skills')
        if (!skills?.list) throw new Error('analysis_catalog_unavailable')
        const catalog = await skills.list({ sessionId: id }, AbortSignal.timeout(REQUEST_TIMEOUT_MS))
        if (!catalog?.ok || !Array.isArray(catalog.value?.skills)) throw new Error('analysis_catalog_unavailable')
        if (!catalog.value.skills.some(skill => skill.name === skillName)) throw new Error('analysis_skill_unavailable')
        const conversation = scoped.get('conversation')
        if (!conversation) throw new Error('conversation_service_unavailable')
        await conversation.send(prompt)
        accepted = true
        publish({ submitted: receipt })
        // Transfer ownership to the visible session before releasing the operation reference.
        try { await receipt.open() } catch {}
      }) } catch (error) {
        // Once accepted, a reference cleanup failure must not offer to resend the same request.
        if (!accepted) throw error
      }
      return receipt
    }
    globalThis.__sensteed_finance_close = closeOverlay
    return () => { listeners.clear(); delete globalThis.__sensteed_finance_conversation; delete globalThis.__sensteed_finance_close }
  }, 'dofe-sensteed-finance: scoped conversation')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'dofe-sensteed-finance', order: 56, inject: () => ({ t, onOpen: () => ctx.layout.selectPanel('sensteed-finance') }) }, Button))
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'sensteed-finance', inject: () => ({ t, embedded: true, onClose: () => ctx.layout.selectPanel(null) }) }, FinancePage))
}

function FinancePage(props) {
  const allowed = useFinanceWorkspaceAccess()
  return allowed === true ? h(Dashboard, props) : null
}

function Overlay({ t }) {
  const allowed = useFinanceWorkspaceAccess()
  const visible = useSyncExternalStore(subscribe, snapshot, snapshot)
  return allowed === true && visible ? h(Dashboard, { t }) : null
}

function useFinanceWorkspaceAccess(permission) {
  const [allowed, setAllowed] = useState(null)
  useEffect(() => {
    let cancelled = false
    let checking = false
    let timer
    const controller = new AbortController()
    const check = async () => {
      if (cancelled || checking) return
      checking = true
      clearTimeout(timer)
      let nextCheckMs = 5000
      try {
        const response = await fetch(`${BASE}/access${permission ? `?permission=${encodeURIComponent(permission)}` : ''}`, {
          credentials: 'same-origin', redirect: 'error',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        })
        if (cancelled) return
        if (response.status === 401 || response.status === 403) {
          setAllowed(false)
        } else {
          if (!response.ok) throw new Error('finance_access_unavailable')
          const body = await response.json()
          if (body?.ok !== true || typeof body.allowed !== 'boolean') throw new Error('finance_access_unavailable')
          if (cancelled) return
          setAllowed(body.allowed)
          if (body.allowed) nextCheckMs = 60000
        }
      } catch { /* An outage does not revoke a previously confirmed permission. */ }
      finally {
        checking = false
        if (!cancelled) timer = setTimeout(() => { void check() }, nextCheckMs)
      }
    }
    const refresh = () => { void check() }
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearTimeout(timer)
      controller.abort()
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [permission])
  return allowed
}
