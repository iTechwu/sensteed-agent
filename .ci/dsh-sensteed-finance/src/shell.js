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
}

function Dashboard({ t }) {
  const [tab, setTab] = useState('overview')
  // 下钻参数：onDrill(target, params) 切 tab 时可带子视图/月份等初始状态
  const [drillParams, setDrillParams] = useState(null)
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(String(currentYear))
  const [orgId, setOrgId] = useState('')
  const [revision, setRevision] = useState(0)
  const [context, setContext] = useState(null) // { orgs, departments }
  const [operator, setOperator] = useState(null) // 登录身份（审计可见性；写操作由宿主自动注入）
  const [brief, setBrief] = useState(null) // 总览/经营共用的全景快照
  const [briefState, setBriefState] = useState('loading')
  const shellRef = useRef(null)
  // 同步请求锁：brief 取数在途时丢弃重复刷新，避免 revision 连击叠加请求
  const loadingRef = useRef(false)

  useEffect(() => {
    if (!opened) return undefined
    let cancelled = false
    void api('/context').then(value => { if (!cancelled) setContext(value) }).catch(() => {})
    // 登录身份（sensteed 品牌宿主提供；路由不存在/未登录时静默隐藏）
    void fetch('/api/desktop/auth/feishu/status', { method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      .then(response => response.json().catch(() => null))
      .then(snapshot => { if (!cancelled && snapshot?.status === 'bound' && snapshot.user?.name) setOperator(snapshot.user.name) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [opened, revision])

  // 总览/经营共用 brief；其余视图自取数
  useEffect(() => {
    if (!opened) return undefined
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
  }, [opened, tab, year, orgId, revision])

  const refresh = () => { if (loadingRef.current) return; setRevision(value => value + 1) }
  useEffect(() => {
    if (!opened) return undefined
    window.addEventListener('sf:refresh', refresh)
    const key = event => { if (event.key === 'Escape') closeOverlay() }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('sf:refresh', refresh); window.removeEventListener('keydown', key) }
  }, [opened])

  useEffect(() => { if (opened) requestAnimationFrame(() => shellRef.current?.focus?.()) }, [opened])

  const orgs = context?.data?.orgs || []
  const departments = context?.data?.departments || []
  const ctx = { year, orgId, orgs, departments, revision, drillParams }
  const onDrill = (target, params) => { setDrillParams(params ?? null); if (params?.orgId) setOrgId(params.orgId); setTab(target) }
  const briefProps = tab === 'overview'
    ? { brief, t, onDrill }
    : { brief, t, onDrill }

  // 各 tab 的错误/空态由视图内部处理；这里只处理 brief 类视图的加载与失败
  const body = (tab === 'overview' || tab === 'operations') && briefState === 'loading' && !brief
    ? h('div', { className: 'sf-loading', role: 'status' }, h(Glyph, { name: 'loading' }), t('loading'))
    : (tab === 'overview' || tab === 'operations') && briefState === 'error' && !brief
      ? h('div', { className: 'sf-fatal', role: 'alert' }, h(Glyph, { name: 'warning' }), h('strong', null, t('loadError')), h(GhostButton, { onClick: refresh }, t('retry')))
      : h(React.Fragment, null,
        tab === 'overview' ? h(OverviewView, { key: `ov-${year}-${orgId}-${revision}`, ...briefProps }) : null,
        tab === 'operations' ? h(OperationsView, { key: `op-${year}-${orgId}-${revision}`, ...briefProps }) : null,
        tab === 'budget' ? h(BudgetView, { ctx, t }) : null,
        tab === 'cash' ? h(CashView, { ctx, t, onDrill }) : null,
        tab === 'alerts' ? h(AlertsView, { ctx, t, onDrill }) : null,
        tab === 'datacenter' ? h(DataCenterView, { ctx, t }) : null,
        tab === 'entry' ? h(EntryView, { ctx, t }) : null,
        tab === 'analyze' ? h(AnalyzeView, { ctx, t }) : null)

  return h('div', { className: 'sf-overlay sf-root', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'sf-title' },
    h('main', { className: 'sf-shell', 'aria-labelledby': 'sf-title', ref: shellRef, tabIndex: -1 },
      h('header', { className: 'sf-header' },
        h('div', { className: 'sf-header-main' },
          h('p', { className: 'sf-eyebrow' }, t('eyebrow')),
          h('h1', { id: 'sf-title' }, t(SECTION_META[tab]?.[0] ?? 'title')),
          h('p', { className: 'sf-desc' }, operator ? `${t('operatorAs')} ${operator} · ${t(SECTION_META[tab]?.[1] ?? 'subtitle')}` : t(SECTION_META[tab]?.[1] ?? 'subtitle'))),
        h('div', { className: 'sf-header-side' },
          h('label', { className: 'sf-filter' }, h('span', null, t('year')), h(Select, { value: year, onChange: value => { setYear(value); setDrillParams(null) }, options: yearOptions() })),
          h('label', { className: 'sf-filter' }, h('span', null, t('org')), h(Select, { value: orgId, onChange: value => { setOrgId(value); setDrillParams(null) }, options: orgs.map(org => [org.id, org.name]), placeholder: t('allOrgs') })),
          h('div', { className: 'sf-header-buttons' },
            h(Tooltip, { label: t('refresh') }, h('button', { type: 'button', className: 'sf-icon-button', 'aria-label': t('refresh'), onClick: refresh }, h(IconRefreshOutlineRegular, { size: 16 }))),
            h(Tooltip, { label: t('close') }, h('button', { type: 'button', className: 'sf-icon-button', 'aria-label': t('close'), onClick: closeOverlay }, h(IconCloseOutlineRegular, { size: 16 })))))),
      h('nav', { className: 'sf-tabs', 'aria-label': t('title') }, ...TABS.map(([id, key]) =>
        h('button', { type: 'button', key: id, 'aria-current': tab === id ? 'page' : undefined, onClick: () => { setTab(id); setDrillParams(null) } }, t(key)))),
      h('div', { className: `sf-content${briefState === 'loading' && !brief ? ' sf-refreshing' : ''}`, 'aria-busy': briefState === 'loading' && !brief }, body)))
}

function Button({ wide, t }) {
  return h(Tooltip, { label: t('open'), disabled: wide }, h('button', { type: 'button', className: `sf-button${wide ? ' sf-wide' : ''}`, 'aria-label': t('open'), onClick: openOverlay }, h(IconGaugeOutlineRegular, { size: wide ? 14 : 18 }), wide ? h('span', null, t('open')) : null))
}

function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, copy), 'dofe-sensteed-finance: dictionaries')
  ctx.effect(() => { window.addEventListener(OVERLAY_EVENT, closeOtherOverlay); return () => window.removeEventListener(OVERLAY_EVENT, closeOtherOverlay) }, 'dofe-sensteed-finance: exclusive-overlay')
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = '@dofe/dsh-sensteed-finance'; style.textContent = css + sfAnalysisGrid; document.head.appendChild(style); return () => style.remove() }, 'dofe-sensteed-finance: styles')
  // 深度分析入口走宿主 conversation 服务（由 desktop 宿主在浏览器侧注册）；
  // 通过惰性 getter 注入，避免插件客户端与宿主模块产生编译期耦合。
  ctx.effect(() => {
    globalThis.__sensteed_finance_conversation = () => ({ async send(prompt) {
      const sessions = ctx.get?.('sessions')
      const navigation = ctx.get?.('uiWorkspace')
      if (!sessions || !navigation) throw new Error('conversation_unavailable')
      const current = sessions.list.getSnapshot().ids.find(id => sessions.retainInfo(id).getSnapshot().retainedBy.mainView > 0)
      const id = current ?? await sessions.create()
      navigation.openSession(id)
      await sessions.using(id, { source: 'controllerOperation' }, async reference => {
        await reference.ready
        const scoped = sessions.scope(id)
        if (!scoped) throw new Error('session_unavailable')
        await scoped.conversation.send(prompt)
      })
    } })
    return () => { delete globalThis.__sensteed_finance_conversation }
  }, 'dofe-sensteed-finance: scoped conversation')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'dofe-sensteed-finance', order: 56, inject: () => ({ t }) }, Button))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dofe-sensteed-finance', order: 56, inject: () => ({ t }) }, Overlay))
}

function Overlay({ t }) {
  const visible = useSyncExternalStore(subscribe, snapshot, snapshot)
  return visible ? h(Dashboard, { t }) : null
}
