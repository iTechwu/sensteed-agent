// 与 Datasource 的任务入口同名；容器不同，业务目的地和上下文保持一致。
const FINANCE_NAVIGATION = [
  ['总览', [['overview', '工作台', 'overview']]],
  ['我的工作', [['budget-filing', '预算填报与审核', 'budget-filing'], ['filing-tasks', '待填报任务', 'filing', { section: 'assignments' }], ['filing-department', '部门填报', 'filing', { section: 'department' }], ['filing-records', '我的记录', 'filing', { section: 'mine' }]]],
  ['预算管理', [['engine', '全面预算', 'engine'], ['budget', '预算执行', 'budget'], ['compare-monthly', '月结滚动对比', 'comparisons', { mode: 'monthly' }], ['compare-yearly', '年度对比', 'comparisons', { mode: 'yearly' }], ['compare-versions', '预算版本对比', 'comparisons', { mode: 'versions' }]]],
  ['资金管理', [['cash', '资金分析', 'cash']]],
  ['经营分析', [['operations', '经营分析', 'operations']]],
  ['数据与异常', [['datacenter', '数据中心', 'datacenter'], ['costitems', '费用类别', 'costitems'], ['sources', '来源记录', 'sources'], ['facts', '已发布事实', 'facts'], ['alerts', '预警中心', 'alerts']]],
  ['财务处理', [['filing-activities', '填报活动', 'filing', { section: 'tasks' }], ['review', '审核队列', 'review'], ['entry', '财务代录', 'entry']]],
  ['身份与权限', [['identity-members', '成员与角色', 'identity', { directorySection: 'members' }], ['identity-directory', '组织通讯录', 'identity', { directorySection: 'directory' }], ['identity-employment', '部门归属', 'identity', { directorySection: 'employment' }], ['permissions', '功能与数据授权', 'permissions']]],
  ['更多工具', [['bom', '成本工程', 'bom'], ['analyze', 'AI 财务助手', 'analyze'], ['notifications', '通知中心', 'notifications']]],
]

function financeNavigationAllowed(item, identity) {
  if (!financeSectionAllowed(item[2], identity)) return false
  if (item[0] === 'filing-activities') return identity.financeWriter && identity.permissions?.includes('budget.activity.manage')
  return true
}

function financeNavigationItem(tab, params) {
  return FINANCE_NAVIGATION.flatMap(([, items]) => items).find(item => item[2] === tab &&
    Object.entries(item[3] || {}).every(([key, value]) => value === (params?.[key] ?? (key === 'section' ? 'assignments' : key === 'mode' ? 'monthly' : undefined))))
}

/** 同一填报活动内切页保留活动与年度；活动管理和其他业务不携带活动筛选。 */
function financeSidebarParams(item, tab, params, year) {
  const next = { ...item[3], year: String(year) }
  if (tab === 'filing' && item[2] === 'filing' && next.section !== 'tasks' && params?.taskId) next.taskId = params.taskId
  return next
}

// 与网页 readPlanMonths 一致：显式多月优先、过滤非法值、去重排序。
function financePlanMonths(months, month) {
  return [...new Set(String(months ?? month ?? '').split(',').filter(Boolean).map(Number).filter(value => Number.isInteger(value) && value >= 1 && value <= 12))].sort((a, b) => a - b)
}

/** 只接收本站业务路径；拒绝外站和未知路径，不把错误目的地静默改成工作台。 */
function financeBusinessDestination(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return null
  let url
  try { url = new URL(path, 'https://ds.hozonauto.com') } catch { return null }
  if (url.origin !== 'https://ds.hozonauto.com') return null
  const pathname = url.pathname.replace(/^\/(?:zh-CN|zh|en)(?=\/|$)/, '').replace(/\/$/, '') || '/'
  const routes = {
    '/': ['overview'], '/dashboard': ['overview'], '/budget': ['budget'], '/budget-engine': ['engine'],
    '/budget/comparison/monthly-roll': ['comparisons', { mode: 'monthly' }],
    '/budget/comparison/yearly': ['comparisons', { mode: 'yearly' }],
    '/budget/comparison/versions': ['comparisons', { mode: 'versions' }],
    '/cash': ['cash'], '/operations': ['operations'], '/alerts': ['alerts'],
    '/data-center': ['datacenter'], '/data-center/cost-items': ['costitems'],
    '/review': ['review'], '/data-entry': ['entry'], '/assistant': ['analyze'],
    '/cost-engineering': ['bom'], '/notifications': ['notifications'],
    '/settings/finance-permissions': ['permissions'],
    '/settings/identity/permissions': ['permissions'],
    '/settings/identity/members': ['identity', { directorySection: 'members' }],
    '/settings/identity/directory': ['identity', { directorySection: 'directory' }],
    '/settings/identity/employment': ['identity', { directorySection: 'employment' }],
    '/filing/budget': ['budget-filing'],
    '/filing/tasks': ['filing', { section: 'assignments' }],
    '/filing/department': ['filing', { section: 'department' }],
    '/filing/records': ['filing', { section: 'mine' }],
    '/filing/activities': ['filing', { section: 'tasks' }],
  }
  let route = routes[pathname]
  if (pathname === '/data-center' && url.hash === '#source-records') route = ['sources']
  // 资金页签的调整审批已移到审核队列（网页 /cash 审批同样移至工作台），旧链接保留入口不落空。
  if (pathname === '/cash' && url.searchParams.get('tab') === 'adjustments') route = ['review', { section: 'plans' }]
  // 兼容旧通知/书签，代录不再承担填报和人员管理。
  if (pathname === '/data-entry') {
    const legacy = url.searchParams.get('tab')
    if (legacy === 'mine') route = ['filing', { section: 'mine' }]
    else if (legacy === 'dept') route = ['filing', { section: 'department' }]
    else if (legacy === 'tasks' || url.searchParams.has('task')) route = ['filing', { section: 'assignments' }]
  }
  if (pathname === '/budget') {
    const legacy = { 'snapshot-compare': 'monthly', 'year-compare': 'yearly', versions: 'versions' }[url.searchParams.get('view')]
    if (legacy) route = ['comparisons', { mode: legacy }]
  }
  if (!route) return null
  if (route[0] === 'filing' && url.searchParams.has('task') && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url.searchParams.get('task')?.trim() || '')) return null
  const params = { ...route[1] }
  if (pathname === '/budget' && route[0] === 'budget') {
    for (const [query, key] of [['orgs', 'orgIds'], ['depts', 'departmentIds'], ['expenses', 'expenseTypes'], ['months', 'months']]) {
      if (!url.searchParams.has(query)) continue
      const values = [...new Set((url.searchParams.get(query) || '').split(',').filter(Boolean))]
      const valid = key === 'months' ? values.every(value => /^(?:[1-9]|1[0-2])$/.test(value)) : key === 'expenseTypes' ? values.every(value => ['PROJECT_OPERATION', 'FIXED_OPERATION', 'MODEL_SPECIFIC', 'NON_PROJECT'].includes(value)) : values.every(value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
      if (!valid || values.length > 200) return null
      params[key] = values
    }
    if (url.searchParams.get('unassigned') === '1') params.unassigned = true
    const page = Number(url.searchParams.get('page'))
    if (Number.isSafeInteger(page) && page > 0) params.page = page
    if (['lines', 'ledger', 'matrix', 'month', 'variance', 'adjustments', 'allocations', 'versions'].includes(url.searchParams.get('view'))) params.view = url.searchParams.get('view')
    const line = url.searchParams.get('line')
    if (url.searchParams.has('line') && (!line || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(line))) return null
    if (line && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(line)) { params.lineId = line; params.view = 'lines' }
  }
  if (pathname === '/cash') {
    const months = financePlanMonths(url.searchParams.get('months'), url.searchParams.get('month'))
    if (url.searchParams.has('months')) params.months = months
    const keyword = url.searchParams.get('q')?.trim()
    if (keyword && keyword.length > 200) return null
    if (keyword) params.keyword = keyword
    const incomeTypeName = url.searchParams.get('incomeTypeName')?.trim()
    if (incomeTypeName && incomeTypeName.length > 100) return null
    if (incomeTypeName) params.incomeTypeName = incomeTypeName
    if (url.searchParams.get('unassigned') === '1') params.unassigned = true
    const page = Number(url.searchParams.get('page'))
    if (Number.isSafeInteger(page) && page > 0) params.page = page
    const expenseType = url.searchParams.get('expenseType')
    if (['PROJECT_OPERATION', 'FIXED_OPERATION', 'MODEL_SPECIFIC', 'NON_PROJECT'].includes(expenseType)) params.expenseType = expenseType
  }
  if (pathname === '/cash' && ['summary', 'plans', 'revenue', 'accuracy'].includes(url.searchParams.get('tab'))) params.view = url.searchParams.get('tab')
  const allowedFilters = pathname === '/budget' ? {
    recordType: ['SUBMITTED', 'ESTIMATED'], expense: ['PROJECT_OPERATION', 'FIXED_OPERATION', 'MODEL_SPECIFIC', 'NON_PROJECT'],
  } : pathname === '/cash' ? { planType: ['PURCHASE', 'OTHER', 'NEW_RETAIL', 'PR_PAYMENT', 'DIRECT_PARTS'] }
    : pathname === '/alerts' ? { status: ['OPEN', 'CONFIRMED', 'RESOLVED', 'IGNORED'], severity: ['INFO', 'WARN', 'CRITICAL'], alertType: ['BUDGET_OVERRUN', 'EXECUTION_SLOW', 'CASH_GAP', 'DATA_QUALITY'] } : {}
  for (const [key, values] of Object.entries(allowedFilters)) if (values.includes(url.searchParams.get(key))) params[key === 'expense' ? 'expenseType' : key] = url.searchParams.get(key)
  if (['/budget', '/budget-engine', '/cash', '/alerts'].includes(pathname)) {
    const month = url.searchParams.get('month')
    if (/^(?:[1-9]|1[0-2])$/.test(month || '')) params.month = month
    for (const [query, key] of [['dept', 'departmentId'], ['version', 'versionId']]) {
      const value = url.searchParams.get(query)
      if (value && /^[a-zA-Z0-9_-]{1,100}$/.test(value) && value !== 'primary') params[key] = value
    }
  }
  if (pathname === '/filing/budget') {
    for (const [query, key] of [['task', 'taskId'], ['version', 'versionId']]) {
      const value = url.searchParams.get(query)
      if (url.searchParams.has(query) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '')) return null
      if (value) params[key] = value
    }
  }
  const year = url.searchParams.get('year')
  if (year && /^\d{4}$/.test(year) && Number(year) >= 2000 && Number(year) <= 2100) params.year = year
  for (const [query, key] of [['org', 'orgId'], ['task', 'taskId']]) {
    const value = url.searchParams.get(query)?.trim()
    if (value && /^[a-zA-Z0-9_-]{1,100}$/.test(value) && value !== 'primary') params[key] = value
  }
  if (params.orgId === 'all') params.orgId = ''
  if (params.orgId || params.orgIds?.length) delete params.unassigned
  return { tab: route[0], params }
}

/** 面板内的业务历史，仅保留当前会话最近20步；不缓存接口结果或未提交表单。 */
function useFinanceNavigation(initialYear) {
  const sequence = useRef(0)
  const [current, setCurrent] = useState(() => financeDesktopNavigation().recall() || ({ id: 0, tab: 'overview', params: null, year: initialYear, orgId: '', viewState: {}, scrollTop: 0 }))
  const [past, setPast] = useState([])
  const update = patch => setCurrent(route => ({ ...route, ...(typeof patch === 'function' ? patch(route) : patch) }))
  const navigate = (tab, params, scrollTop = 0) => {
    if (tab === current.tab && JSON.stringify(params) === JSON.stringify(current.params)) return
    setPast(history => [...history.slice(-19), { ...current, scrollTop }])
    setCurrent({ id: ++sequence.current, tab, params, year: String(params.year || current.year), orgId: params.orgId || '', viewState: {}, scrollTop: 0 })
  }
  const back = () => {
    if (!past.length) return
    setCurrent(past[past.length - 1]); setPast(history => history.slice(0, -1))
  }
  const reset = () => { setPast([]); setCurrent(route => ({ ...route, id: ++sequence.current, tab: 'overview', params: null, viewState: {}, scrollTop: 0 })) }
  return { current, previous: past[past.length - 1], update, navigate, back, reset }
}

/** 返回时等待异步列表撑开高度；用户主动操作后立即停止恢复。 */
function restoreFinanceScroll(element, top) {
  if (!element) return () => {}
  let observer = null
  const events = ['wheel', 'touchstart', 'pointerdown', 'keydown']
  const stop = () => { observer?.disconnect(); events.forEach(event => element.removeEventListener(event, stop)) }
  const restore = () => {
    element.scrollTop = top
    if (element.scrollHeight - element.clientHeight >= top) stop()
  }
  if (top > 0) {
    observer = new MutationObserver(restore)
    observer.observe(element, { childList: true, subtree: true, attributes: true })
    events.forEach(event => element.addEventListener(event, stop, { passive: true }))
  }
  restore()
  return stop
}
