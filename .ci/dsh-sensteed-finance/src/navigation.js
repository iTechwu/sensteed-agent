// 与 Datasource 的任务入口同名；容器不同，业务目的地和上下文保持一致。
const FINANCE_NAVIGATION = [
  ['总览', [['overview', '工作台', 'overview']]],
  ['我的工作', [['budget-filing', '预算填报与审核', 'budget-filing'], ['filing-tasks', '待填报任务', 'filing', { section: 'assignments' }], ['filing-department', '部门填报', 'filing', { section: 'department' }], ['filing-records', '我的记录', 'filing', { section: 'mine' }]]],
  ['预算管理', [['engine', '全面预算', 'engine'], ['budget', '预算执行', 'budget'], ['compare-monthly', '月结滚动对比', 'comparisons', { mode: 'monthly' }], ['compare-yearly', '年度对比', 'comparisons', { mode: 'yearly' }], ['compare-versions', '预算版本对比', 'comparisons', { mode: 'versions' }]]],
  ['资金管理', [['cash', '资金分析', 'cash']]],
  ['经营分析', [['operations', '经营分析', 'operations']]],
  ['数据与异常', [['datacenter', '数据中心', 'datacenter'], ['sources', '来源记录', 'sources'], ['facts', '已发布事实', 'facts'], ['alerts', '预警中心', 'alerts']]],
  ['财务处理', [['review', '审核队列', 'review'], ['entry', '财务代录', 'entry'], ['filing-activities', '填报活动', 'filing', { section: 'tasks' }]]],
  ['身份与权限', [['identity-members', '成员与角色', 'identity', { directorySection: 'members' }], ['identity-directory', '组织通讯录', 'identity', { directorySection: 'directory' }], ['identity-employment', '部门归属', 'identity', { directorySection: 'employment' }], ['permissions', '功能与数据授权', 'permissions']]],
  ['更多工具', [['bom', '成本 BOM', 'bom'], ['analyze', 'AI 财务助手', 'analyze'], ['notifications', '通知中心', 'notifications']]],
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
    '/data-center': ['datacenter'],
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
  // 兼容旧通知/书签，代录不再承担填报和人员管理。
  if (pathname === '/data-entry') {
    const legacy = url.searchParams.get('tab')
    if (legacy === 'mine') route = ['filing', { section: 'mine' }]
    else if (legacy === 'dept') route = ['filing', { section: 'department' }]
    else if (legacy === 'tasks' || url.searchParams.has('task')) route = ['filing', { section: 'assignments' }]
  }
  if (!route) return null
  const params = { ...route[1] }
  if (pathname === '/budget') {
    if (['lines', 'ledger', 'matrix', 'month', 'variance'].includes(url.searchParams.get('view'))) params.view = url.searchParams.get('view')
    const line = url.searchParams.get('line')
    if (url.searchParams.has('line') && (!line || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(line))) return null
    if (line && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(line)) { params.lineId = line; params.view = 'lines' }
  }
  if (pathname === '/cash' && ['summary', 'plans', 'adjustments', 'revenue'].includes(url.searchParams.get('tab'))) params.view = url.searchParams.get('tab')
  const allowedFilters = pathname === '/budget' ? {
    recordType: ['SUBMITTED', 'ESTIMATED'], expense: ['PROJECT_OPERATION', 'FIXED_OPERATION', 'MODEL_SPECIFIC', 'NON_PROJECT'],
  } : pathname === '/cash' ? { planType: ['PURCHASE', 'OTHER', 'NEW_RETAIL', 'PR_PAYMENT', 'DIRECT_PARTS'] }
    : pathname === '/alerts' ? { status: ['OPEN', 'CONFIRMED', 'RESOLVED', 'IGNORED'], severity: ['INFO', 'WARN', 'CRITICAL'], alertType: ['BUDGET_OVERRUN', 'EXECUTION_SLOW', 'CASH_GAP', 'DATA_QUALITY'] } : {}
  for (const [key, values] of Object.entries(allowedFilters)) if (values.includes(url.searchParams.get(key))) params[key === 'expense' ? 'expenseType' : key] = url.searchParams.get(key)
  if (['/budget', '/cash', '/alerts'].includes(pathname)) {
    const month = url.searchParams.get('month')
    if (/^(?:[1-9]|1[0-2])$/.test(month || '')) params.month = month
    for (const [query, key] of [['dept', 'departmentId'], ['version', 'versionId']]) {
      const value = url.searchParams.get(query)
      if (value && /^[a-zA-Z0-9_-]{1,100}$/.test(value)) params[key] = value
    }
  }
  if (pathname === '/filing/budget' && url.searchParams.has('task') && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url.searchParams.get('task') || '')) return null
  const year = url.searchParams.get('year')
  if (year && /^\d{4}$/.test(year) && Number(year) >= 2000 && Number(year) <= 2100) params.year = year
  for (const [query, key] of [['org', 'orgId'], ['task', 'taskId']]) {
    const value = url.searchParams.get(query)
    if (value && /^[a-zA-Z0-9_-]{1,100}$/.test(value)) params[key] = value
  }
  return { tab: route[0], params }
}
