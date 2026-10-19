import { needsCompleteList, completeFinanceList } from './lib/list-pagination.js'
// Sensteed 财务看板宿主端。浏览器只访问同源 /api/desktop/sensteed/finance* 路由；
// 所有 datasource 请求复用宿主飞书登录 token，由服务端验证身份与租户：
// 统计/录入走本插件的 MCP 代理（与 Agent 的 mcp__finance__* 同一数据面），口径完全一致。
// 身份来自宿主当前飞书会话，租户及操作者由 datasource 服务端再次校验。

import { randomUUID } from 'node:crypto'
import { PUBLIC_FINANCE_ROUTES, PUBLIC_QUERY_KEYS } from './public-routes.js'

const ROUTE_PREFIX = '/api/desktop/sensteed/finance'
// 财务页面是直连服务型插件：Datasource REST API 负责 SSO、租户和操作者校验。
// MCP 仅能经 ai.hozonauto.com/mcp 公共网关访问；财务页面的 REST 请求使用 Datasource 公共 API。
const DEFAULT_DATASOURCE_API_BASE_URL = 'https://ds.hozonauto.com/api'
const FINANCE_WORKSPACE_ACCESS_PATH = '/finance/permissions/workspace-access'
const REQUEST_TIMEOUT_MS = 30000
const MAX_BODY_BYTES = 256 * 1024

export const inject = ['webServer', 'credentials', 'tools', 'systemPrompt', 'dofeAuth', 'dofeAccess']
export const capabilities = Object.freeze([
  {
    "id": "finance-management",
    "kind": "business",
    "group": "business",
    "name": "财务经营分析",
    "description": "分析预算、台账、资金、经营预警与成本 BOM，查看数据治理看板。"
  }
])

/** Resolve the live Feishu session on every call; never trust a browser-supplied identity. */
async function resolveConfig(ctx) {
  const auth = ctx.dofeAuth ?? ctx.get?.('dofeAuth')
  const session = auth?.getDatasourceSession?.()
  return {
    token: session?.accessToken,
    tenantId: session?.tenantId,
    operatorId: session?.operator,
  }
}

export function apply(ctx, overrides = {}) {
  if (overrides.registerHostRoute === false) return undefined
  const fetchImpl = overrides.fetch || globalThis.fetch
  const now = overrides.now || (() => new Date())
  let accessCache

  const resolveWorkspaceAccess = async config => {
    const cacheKey = `${config.token}\0${config.tenantId}`
    if (accessCache?.key === cacheKey && accessCache.expiresAt > Date.now()) return accessCache.allowed
    try {
      const response = await timedFetch(fetchImpl, `${resolveDatasourceApiBaseUrl()}${FINANCE_WORKSPACE_ACCESS_PATH}`, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${config.token}` },
      })
      const payload = await response.json().catch(() => null)
      const allowed = response.status === 401 || response.status === 403 ? false
        : response.ok && typeof payload?.data?.allowed === 'boolean' ? payload.data.allowed : undefined
      accessCache = { key: cacheKey, allowed, expiresAt: Date.now() + (allowed === undefined ? 1000 : 5000) }
      return allowed
    } catch {
      accessCache = { key: cacheKey, allowed: undefined, expiresAt: Date.now() + 1000 }
      return undefined
    }
  }

  const disposers = []

  const canUseFinance = scope => {
    const gate = typeof ctx.dofeAccess === 'function' ? ctx.dofeAccess() : undefined
    return gate?.ready === true && gate.financeAllowed === true
      && ctx.tools?.schemas?.(scope).some(tool => tool.name.startsWith('mcp__finance__')) === true
  }
  let disposeBootstrap
  let reconciling = false
  let disposed = false
  const reconcileTools = () => {
    if (reconciling || disposed) return
    reconciling = true
    try {
      if (!canUseFinance()) {
        const old = disposeBootstrap
        disposeBootstrap = undefined
        old?.()
        return
      }
      if (disposeBootstrap) return
      disposeBootstrap = ctx.tools.register({
        name: 'sensteed_finance_bootstrap',
        description: '获取财务分析上下文：当前租户 ID、财务主体列表与可用的 mcp__finance__* 工具说明。做任何财务分析前先调用本工具。',
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        isConcurrencySafe: () => true,
        async execute() {
          const config = await resolveConfig(ctx)
          if (!config.tenantId) {
            return { ok: false, error: '请先使用飞书登录，再打开财务管理。' }
          }
          const allowed = await resolveWorkspaceAccess(config)
          if (allowed === undefined) return { ok: false, error: '财务权限服务暂不可用，请稍后重试。' }
          if (!allowed) {
            return { ok: false, error: '当前账号没有财务团队权限，无法使用财务管理。' }
          }
          const orgs = await financeApiCall(fetchImpl, config, 'finance_get_orgs', {}, now(), ctx.logger)
          if (!orgs.ok) return orgs
          return {
            ok: true,
            result: {
              tenantId: config.tenantId,
              operator: config.operatorId,
              orgs: orgs.data.list ?? orgs.data.orgs ?? [],
              usage: 'tenantId 用于所有 mcp__finance__* 工具入参；金额单位一律为元；分析首选 mcp__finance__finance_analysis_brief 建立口径基线。',
            },
          }
        },
      })
    } finally { reconciling = false }
  }
  reconcileTools()
  disposers.push(() => { disposed = true; disposeBootstrap?.(); disposeBootstrap = undefined })
  if (ctx.on) {
    disposers.push(ctx.on('dofe/access-changed', reconcileTools))
    disposers.push(ctx.on('tools/change', reconcileTools))
  }

  // 统一数据面：一个前缀路由内部分发（webServer 只有 exact/prefix 两种匹配）。
  // 渲染进程同源（官方 dofe-auth-route 同款边界）：代理持 INTERNAL_API_SECRET，
  // 且写路由会自动注入登录操作者，必须挡住本机其他进程与网页的伪造请求。
  const rendererOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  const sameOrigin = req => {
    const address = req.socket?.remoteAddress ?? ''
    const loopback = address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
    if (!loopback) return false
    const site = req.headers['sec-fetch-site']
    if (site !== undefined && site !== 'same-origin' && site !== 'none') return false
    if (req.method === 'GET') {
      // GET：同源导航/fetch 通常不带 Origin，仅在携带时校验（网页 CSRF 必带且必为跨站）
      return req.headers.origin === undefined || req.headers.origin === rendererOrigin
    }
    // POST：浏览器 fetch 必带 Origin；缺失或不同源一律拒绝
    if (req.headers.origin !== rendererOrigin) return false
    return req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
  }

  disposers.push(ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    async handler(req, res) {
      if (!sameOrigin(req)) {
        res.writeHead(403, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
        res.end()
        return
      }
      const config = await resolveConfig(ctx)
      if (!config.token || !config.tenantId) {
        ctx.logger?.info?.(`sensteed finance: ${req.method} ${safePathname(req.url)} rejected — live Feishu session not bound (token/tenant missing)`)
        return sendJson(res, 401, { ok: false, error: '请先使用飞书登录，再打开财务管理。' })
      }
      const pathname = safePathname(req.url)
      const sub = pathname.slice(ROUTE_PREFIX.length) || '/'
      const allowed = await resolveWorkspaceAccess(config)
      if (allowed === undefined) return sendJson(res, 503, { ok: false, error: '财务权限服务暂不可用，请稍后重试。' })
      const permission = new URL(req.url, rendererOrigin).searchParams.get('permission')
      if (sub === '/access' && permission) {
        if (!allowed) return sendJson(res, 200, { ok: true, allowed: false })
        const result = await financeApiCall(fetchImpl, config, 'finance_get_permissions', {}, now(), ctx.logger)
        if (!result.ok || !Array.isArray(result.data?.permissions)) return sendJson(res, 503, { ok: false, error: '财务功能权限服务暂不可用，请稍后重试。' })
        return sendJson(res, 200, { ok: true, allowed: result.data.permissions.includes(permission) })
      }
      if (sub === '/access') return sendJson(res, 200, { ok: true, allowed })
      if (!allowed) {
        ctx.logger?.info?.(`sensteed finance: ${req.method} ${sub} rejected — finance workspace access denied`)
        return sendJson(res, 403, { ok: false, error: '当前账号没有财务团队权限，无法使用财务管理。' })
      }
      if (sub.startsWith('/rest/')) return dispatchPublicContract(fetchImpl, config, sub.slice(5), req, res, ctx.logger)
      if (req.method === 'GET') return dispatchGet(fetchImpl, config, sub, req.url, res, ctx.logger)
      if (req.method === 'POST') return dispatchPost(fetchImpl, config, sub, req, res, ctx.logger)
      res.writeHead(405, { Allow: 'GET, POST', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end()
    },
  }))

  if (ctx.systemPrompt?.section) {
    disposers.push(ctx.systemPrompt.section({
      name: 'sensteed:finance-guidance',
      order: 8,
      text: context => canUseFinance(context?.scope) ? FINANCE_GUIDANCE : '',
    }))
  }

  return () => disposers.reverse().forEach(dispose => dispose?.())
}

// ---------------------------------------------------------------------------
// 路由分发：GET 统计面 / POST 录入与回填面
// ---------------------------------------------------------------------------

const QUERY_KEYS = ['orgIds', 'departmentIds', 'expenseTypes',
  'year', 'month', 'months', 'page', 'limit', 'severity', 'status', 'orgId', 'expenseType', 'recordType', 'planType',
  'versionId', 'departmentId', 'unassigned', 'operator', 'keyword', 'incomeTypeName', 'onlyUnmapped', 'systemUserId', 'days',
  'project', 'sortBy', 'sortDirection', 'alertType', 'baseVersionId', 'targetVersionId', 'planId', 'type', 'scope', 'kind', 'bizSystem', 'transport',
]

async function dispatchGet(fetchImpl, config, sub, url, res, logger) {
  const query = pickQuery(url)
  const tenant = () => ({ tenantId: config.tenantId })
  // 只接受宿主会话身份，忽略查询中的操作者。
  const operatorArg = () => {
    const operator = config.operatorId
    return operator ? { operator } : {}
  }
  let calls
  // 成本 BOM 仅暴露明确的只读端点；租户、能力与对象归属由 CE API 再次校验。
  if (sub === '/bom/packages') {
    return runGet([['finance_ce_packages', { page: query.page, limit: query.limit }]], res, logger, config, fetchImpl)
  }
  const bomDetail = sub.match(/^\/bom\/packages\/([\w-]+)(\/rollup)?$/)
  if (bomDetail) {
    return runGet([[bomDetail[2] ? 'finance_ce_rollup' : 'finance_ce_package', { id: bomDetail[1] }]], res, logger, config, fetchImpl)
  }
  // 路径含 ID 的详情路由（调整单/调增单状态流水）
  const detail = sub.match(/^\/budget-adjustments\/([\w-]+)$/)
  if (detail) {
    calls = [['finance_budget_adjustment_status_query', { ...tenant(), adjustmentId: detail[1] }]]
    return await runGet(calls, res, logger, config, fetchImpl)
  }
  const planDetail = sub.match(/^\/plan-adjustments\/([\w-]+)$/)
  if (planDetail) {
    calls = [['finance_plan_adjustment_status_query', { ...tenant(), adjustmentId: planDetail[1] }]]
    return await runGet(calls, res, logger, config, fetchImpl)
  }
  switch (sub) {
    case '/':
    case '/context':
      // 空租户时省略键，交由 MCP 端返回结构化 tenant_required，而不是 Zod min(1) 校验噪声
      calls = [['finance_get_orgs', config.tenantId ? { tenantId: config.tenantId } : {}]]
      // 部门列表供预算/排款的部门筛选；无租户时省略（渲染端按缺省处理）
      if (config.tenantId) calls.push(['finance_get_departments', { tenantId: config.tenantId }])
      break
    case '/brief': {
      const baseline = await financeApiCall(fetchImpl, config, 'finance_analysis_brief', { ...tenant(), year: query.year, orgId: query.orgId }, new Date(), logger)
      if (!baseline.ok) return sendJson(res, baseline.status || 502, baseline)
      return sendJson(res, 200, { ok: true, data: baseline.data })
    }
    case '/budget':
      calls = [
        ['finance_get_budget_summary', { ...tenant(), year: query.year, orgId: query.orgId, orgIds: query.orgIds, departmentIds: query.departmentIds, expenseTypes: query.expenseTypes, versionId: query.versionId, departmentId: query.departmentId, unassigned: query.unassigned === '1' ? true : undefined }],
        ['finance_get_budget_lines', {
          ...tenant(), year: query.year, orgId: query.orgId, orgIds: query.orgIds, departmentIds: query.departmentIds, expenseTypes: query.expenseTypes, months: query.months, versionId: query.versionId,
          departmentId: query.departmentId, unassigned: query.unassigned === '1' ? true : undefined,
          month: query.month, expenseType: query.expenseType, page: query.page, limit: query.limit,
        }],
      ]
      break
    case '/pr':
      calls = [['finance_get_payment_requests', { ...tenant(), year: query.year, orgId: query.orgId, orgIds: query.orgIds, month: query.month, recordType: query.recordType, page: query.page, limit: query.limit }]]
      break
    case '/payment-plans':
      calls = [['finance_get_payment_plans', {
        ...tenant(), year: query.year, orgId: query.orgId, departmentId: query.departmentId,
        unassigned: query.unassigned === '1' ? true : undefined,
        month: query.month, months: query.months, planType: query.planType, expenseType: query.expenseType, keyword: query.keyword, page: query.page, limit: query.limit,
      }]]
      break
    case '/revenue-plans':
      calls = [['finance_get_revenue_plans', { ...tenant(), year: query.year, orgId: query.orgId, month: query.month, months: query.months, incomeTypeName: query.incomeTypeName, keyword: query.keyword, page: query.page, limit: query.limit }]]
      break
    case '/cash':
      calls = [['finance_get_cash_summary', { ...tenant(), year: query.year, orgId: query.orgId }]]
      break
    case '/alerts':
      calls = [['finance_get_alerts', { ...(config.tenantId ? { tenantId: config.tenantId } : {}), year: query.year, orgId: query.orgId, month: query.month, alertType: query.alertType, severity: query.severity, status: query.status, page: query.page, limit: query.limit }]]
      break
    case '/quality':
      calls = [['finance_get_data_quality', {}], ['finance_get_import_batches', { page: query.page, limit: query.limit }]]
      break
    case '/departments':
      calls = [['finance_get_departments', tenant()]]
      break
    case '/alerts-summary':
      calls = [['finance_get_alert_summary', { ...tenant(), year: query.year, orgId: query.orgId }]]
      break
    case '/alert-rules':
      calls = [['finance_get_alert_rules', tenant()]]
      break
    case '/budget-versions':
      calls = [['finance_get_budget_versions', { ...tenant(), year: query.year }]]
      break
    case '/budget-version-diff':
      calls = [['finance_get_budget_version_diff', { ...tenant(), year: query.year, baseVersionId: query.baseVersionId, targetVersionId: query.targetVersionId }]]
      break
    case '/carryover-rules':
      calls = [['finance_get_carryover_rules', tenant()]]
      break
    case '/saved-views':
      calls = [['finance_get_saved_views', { ...tenant(), ...operatorArg() }]]
      break
    case '/members':
      calls = [['finance_get_members', { ...tenant(), ...operatorArg() }]]
      break
    case '/employment-records':
      calls = [['finance_get_employment_records', { ...tenant(), systemUserId: query.systemUserId, departmentId: query.departmentId, page: query.page, limit: query.limit }]]
      break
    case '/contacts':
      calls = [['finance_directory_contacts_query', { ...tenant(), keyword: query.keyword, onlyUnmapped: query.onlyUnmapped, page: query.page, limit: query.limit }]]
      break
    case '/data-source-configs':
      calls = [['finance_get_data_source_configs', { ...tenant(), scope: query.scope, kind: query.kind, page: query.page, limit: query.limit }]]
      break
    case '/data-source-runs':
      calls = [['finance_get_data_source_runs', { ...tenant(), scope: query.scope, status: query.status, bizSystem: query.bizSystem, transport: query.transport, page: query.page, limit: query.limit }]]
      break
    case '/data-source-metrics':
      calls = [['finance_get_data_source_metrics', { ...tenant(), scope: query.scope, days: query.days }]]
      break
    case '/budget-adjustments':
      calls = [['finance_budget_adjustment_list', { ...tenant(), status: query.status, page: query.page, limit: query.limit }]]
      break
    case '/plan-adjustments':
      calls = [['finance_plan_adjustment_list', { ...tenant(), status: query.status, planId: query.planId, page: query.page, limit: query.limit }]]
      break
    case '/allocations':
      calls = [['finance_allocation_list', { ...tenant(), page: query.page, limit: query.limit }]]
      break
    case '/allocations-pool':
      calls = [['finance_allocation_pool_query', { ...tenant(), year: query.year }]]
      break
    case '/availability':
      calls = [['finance_budget_availability_query', { ...tenant(), year: query.year, orgId: query.orgId }]]
      break
    case '/filing-tasks':
      calls = [['finance_filing_task_list', { ...tenant(), status: query.status, type: query.type, year: query.year, page: query.page, limit: query.limit }]]
      break
    case '/cost-items':
      calls = [['finance_get_cost_items', tenant()]]
      break
    case '/filing-assignments':
      calls = [['finance_filing_assignments_query', { ...tenant(), ...operatorArg(), departmentId: query.departmentId, status: query.status, year: query.year, page: query.page, limit: query.limit }]]
      break
    default:
      return sendJson(res, 404, { ok: false, error: `unknown path: ${sub}` })
  }
  if (sub !== '/quality' && sub !== '/' && sub !== '/context' && !config.tenantId) {
    return sendJson(res, 400, { ok: false, error: '请先使用飞书登录，再打开财务管理。' })
  }
  return await runGet(calls, res, logger, config, fetchImpl, sub === '/' || sub === '/context')
}

/** 执行一组 REST 调用并按块降级拼装响应（部分失败保留成功块） */
async function runGet(calls, res, logger, config, fetchImpl, context = false) {
  const results = await Promise.all(calls.map(([name, args]) => financeApiCall(fetchImpl, config, name, args, new Date(), logger)))
  const okAll = results.every(result => result.ok)
  // 部分失败时保留成功部分：看板按 {ok, data|各命名块} 逐块降级渲染。
  const payload = { ok: okAll }
  if (context) {
    payload.data = {
      orgs: results[0]?.data?.orgs ?? results[0]?.data?.list ?? [],
      departments: results[1]?.data?.list ?? [],
    }
  } else if (results.length === 1) {
    payload.data = results[0].ok ? results[0].data : null
  } else {
    for (const [index, [name]] of calls.entries()) {
      payload[streamKey(name)] = results[index].ok ? results[index].data : { error: results[index].error }
    }
  }
  if (!okAll) payload.error = results.find(result => !result.ok).error
  return sendJson(res, results.some(result => result.ok) ? 200 : results[0]?.status || 502, payload)
}

function streamKey(toolName) {
  if (toolName === 'finance_get_budget_summary') return 'summary'
  if (toolName === 'finance_get_budget_lines') return 'lines'
  if (toolName === 'finance_get_data_quality') return 'quality'
  if (toolName === 'finance_get_import_batches') return 'batches'
  return toolName.replace(/^finance_/, '')
}

// 写路由表：pattern 捕获组经 map(m) 注入工具入参（id/assignmentId/action 等）；
// needsOperator=false 的工具入参无 operator 字段（数据源/通讯录类自身留痕）。
const WRITE_ROUTES = [
  { pattern: /^\/contacts-sync$/, tool: 'finance_directory_sync', needsOperator: false },
  { pattern: /^\/payment-plans$/, tool: 'finance_create_payment_plan' },
  { pattern: /^\/revenue-plans$/, tool: 'finance_create_revenue_plan' },
  { pattern: /^\/budget-lines$/, tool: 'finance_create_budget_line' },
  { pattern: /^\/payment-plans\/([\w-]+)\/actuals$/, tool: 'finance_patch_payment_plan_actuals', map: m => ({ id: m[1] }) },
  { pattern: /^\/payment-plans\/([\w-]+)\/schedule$/, tool: 'finance_patch_payment_plan_schedule', map: m => ({ id: m[1] }) },
  { pattern: /^\/revenue-plans\/([\w-]+)\/actuals$/, tool: 'finance_patch_revenue_plan_actuals', map: m => ({ id: m[1] }) },
  { pattern: /^\/alerts\/run$/, tool: 'finance_run_alert_engine', needsOperator: false },

  // 预警规则集 / 预算版本 / 递延规则 / 保存视图
  { pattern: /^\/alert-rules\/confirm$/, tool: 'finance_confirm_alert_rules' },
  { pattern: /^\/budget-versions\/([\w-]+)\/action$/, tool: 'finance_budget_version_action', map: m => ({ id: m[1] }) },
  { pattern: /^\/carryover-rules$/, tool: 'finance_carryover_rule_action' },
  { pattern: /^\/saved-views$/, tool: 'finance_save_view' },
  { pattern: /^\/saved-views\/delete$/, tool: 'finance_delete_saved_view' },

  // 成员与角色 / 通讯录 / 归属记录
  { pattern: /^\/members$/, tool: 'finance_upsert_member' },
  { pattern: /^\/members\/([\w-]+)\/remove$/, tool: 'finance_remove_member', map: m => ({ id: m[1] }) },
  { pattern: /^\/contacts\/([\w-]+)\/map-user$/, tool: 'finance_directory_map_user', map: m => ({ contactId: m[1] }), needsOperator: false },
  { pattern: /^\/employment-records$/, tool: 'finance_create_employment_record', needsOperator: false },

  // 填报：任务 / 指派行 / 指派状态
  { pattern: /^\/filing-tasks$/, tool: 'finance_filing_task_create' },
  { pattern: /^\/filing-tasks\/([\w-]+)\/close$/, tool: 'finance_filing_task_close', map: m => ({ id: m[1] }) },
  { pattern: /^\/filing-assignments\/([\w-]+)\/rows$/, tool: 'finance_filing_rows_upsert', map: m => ({ assignmentId: m[1] }) },
  { pattern: /^\/filing-assignments\/([\w-]+)\/(submit|commit|reopen)$/, tool: 'finance_filing_assignment_action', map: m => ({ id: m[1], action: m[2] }) },

  // 预算调整审批流
  { pattern: /^\/budget-adjustments$/, tool: 'finance_budget_adjustment_create' },
  { pattern: /^\/budget-adjustments\/([\w-]+)\/submit$/, tool: 'finance_budget_adjustment_submit', map: m => ({ adjustmentId: m[1] }) },
  { pattern: /^\/budget-adjustments\/([\w-]+)\/(approve|reject)$/, tool: 'finance_budget_adjustment_review', map: m => ({ id: m[1], action: m[2] }) },
  { pattern: /^\/budget-adjustments\/([\w-]+)\/post$/, tool: 'finance_budget_adjustment_post', map: m => ({ id: m[1] }) },
  { pattern: /^\/budget-adjustments\/([\w-]+)\/cancel$/, tool: 'finance_budget_adjustment_cancel', map: m => ({ id: m[1] }) },

  // 付款计划调增审批流（发起即提交）
  { pattern: /^\/plan-adjustments$/, tool: 'finance_payment_plan_increase_request' },
  { pattern: /^\/plan-adjustments\/([\w-]+)\/(approve|reject)$/, tool: 'finance_plan_adjustment_review', map: m => ({ id: m[1], action: m[2] }) },
  { pattern: /^\/plan-adjustments\/([\w-]+)\/post$/, tool: 'finance_plan_adjustment_post', map: m => ({ id: m[1] }) },
  { pattern: /^\/plan-adjustments\/([\w-]+)\/cancel$/, tool: 'finance_plan_adjustment_cancel', map: m => ({ id: m[1] }) },

  // 预算分配 / 数据源控制台
  { pattern: /^\/allocations$/, tool: 'finance_allocation_confirm' },
  { pattern: /^\/allocations\/([\w-]+)\/remove$/, tool: 'finance_allocation_remove', map: m => ({ id: m[1] }) },
  { pattern: /^\/data-source-configs\/([\w-]+)\/active$/, tool: 'finance_toggle_data_source_config', map: m => ({ id: m[1] }), needsOperator: false },
  { pattern: /^\/data-source-configs$/, tool: 'finance_upsert_data_source_config', needsOperator: false },
  { pattern: /^\/data-source-sync$/, tool: 'finance_sync_data_source', needsOperator: false },
]

async function dispatchPost(fetchImpl, config, sub, req, res, logger) {
  if (!config.tenantId) {
    return sendJson(res, 400, { ok: false, error: '请先使用飞书登录，再打开财务管理。' })
  }
  const match = WRITE_ROUTES.find(route => route.pattern.test(sub))
  if (!match) return sendJson(res, 404, { ok: false, error: `unknown path: ${sub}` })
  const body = await readJsonBody(req)
  if (body.error) return sendJson(res, 400, { ok: false, error: body.error })
  const captures = sub.match(match.pattern) || []
  const args = {
    ...body.json,
    ...(match.map ? match.map(captures) : {}),
    tenantId: config.tenantId,
    operator: config.operatorId,
    idempotencyKey: body.json.idempotencyKey || randomUUID(),
  }
  const result = await financeApiCall(fetchImpl, config, match.tool, args, new Date(), logger)
  return sendJson(res, result.ok ? 200 : result.status || 502, result)
}

// ---------------------------------------------------------------------------
// Datasource REST 适配层：页面调用公开业务 API，身份由 Bearer SSO 会话解析。
// tenantId/operator/idempotencyKey 是旧 MCP 工具的控制字段，REST 端由会话和
// 服务端审计上下文负责，不能从浏览器或插件参数覆盖。
// ---------------------------------------------------------------------------

async function financeApiCall(fetchImpl, config, toolName, args, observedAt, logger) {
  if (!config.token) return { ok: false, error: '请先使用飞书登录，再打开财务管理。' }
  try {
    if (toolName === 'finance_analysis_brief') {
      const year = args.year === undefined ? undefined : Number(args.year)
      const scope = { year, orgId: args.orgId }
      const calls = [
        ['overview', 'finance_get_overview', scope],
        ['budget', 'finance_get_budget_summary', scope],
        ['cash', 'finance_get_cash_summary', scope],
        ['alertsSummary', 'finance_get_alert_summary', scope],
        ['openAlerts', 'finance_get_alerts', { ...scope, status: 'OPEN', limit: 10 }],
        ['dataQuality', 'finance_get_data_quality', {}],
        ['recentImportBatches', 'finance_get_import_batches', { page: 1, limit: 5 }],
      ]
      const results = await Promise.all(calls.map(([, name, callArgs]) => financeApiCall(fetchImpl, config, name, callArgs, observedAt, logger)))
      if (!results[0].ok) return results[0]
      const data = { year, errors: {} }
      calls.forEach(([key], index) => {
        const result = results[index]
        if (!result.ok) { data.errors[key] = result.error; return }
        data[key] = key === 'openAlerts' || key === 'recentImportBatches' ? result.data?.list || [] : result.data
      })
      return { ok: true, data, meta: { asOf: observedAt.toISOString() } }
    }

    if (toolName === 'finance_budget_availability_query') {
      const lines = await financeApiCall(fetchImpl, config, 'finance_get_budget_lines', { year: args.year, orgId: args.orgId, limit: 500 }, observedAt, logger)
      if (!lines.ok) return lines
      return { ok: true, data: buildBudgetAvailability(lines.data), meta: { asOf: observedAt.toISOString() } }
    }

    if (toolName === 'finance_payment_plan_increase_request') {
      const create = await financeApiCall(fetchImpl, config, '__create_payment_plan_adjustment', {
        planId: args.planId,
        newAmount: args.newAmount,
        reason: args.reason,
      }, observedAt, logger)
      if (!create.ok) return create
      const adjustmentId = create.data?.id || create.data?.adjustment?.id
      if (!adjustmentId) return { ok: false, error: 'invalid_adjustment_response' }
      return financeApiCall(fetchImpl, config, '__submit_payment_plan_adjustment', { adjustmentId }, observedAt, logger)
    }

    const route = resolveFinanceRoute(toolName, args)
    if (!route) return { ok: false, error: 'finance_tool_unavailable' }
    const query = route.method === 'GET' ? stripPathFields(stripControlFields(args)) : undefined
    const complete = route.method === 'GET' && needsCompleteList(route.path, query)
    if (complete) Object.assign(query, {page: 1, limit: 200})
    const body = route.method === 'GET' || route.method === 'DELETE' ? undefined : stripPathFields(stripControlFields(route.body ?? args))
    const url = buildFinanceUrl(route.path, query)
    const response = await timedFetch(fetchImpl, url, {
      method: route.method,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-api-version': '1',
        authorization: `Bearer ${config.token}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (response.status === 401 || response.status === 403) {
      logger?.info?.(`sensteed finance: ${toolName} upstream ${response.status} — datasource rejected the live session`)
      return { ok: false, status: response.status, error: response.status === 401
        ? '飞书登录已失效，请重新登录后重试。'
        : '当前账号没有此项财务操作权限，请联系财务负责人确认授权。' }
    }
    if (!response.ok) {
      logger?.info?.(`sensteed finance: ${toolName} upstream http ${response.status}`)
      const payload = await response.json().catch(() => null)
      return { ok: false, status: response.status, error: financeErrorMessage(payload, response.status) }
    }
    const payload = await response.json()
    if (payload?.code !== undefined && !isSuccessfulDatasourceCode(payload.code)) {
      logger?.info?.(`sensteed finance: ${toolName} datasource business code ${payload.code} msg ${payload.msg ?? '∅'} — data ${payload.data === undefined ? 'absent' : 'present'}`)
      return { ok: false, error: payload.msg || '财务操作失败' }
    }
    let data = payload?.data
    if (data === undefined) return { ok: false, error: 'empty_result' }
    if (complete) data = await completeFinanceList(data, async pagination => {
      const next = await financeApiCall(fetchImpl, config, toolName, { ...args, ...pagination }, observedAt, logger)
      if (!next.ok) throw new Error(next.error)
      return next.data
    })
    return { ok: true, data, meta: { asOf: observedAt.toISOString() } }
  } catch (error) {
    logger?.info?.(`sensteed finance: REST call ${toolName} failed: ${String(error)}`)
    return { ok: false, error: error?.name === 'TimeoutError' ? 'upstream_timeout' : 'upstream_unreachable' }
  }
}

function isSuccessfulDatasourceCode(code) {
  return code === 0 || code === 200 || code === '0' || code === '200'
}

function stripControlFields(value = {}) {
  const result = { ...value }
  delete result.tenantId
  delete result.operator
  delete result.idempotencyKey
  return Object.fromEntries(Object.entries(result).filter(([, item]) => item !== undefined))
}

function stripPathFields(value = {}) {
  const result = { ...value }
  for (const key of ['id', 'adjustmentId', 'assignmentId', 'planId', 'contactId', 'action']) delete result[key]
  return result
}

function buildFinanceUrl(path, query) {
  const base = resolveDatasourceApiBaseUrl()
  const url = new URL(`${base.replace(/\/$/u, '')}${path}`)
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

function resolveDatasourceApiBaseUrl() {
  const configured = process.env.DATASOURCE_API_BASE_URL
  if (!configured) return DEFAULT_DATASOURCE_API_BASE_URL
  try {
    const url = new URL(configured)
    if (url.protocol === 'https:' && url.hostname === 'ds.hozonauto.com' && (url.pathname === '/api' || url.pathname === '/api/')) {
      return url.toString().replace(/\/$/u, '')
    }
  } catch { /* invalid override falls back to the allowlisted public origin */ }
  return DEFAULT_DATASOURCE_API_BASE_URL
}

function buildBudgetAvailability(data = {}) {
  const lines = (data.list || []).map(line => {
    const budget = Number(line.budgetAmount ?? 0)
    const available = line.availableAmount == null ? null : Number(line.availableAmount)
    const occupied = available === null ? null : budget - available
    return {
      budgetLineId: line.id,
      orgName: line.orgName,
      departmentName: line.departmentName,
      costItemName: line.costItemName,
      month: line.month,
      budget,
      occupied,
      available,
    }
  })
  const sorted = [...lines].sort((a, b) => a.available - b.available)
  return {
    total: {
      budget: lines.reduce((sum, line) => sum + line.budget, 0),
      occupied: lines.every(line => line.occupied !== null) ? lines.reduce((sum, line) => sum + line.occupied, 0) : null,
      available: lines.every(line => line.available !== null) ? lines.reduce((sum, line) => sum + line.available, 0) : null,
    },
    tightestLines: sorted.filter(line => line.available !== null && line.available < 0).slice(0, 10),
    sample: sorted.slice(0, 20),
    lineCount: lines.length,
  }
}

function resolveFinanceRoute(toolName, args = {}) {
  const routes = {
    finance_get_permissions: ['GET', '/finance/permissions/me'],
    finance_ce_packages: ['GET', '/ce/packages'],
    finance_ce_package: ['GET', `/ce/packages/${args.id}`],
    finance_ce_rollup: ['GET', `/ce/packages/${args.id}/rollup`],
    finance_get_orgs: ['GET', '/finance/orgs'],
    finance_get_departments: ['GET', '/finance/departments'],
    finance_get_members: ['GET', '/finance/members'],
    finance_upsert_member: ['POST', '/finance/members'],
    finance_remove_member: ['POST', `/finance/members/${args.id}/remove`],
    finance_get_overview: ['GET', '/finance/overview'],
    finance_get_budget_summary: ['GET', '/finance/budget/summary'],
    finance_get_budget_lines: ['GET', '/finance/budget/lines'],
    finance_get_payment_requests: ['GET', '/finance/payment-requests'],
    finance_get_payment_plans: ['GET', '/finance/payment-plans'],
    finance_get_revenue_plans: ['GET', '/finance/revenue-plans'],
    finance_get_cash_summary: ['GET', '/finance/cash-summary'],
    finance_get_alerts: ['GET', '/finance/alerts'],
    finance_get_data_quality: ['GET', '/finance/data-quality'],
    finance_get_import_batches: ['GET', '/finance/import-batches'],
    finance_create_payment_plan: ['POST', '/finance/payment-plans'],
    finance_create_revenue_plan: ['POST', '/finance/revenue-plans'],
    finance_create_budget_line: ['POST', '/finance/budget/lines'],
    finance_patch_payment_plan_actuals: ['PATCH', `/finance/payment-plans/${args.id}/actuals`],
    finance_patch_revenue_plan_actuals: ['PATCH', `/finance/revenue-plans/${args.id}/actuals`],
    finance_run_alert_engine: ['POST', '/finance/alerts/run'],
    finance_budget_adjustment_create: ['POST', '/finance/budget/adjustments'],
    finance_budget_adjustment_submit: ['POST', `/finance/budget/adjustments/${args.adjustmentId}/submit`],
    finance_budget_adjustment_status_query: ['GET', `/finance/budget/adjustments/${args.adjustmentId}`],
    finance_budget_adjustment_list: ['GET', '/finance/budget/adjustments'],
    finance_budget_adjustment_review: ['POST', `/finance/budget/adjustments/${args.id}/${args.action}`],
    finance_budget_adjustment_post: ['POST', `/finance/budget/adjustments/${args.id}/post`],
    finance_budget_adjustment_cancel: ['POST', `/finance/budget/adjustments/${args.id}/cancel`],
    finance_filing_assignments_query: ['GET', '/finance/filing/assignments'],
    finance_get_cost_items: ['GET', '/finance/cost-items'],
    finance_filing_rows_upsert: ['PUT', `/finance/filing/assignments/${args.assignmentId}/rows`],
    finance_filing_task_list: ['GET', '/finance/filing/tasks'],
    finance_filing_task_create: ['POST', '/finance/filing/tasks'],
    finance_filing_task_close: ['POST', `/finance/filing/tasks/${args.id}/close`],
    finance_filing_assignment_action: ['POST', `/finance/filing/assignments/${args.id}/${args.action}`],
    finance_plan_adjustment_list: ['GET', '/finance/payment-plan-adjustments'],
    finance_plan_adjustment_status_query: ['GET', `/finance/payment-plan-adjustments/${args.adjustmentId}`],
    finance_plan_adjustment_review: ['POST', `/finance/payment-plan-adjustments/${args.id}/${args.action}`],
    finance_plan_adjustment_post: ['POST', `/finance/payment-plan-adjustments/${args.id}/post`],
    finance_plan_adjustment_cancel: ['POST', `/finance/payment-plan-adjustments/${args.id}/cancel`],
    finance_allocation_pool_query: ['GET', '/finance/allocations/pool'],
    finance_allocation_confirm: ['POST', '/finance/allocations/confirm'],
    finance_allocation_remove: ['POST', `/finance/allocations/${args.id}/remove`],
    finance_allocation_list: ['GET', '/finance/allocations'],
    finance_directory_sync: ['POST', '/finance/feishu/directory/sync'],
    finance_employment_resolve: ['GET', '/finance/employment/resolve'],
    finance_directory_contacts_query: ['GET', '/finance/feishu/contacts'],
    finance_directory_map_user: ['POST', `/finance/feishu/contacts/${args.contactId}/map-user`],
    finance_get_employment_records: ['GET', '/finance/employment/records'],
    finance_create_employment_record: ['POST', '/finance/employment/records'],
    finance_get_budget_versions: ['GET', '/finance/budget/versions'],
    finance_get_budget_version_diff: ['GET', '/finance/budget/versions/diff'],
    finance_get_carryover_rules: ['GET', '/finance/carryover-rules'],
    finance_get_alert_rules: ['GET', '/finance/alert-rules'],
    finance_confirm_alert_rules: ['POST', '/finance/alert-rules/confirm'],
    finance_get_saved_views: ['GET', '/finance/saved-views'],
    finance_save_view: ['POST', '/finance/saved-views'],
    finance_delete_saved_view: ['POST', '/finance/saved-views/delete'],
    finance_get_alert_summary: ['GET', '/finance/alerts/summary'],
    finance_get_data_source_configs: ['GET', '/data-source/configs'],
    finance_get_data_source_runs: ['GET', '/data-source/runs'],
    finance_get_data_source_metrics: ['GET', '/data-source/metrics'],
    finance_upsert_data_source_config: ['PUT', '/data-source/configs'],
    finance_sync_data_source: ['POST', '/data-source/runs/sync'],
    finance_toggle_data_source_config: ['PATCH', `/data-source/configs/${args.id}/active`],
  }
  if (toolName === 'finance_patch_payment_plan_schedule') return { method: 'PATCH', path: `/finance/payment-plans/${args.id}/schedule`, body: args }
  if (toolName === 'finance_budget_version_action') {
    const path = args.action === 'clone' ? `/finance/budget/versions/${args.id}/clone` : `/finance/budget/versions/${args.id}/${args.action}`
    return { method: 'POST', path, body: args.action === 'clone' ? { newName: args.newName } : {} }
  }
  if (toolName === 'finance_carryover_rule_action') {
    if (args.action === 'create') return { method: 'POST', path: '/finance/carryover-rules', body: args }
    return { method: 'POST', path: `/finance/carryover-rules/${args.id}/${args.action === 'toggle' ? 'toggle' : 'remove'}`, body: {} }
  }
  if (toolName === '__create_payment_plan_adjustment') return { method: 'POST', path: `/finance/payment-plans/${args.planId}/adjustments`, body: args }
  if (toolName === '__submit_payment_plan_adjustment') return { method: 'POST', path: `/finance/payment-plan-adjustments/${args.adjustmentId}/submit`, body: {} }
  const entry = routes[toolName]
  if (!entry) return null
  return { method: entry[0], path: entry[1] }
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function pickQuery(url) {
  const query = {}
  try {
    const params = new URL(url || ROUTE_PREFIX, 'https://dsh.local').searchParams
    for (const key of QUERY_KEYS) {
      const value = params.get(key)
      if (value !== null && value !== '') query[key] = value
    }
  } catch { /* 空 query 视为全默认 */ }
  return query
}

function safePathname(url) {
  try { return new URL(url || ROUTE_PREFIX, 'https://dsh.local').pathname } catch { return ROUTE_PREFIX }
}

async function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) return { error: 'body too large' }
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return { json: {} }
  try {
    const json = JSON.parse(raw)
    if (!json || typeof json !== 'object' || Array.isArray(json)) return { error: 'body must be a JSON object' }
    return { json }
  } catch { return { error: 'invalid JSON body' } }
}

async function timedFetch(fetchImpl, url, init) {
  return fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'error' })
}

function sendJson(res, status, body) {
  const value = JSON.stringify(body)
  res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(value), 'X-Content-Type-Options': 'nosniff' })
  res.end(value)
}

// ---------------------------------------------------------------------------
// 财务分析 guidance：教 Agent 用 mcp__finance__* 做深度分析并以财务口吻输出
// ---------------------------------------------------------------------------

const FINANCE_GUIDANCE = `你是资深的财务分析师（CFO 视角），可使用 mcp__finance__* 工具读取与写入财务数据中心（datasource.dofe.ai）。分析纪律：

【口径】金额沿用工具响应单位（通常元）；预算、已打 PR、预计 PR、无 PR、实际付款分列，执行率=已打PR/预算，实际支付率=实际付款/预算，分母非正/缺失不算百分比。合计比率用金额合计相除；预算已含调剂，不重复增加 netTransferAmount，不跨月相加 availableCumulative。budgetVersionId=null 表示无已发布基线。null 不当作零；引用数字说明主体、期间和版本/口径，meta.generatedAt 不代表业务数据新鲜度。

【工作流】先调 sensteed_finance_bootstrap，沿用可信身份和用户指定范围；工具以当前暴露的 schema 为准，不猜参数或拓宽范围。finance_analysis_brief 是可选年度快照（预警Top10/批次Top5并非全量），按需分别读预算、资金、计划、PR和质量工具，明细分页取齐并去重；失败/部分覆盖时披露限制。部门/版本筛选用支持该参数的明细，不把年度汇总当部门明细。深度分析调用的九个 finance-* skill 均为只读任务，不因本 guidance 列有写工具而取得修改、确认或刷新引擎的授权。

【风险预判框架】区分正式预警和分析发现；严重度与阈值以生效规则和 metrics 快照为准，不硬编码20%/30%。规则未生效时阈值类预警可能为空，数据质量预警仍可存在；无预警不等于无风险。分析已结束月、当前月和未来月的差别，不能把未来低执行判为滞后。每项给出可支持的影响金额、主体/期间、证据、判断依据和建议；未知金额不补造。finance_get_alert_summary 是年度当前 OPEN 存量，不能当近30天事件量；lastSeenAt 也不是新增时间。

【成本与资金框架】按返回的全部费用类别和未分类项分析，不限于旧三类；MODEL_SPECIFIC 指车型专属。预算、PR承诺、付款和计划不能直接叠加为成本或现金敞口。预测用可比完整月份，缺月不补零，避免历史运行率与计划重复计算；少量样本的情景区间不是统计置信区间。PUBLISHED_FACTS 可能没有余额，缺可靠期初只分析净收支，不编造月末余额或资金缺口；计划实际记录不冒充已核验银行流水。具体流程、公式与证据要求使用对应技能。

【版本与规则纪律（v0.4）】① 预算版本：finance_get_budget_versions 查看主版本与草稿；版本推进链路=审定（confirm）→生效（activate，切主版本）→锁定（lock），用 finance_budget_version_action；对比两版本用 finance_get_budget_version_diff；结转口径用 finance_get_carryover_rules。引用预算数字须说明所属版本与是否主版本。② 预警规则集：finance_get_alert_rules 查看版本与阈值；确认生效用 finance_confirm_alert_rules（仅财务负责人，须复述阈值）。③ 保存视图：finance_save_view / finance_get_saved_views 可沉淀分析口径。

【预算调整与填报】调整审批流与填报是写通道，必须按用户明确指令操作：① 查可用预算用 finance_budget_availability_query（采用服务端 availableAmount，月度累计采用 availableCumulative；不得在客户端再扣减分配或重算），批预算前必查并引用具体 budgetLineId；② 预算新增/调拨/追减用 finance_budget_adjustment_create 建草稿（调拨须调入=调出且调出行带 budgetLineId），复述要素确认后 finance_budget_adjustment_submit 提交；审批（finance_budget_adjustment_review）与过账（finance_budget_adjustment_post）由财务本人执行，Agent 不代批——仅在用户明确指示本人审批时调用；进度用 finance_budget_adjustment_status_query。③ 付款计划调增或调减用 finance_payment_plan_increase_request（兼容既有工具名，创建即提交；调减不得低于已知实付），审批/过账纪律同上。④ 分配：finance_allocation_pool_query 查待认领池，finance_allocation_confirm 挂账，finance_allocation_remove 撤销。⑤ 填报：finance_filing_task_list/_task_create 管理任务，finance_filing_assignments_query 查部门填报，finance_filing_rows_upsert 代暂存，finance_filing_assignment_action 提交/定稿/重开（重开必须带原因入审计）。

【幂等与身份】所有写工具必须提供独立业务 idempotencyKey，同一操作重试复用该键。操作者使用 bootstrap 返回的 operator；服务端按飞书 token 校验实际用户与租户。

【录入与回填】用户明确要求录入或回填时才可调用写入工具（finance_create_payment_plan / finance_create_revenue_plan / finance_patch_payment_plan_actuals / finance_patch_revenue_plan_actuals / finance_patch_payment_plan_schedule）；付款计划排款月份必填；调用前必须复述关键金额、期间与主体并等待确认；预算新增统一进入“预算填报与审核”，保存本人草稿并完成初审、终审、部门提交及财务确认；不得调用 finance_create_budget_line 直接新增正式预算。写入后建议调用 finance_run_alert_engine 刷新警情。

【输出口吻】财务口吻、结论先行、金额精确到元并按万/亿辅助表述；先给结论摘要，再给明细与依据；区分"事实（数据口径）"与"判断（预测/归因）"；最后给出下一步行动清单。数据不可用时说明原因，绝不编造数字。`

async function dispatchPublicContract(fetchImpl, config, path, req, res, logger) {
  const matched = PUBLIC_FINANCE_ROUTES.some(([method, template]) => method === req.method
    && new RegExp('^' + template.replace(/:[A-Za-z]+/g, '[A-Za-z0-9_-]+') + '$').test(path))
  if (!matched) return sendJson(res, 404, { ok: false, error: '未开放的财务接口' })
  const query = Object.fromEntries([...new URL(req.url, 'http://localhost').searchParams].filter(([key]) => PUBLIC_QUERY_KEYS.has(key)))
  const complete = req.method === 'GET' && needsCompleteList(path, query)
  if (complete) Object.assign(query, {page: 1, limit: 200})
  let body
  if (req.method !== 'GET') {
    // 512 KB Excel 经过 base64 后需要更大的 JSON 空间；仅开放两个精确上传接口。
    const filingExcelUpload = /^\/finance\/filing\/assignments\/[^/]+\/excel-preview$/.test(path)
    const excelUpload = /^\/finance\/budget-filing\/[^/]+\/excel\/(preview|import)$/.test(path)
    // 1 MB 结构化资金证据 JSON（快照导入 / 逐笔交易导入）经 JSON 转义需要更大空间；同样仅精确路由放宽。
    const cashEvidenceUpload = /^\/finance\/cash-evidence\/(snapshots|settlements)$/.test(path)
    const ceUpload = /^\/ce\/packages\/[^/]+\/(ebom\/preview|nodes)$/.test(path)
    const parsed = await readJsonBody(req, ceUpload ? 12 * 1024 * 1024 + 4096 : (excelUpload || filingExcelUpload) ? 768 * 1024 : cashEvidenceUpload ? 1536 * 1024 : MAX_BODY_BYTES)
    if (parsed.error) return sendJson(res, 400, { ok: false, error: parsed.error })
    body = stripControlFields(parsed.json)
    delete body.recipientId
    delete body.actorId
  }
  try {
    const response = await timedFetch(fetchImpl, buildFinanceUrl(path, req.method === 'GET' ? query : undefined), {
      method: req.method,
      headers: { accept: 'application/json', 'content-type': 'application/json', 'x-api-version': '1', authorization: `Bearer ${config.token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) return sendJson(res, response.status, { ok: false, error: financeErrorMessage(payload, response.status) })
    if (!payload || payload.data === undefined || (payload.code !== undefined && !isSuccessfulDatasourceCode(payload.code))) {
      return sendJson(res, 502, { ok: false, error: payload?.msg || '财务操作失败' })
    }
    const data = complete ? await completeFinanceList(payload.data, async pagination => {
      const next = await timedFetch(fetchImpl, buildFinanceUrl(path, { ...query, ...pagination }), {
        method: 'GET', headers: { accept: 'application/json', 'x-api-version': '1', authorization: `Bearer ${config.token}` },
      })
      const body = await next.json().catch(() => null)
      if (!next.ok || !body || body.data === undefined || (body.code !== undefined && !isSuccessfulDatasourceCode(body.code))) throw new Error('财务列表后续页加载失败')
      return body.data
    }) : payload.data
    return sendJson(res, 200, { ok: true, data })
  } catch {
    logger?.info?.(`sensteed finance: ${req.method} ${path} unavailable`)
    return sendJson(res, 503, { ok: false, error: '财务服务暂不可用，请稍后重试' })
  }
}

// Preserve actionable business failures (for example, a missing annual primary version).
// Do not show upstream route diagnostics, stack traces or arbitrary error objects to users.
function financeErrorMessage(payload, status) {
  const message = payload?.msg ?? payload?.message
  const text = Array.isArray(message) ? message.filter(value => typeof value === 'string').join('；') : message
  if (typeof text === 'string' && text.trim() && !/^(?:Cannot (?:GET|POST|PUT|PATCH|DELETE)|upstream_http_|<)/i.test(text.trim())) return text.slice(0, 500)
  if (status === 404) return '未找到对应的财务资源，请核对年度预算主版本、主体和科目；若均已配置，请联系管理员检查服务版本。'
  if (status === 403) return '当前账号没有此项财务操作权限'
  if (status === 400) return '填报数据校验失败，请检查必填项、金额与期间。'
  return '财务服务暂不可用，请稍后重试。'
}
