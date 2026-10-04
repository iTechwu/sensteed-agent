import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

// 前缀路由注册名：子路径用例统一从 BASE 拼接，避免散落完整字面量
const BASE = '/api/desktop/sensteed/finance'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** Datasource REST 标准应答。 */
function mcpJson(data, status = 200) {
  return jsonResponse({ code: 0, msg: 'ok', data }, status)
}

/** 宿主 ctx 桩：抓取前缀路由、工具与 systemPrompt 段 */
async function loadHost(overrides = {}) {
  const routes = new Map()
  const tools = new Map()
  const sections = []
  const { apply } = await import('../index.js')
  const upstreamFetch = overrides.fetch || globalThis.fetch
  const fetch = async (url, init) => {
    const response = await upstreamFetch(url, init)
    if (!new URL(url).pathname.endsWith('/permissions/workspace-access')) return response
    const body = await response.clone().json().catch(() => null)
    return body?.data?.allowed === undefined ? mcpJson({ allowed: true }) : response
  }
  // 凭据桩：默认仅这三个引用有存储值；overrides.credentialRefs 提供时整体替换（模拟引用缺省场景）
  const credentialRefs = new Map(Object.entries(overrides.credentialRefs ?? {
    DATASOURCE_INTERNAL_API_SECRET: 'cred-secret',
    DATASOURCE_TENANT_ID: 'tenant-1',
    DATASOURCE_OPERATOR_ID: 'op-1',
  }))
  apply({
    credentials: { async resolve(name) { return credentialRefs.has(name) ? { value: credentialRefs.get(name), source: 'file' } : undefined } },
    effect(factory) { return factory() },
    logger: { warn() {} },
    webServer: { port: 1, register(value) { routes.set(value.path, value); return () => {} } },
    tools: { register(value) { tools.set(value.name, value); return () => {} } },
    systemPrompt: { section(value) { sections.push(value); return () => {} } },
    settings: overrides.settings,
    dofeAuth: overrides.dofeAuth ?? { getDatasourceSession: () => ({ accessToken: 'feishu-test-token', tenantId: 'tenant-1', operator: 'op-1' }) },
  }, { ...overrides, fetch })
  return { routes, tools, sections }
}

async function invokeRoute(route, method, url, body, headers = {}) {
  let status = 0
  let raw = ''
  const merged = {
    // 渲染进程同源请求的浏览器默认头（宿主 sameOrigin 校验依赖）
    origin: 'http://127.0.0.1:1',
    'sec-fetch-site': 'same-origin',
    ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
    ...headers,
  }
  const req = {
    method,
    url: url || route.path,
    headers: merged,
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(JSON.stringify(body)) },
  }
  const res = {
    writeHead(value) { status = value; return this },
    end(value = '') { raw += value },
  }
  await route.handler(req, res)
  return { status, body: raw ? JSON.parse(raw) : undefined, headers: merged }
}

// 客户端片段清单（与 scripts/build.mjs 的 FILES 保持一致；顺序即依赖顺序）
const CLIENT_FILES = [
  'src/head.js', 'src/format.js', 'src/components.js', 'src/styles.js',
  'src/views/overview.js', 'src/views/budget.js', 'src/views/operations.js', 'src/views/cash.js',
  'src/views/alerts.js', 'src/views/datacenter.js', 'src/views/entry.js', 'src/views/analyze.js',
  'src/shell.js',
]
async function readClientSource() {
  const chunks = []
  for (const file of CLIENT_FILES) chunks.push(await readFile(new URL(file, root), 'utf8'))
  return chunks.join('\n')
}

test('manifest wires the MCP client and the web client', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.name, '@dofe/dsh-sensteed-finance')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
})

test('registers a prefix route, a bootstrap tool, and finance guidance', async () => {
  const { routes, tools, sections } = await loadHost()
  assert.equal(routes.get(BASE).kind, 'prefix')
  assert.ok(tools.get('sensteed_finance_bootstrap'))
  assert.equal(sections[0].name, 'sensteed:finance-guidance')
  assert.match(sections[0].text, /finance_analysis_brief/u)
  assert.match(sections[0].text, /财务口吻/u)
})

test('GET routes call the public Datasource REST API', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => {
    calls.push({ url: String(url), init })
    const path = new URL(url).pathname
    if (path.endsWith('/overview')) return mcpJson({ metrics: [], trend: [], byOrg: [] })
    if (path.endsWith('/orgs')) return mcpJson({ list: [{ id: 'org-1', name: '主体A' }] })
    if (path.endsWith('/alerts/summary')) return mcpJson({ total: 0 })
    if (path.endsWith('/data-quality')) return mcpJson({})
    return mcpJson({ list: [], total: 0, page: 1, limit: 20 })
  } })
  const route = routes.get(BASE)
  const brief = await invokeRoute(route, 'GET', BASE + '/brief?year=2026')
  assert.equal(brief.status, 200)
  assert.equal(brief.body.ok, true)
  assert.equal(brief.body.data.year, 2026)
  assert.ok(calls.some(item => item.url.startsWith('https://ds.hozonauto.com/api/finance/')), 'uses public Datasource REST origin')
  assert.ok(calls.every(item => !item.url.includes('/mcp')), 'no direct MCP endpoint remains')
  assert.equal(calls.find(item => !item.url.endsWith('/permissions/workspace-access')).init.headers.authorization, 'Bearer feishu-test-token', 'REST uses the live Feishu session')

  const quality = await invokeRoute(route, 'GET', BASE + '/quality')
  assert.equal(quality.status, 200)
  assert.ok(quality.body.quality, 'quality block present')
  assert.ok(quality.body.batches, 'batches block present')

  const missing = await invokeRoute(route, 'GET', BASE + '/nope')
  assert.equal(missing.status, 404)
})

test('checks workspace access before proxying finance data', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => {
    calls.push(String(url))
    if (String(url).endsWith('/permissions/workspace-access')) return mcpJson({ allowed: false })
    return mcpJson({ list: [] })
  } })
  const result = await invokeRoute(routes.get(BASE), 'GET', BASE + '/overview')
  assert.equal(result.status, 403)
  assert.equal(result.body.ok, false)
  assert.equal(calls.length, 1)
  assert.match(calls[0], /permissions\/workspace-access/u)
})

test('accepts the public Datasource REST success envelope with code 200', async () => {
  const { routes } = await loadHost({ fetch: async () => jsonResponse({
    code: 200,
    msg: 'ok',
    data: { list: [] },
  }) })
  const result = await invokeRoute(routes.get(BASE), 'GET', BASE + '/context')
  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  assert.deepEqual(result.body.data, { orgs: [], departments: [] })
})

test('write routes map to REST resources with path ids', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => { calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : undefined }); return mcpJson({ created: { id: 'row-1' } }) } })
  const route = routes.get(BASE)
  const created = await invokeRoute(route, 'POST', BASE + '/payment-plans', { orgId: 'org-1', planType: 'PURCHASE', year: 2026, description: '测试', plannedAmount: 100 })
  assert.equal(created.status, 200)
  const businessCalls = () => calls.filter(item => !item.url.endsWith('/permissions/workspace-access'))
  assert.match(businessCalls()[0].url, /\/api\/finance\/payment-plans/u)
  assert.equal(businessCalls()[0].init.method, 'POST')
  assert.equal(businessCalls()[0].body.tenantId, undefined)
  assert.equal(businessCalls()[0].body.operator, undefined)

  const patched = await invokeRoute(route, 'POST', BASE + '/revenue-plans/row-9/actuals', { actualAmount: 50 })
  assert.equal(patched.status, 200)
  assert.match(businessCalls()[1].url, /\/api\/finance\/revenue-plans\/row-9\/actuals/u)
  assert.equal(businessCalls()[1].init.method, 'PATCH')

  const rung = await invokeRoute(route, 'POST', BASE + '/alerts/run', { year: 2026 })
  assert.equal(rung.status, 200)
  assert.match(businessCalls()[2].url, /\/api\/finance\/alerts\/run/u)

  const bad = await invokeRoute(route, 'POST', BASE + '/nope', {})
  assert.equal(bad.status, 404)
})

test('requires Feishu login and ignores client-supplied tenant and operator', async () => {
  const calls = []
  let session
  const { routes } = await loadHost({
    dofeAuth: { getDatasourceSession: () => session },
    fetch: async (_url, init) => { calls.push(init.body ? JSON.parse(init.body) : {}); return mcpJson({ ok: true }) },
  })
  const route = routes.get(BASE)
  assert.equal((await invokeRoute(route, 'POST', BASE + '/payment-plans', { operator: 'spoof' })).status, 401)
  assert.equal(calls.length, 0)
  session = { accessToken: 'feishu-test-token', tenantId: 'tenant-1', operator: 'sso-1' }
  await invokeRoute(route, 'POST', BASE + '/payment-plans', { tenantId: 'other', operator: 'spoof' })
  assert.equal(calls[0].operator, undefined)
  assert.equal(calls[0].tenantId, undefined)
  assert.equal(calls[0].idempotencyKey, undefined)
  session = undefined
  assert.equal((await invokeRoute(route, 'GET', BASE + '/quality')).status, 401)
})

test('same-origin guard rejects foreign-origin and non-loopback requests', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => { calls.push({}); return mcpJson({ ok: true }) } })
  const route = routes.get(BASE)
  // 跨源 POST（网页 CSRF 形态）：403 且不落上游
  const csrf = await invokeRoute(route, 'POST', BASE + '/payment-plans', { orgId: 'org-1' }, { origin: 'https://evil.example' })
  assert.equal(csrf.status, 403)
  // 非本机回环来源：403
  let status = 0
  const req = { method: 'GET', url: BASE + '/brief', headers: { origin: 'http://127.0.0.1:1' }, socket: { remoteAddress: '10.0.0.9' }, async *[Symbol.asyncIterator]() {} }
  const res = { writeHead(value) { status = value; return this }, end() {} }
  await route.handler(req, res)
  assert.equal(status, 403)
  assert.equal(calls.length, 0, 'rejected requests must not reach the MCP upstream')
})

test('read and write operator come from the live Feishu session', async () => {
  const calls = []
  const { routes } = await loadHost({
    dofeAuth: { getDatasourceSession: () => ({ accessToken: 'token', tenantId: 'tenant-1', operator: 'sso-2' }) },
    fetch: async (url, init) => { calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : {} }); return mcpJson({ ok: true }) },
  })
  const route = routes.get(BASE)
  await invokeRoute(route, 'POST', BASE + '/payment-plans', { orgId: 'org-1', plannedAmount: 1 })
  assert.equal(calls.at(-1).body.operator, undefined)
  // GET 侧 operatorArg 同样吃到 SSO 身份
  await invokeRoute(route, 'GET', BASE + '/saved-views')
  assert.match(calls.at(-1).url, /\/api\/finance\/saved-views/u)
})

test('new read routes map to public REST resources', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => { calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : {} }); return mcpJson({ list: [] }) } })
  const route = routes.get(BASE)
  const cases = [
    ['/departments?x=1', 'finance_get_departments'],
    ['/alerts-summary?year=2026', 'finance_get_alert_summary'],
    ['/alert-rules', 'finance_get_alert_rules'],
    ['/budget-versions?year=2026', 'finance_get_budget_versions'],
    ['/budget-version-diff?year=2026&baseVersionId=b1&targetVersionId=t1', 'finance_get_budget_version_diff'],
    ['/carryover-rules', 'finance_get_carryover_rules'],
    ['/saved-views', 'finance_get_saved_views'],
    ['/members', 'finance_get_members'],
    ['/employment-records', 'finance_get_employment_records'],
    ['/contacts?onlyUnmapped=1', 'finance_directory_contacts_query'],
    ['/data-source-configs', 'finance_get_data_source_configs'],
    ['/data-source-runs?status=FAILED', 'finance_get_data_source_runs'],
    ['/budget-adjustments?status=SUBMITTED', 'finance_budget_adjustment_list'],
    ['/plan-adjustments', 'finance_plan_adjustment_list'],
    ['/allocations?page=1', 'finance_allocation_list'],
    ['/allocations-pool?year=2026', 'finance_allocation_pool_query'],
    ['/availability?year=2026', 'finance_budget_availability_query'],
    ['/filing-tasks?status=OPEN', 'finance_filing_task_list'],
    ['/filing-assignments?year=2026', 'finance_filing_assignments_query'],
  ]
  for (const [path, tool] of cases) {
    const response = await invokeRoute(route, 'GET', BASE + path)
    assert.equal(response.status, 200, path)
    assert.match(calls.at(-1).url, /^https:\/\/ds\.hozonauto\.com\/api\//u, path)
  }
  // operator 解析：query 优先，缺省用凭据
  await invokeRoute(route, 'GET', BASE + '/saved-views?operator=op-query')
  assert.doesNotMatch(calls.at(-1).url, /op-query/u)
  await invokeRoute(route, 'GET', BASE + '/saved-views')
  assert.match(calls.at(-1).url, /\/saved-views/u)
})

test('new write routes merge path captures into REST resources', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => { calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : {} }); return mcpJson({ ok: true }) } })
  const route = routes.get(BASE)

  // 版本生命周期：路径 id 注入
  await invokeRoute(route, 'POST', BASE + '/budget-versions/ver-1/action', { action: 'activate' })
  assert.match(calls.at(-1).url, /\/api\/finance\/budget\/versions\/ver-1\/activate/u)

  // 填报重开：路径捕获注入 id + action
  await invokeRoute(route, 'POST', BASE + '/filing-assignments/as-1/reopen', { reason: '数据填错' })
  assert.match(calls.at(-1).url, /\/api\/finance\/filing\/assignments\/as-1\/reopen/u)

  // 填报行暂存：路径捕获映射为 assignmentId
  await invokeRoute(route, 'POST', BASE + '/filing-assignments/as-1/rows', { rows: [{ plannedAmount: 10 }] })
  assert.match(calls.at(-1).url, /\/api\/finance\/filing\/assignments\/as-1\/rows/u)
  assert.equal(calls.at(-1).init.method, 'PUT')

  // 预算调整审批：approve/reject 合一到 review 工具
  await invokeRoute(route, 'POST', BASE + '/budget-adjustments/adj-1/reject', { note: '预算依据不足' })
  assert.match(calls.at(-1).url, /\/api\/finance\/budget\/adjustments\/adj-1\/reject/u)

  // 提交走独立工具，路径捕获映射为 adjustmentId
  await invokeRoute(route, 'POST', BASE + '/budget-adjustments/adj-1/submit', {})
  assert.match(calls.at(-1).url, /\/api\/finance\/budget\/adjustments\/adj-1\/submit/u)

  // 排款调增审批 / 过账 / 数据源启停（无 operator 工具）
  await invokeRoute(route, 'POST', BASE + '/plan-adjustments/pa-1/approve', { note: '同意' })
  assert.match(calls.at(-1).url, /\/api\/finance\/payment-plan-adjustments\/pa-1\/approve/u)
  await invokeRoute(route, 'POST', BASE + '/allocations/al-1/remove', {})
  assert.match(calls.at(-1).url, /\/api\/finance\/allocations\/al-1\/remove/u)
  await invokeRoute(route, 'POST', BASE + '/data-source-configs/ds-1/active', { active: false })
  assert.match(calls.at(-1).url, /\/api\/data-source\/configs\/ds-1\/active/u)
  assert.equal(calls.at(-1).body.active, false)
  assert.equal(calls.at(-1).body.operator, undefined)
})

test('bootstrap tool reports tenant and orgs', async () => {
  const { tools } = await loadHost({ fetch: async () => mcpJson({ orgs: [{ id: 'org-1', name: '主体A' }] }) })
  const result = await tools.get('sensteed_finance_bootstrap').execute({})
  assert.equal(result.ok, true)
  assert.equal(result.result.tenantId, 'tenant-1')
  assert.equal(result.result.orgs[0].name, '主体A')
})

test('context normalizes organizations and departments for the selectors', async () => {
  const { routes } = await loadHost({ fetch: async (url) => {
    const path = new URL(url).pathname
    return mcpJson(path.endsWith('/orgs') ? { orgs: [{ id: 'org-1', name: '主体' }] } : { list: [{ id: 'dept-1', name: '部门' }] })
  } })
  const result = await invokeRoute(routes.get(BASE), 'GET', BASE + '/context')
  assert.equal(result.body.data.orgs[0].id, 'org-1')
  assert.equal(result.body.data.departments[0].id, 'dept-1')
})

test('distinguishes expired login from denied finance permissions', async () => {
  for (const status of [401, 403]) {
    const { tools } = await loadHost({ fetch: async url =>
      String(url).endsWith('/permissions/workspace-access')
        ? mcpJson({ allowed: true })
        : new Response('', { status }) })
    const result = await tools.get('sensteed_finance_bootstrap').execute()
    assert.equal(result.ok, false)
    if (status === 401) assert.match(result.error, /登录已失效.*重新登录/u)
    else {
      assert.match(result.error, /操作权限.*财务负责人/u)
      assert.doesNotMatch(result.error, /重新登录/u)
    }
  }
})

test('REST business errors are failures, not successful writes', async () => {
  for (const data of [{ error: 'forbidden', hint: '没有操作权限' }, { error: 'budget_exceeded' }]) {
    const { routes } = await loadHost({ fetch: async () => jsonResponse({ code: 1, msg: data.hint || data.error }, 200) })
    const result = await invokeRoute(routes.get(BASE), 'POST', BASE + '/allocations', {})
    assert.equal(result.status, 502)
    assert.equal(result.body.ok, false)
    assert.equal(result.body.error, data.hint || data.error)
  }
})

test('scope changes replace group totals with the selected organization', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url) => {
    const parsed = new URL(url)
    const selectedOrg = parsed.searchParams.get('orgId')
    calls.push(parsed.pathname)
    return mcpJson(parsed.pathname.endsWith('/overview') && !selectedOrg ? { group: true } : { selectedOrg })
  } })
  const result = await invokeRoute(routes.get(BASE), 'GET', BASE + '/brief?year=2026&orgId=org-1')
  assert.equal(result.body.data.overview.selectedOrg, 'org-1')
  assert.equal(result.body.data.budget.selectedOrg, 'org-1')
  assert.equal(result.body.data.cash.selectedOrg, 'org-1')
  assert.equal(calls.filter(path => !path.endsWith('/permissions/workspace-access')).length, 10)
})

test('keeps the secret out of URLs and never fabricates upstream data', async () => {
  const { routes } = await loadHost({ fetch: async () => new Response('denied', { status: 403 }) })
  const route = routes.get(BASE)
  const response = await invokeRoute(route, 'GET', BASE + '/brief')
  assert.equal(response.status, 502)
  assert.equal(response.body.ok, false)
  assert.match(response.body.error, /财务操作权限/)
  const source = await readFile(new URL('index.js', root), 'utf8')
  assert.doesNotMatch(source, /api_key|MODELS_API_KEY/u)
})

test('MCP registration is owned by the desktop login lifecycle without machine secrets', async () => {
  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
  assert.doesNotMatch(patch, /authorizationCredential|INTERNAL_API_SECRET|mcp-finance/u)
})

test('client source wires sidebar entry, overlay, tabs, and analysis entries', async () => {
  const source = await readClientSource()
  for (const token of ['sidebar.footer.action', 'shell.overlay', 'sf-overlay', 'ANALYSIS_ENTRIES', '/brief', 'backfillActual', 'runDone', 'analysis_forecast', 'PillTabs', 'BudgetView', 'sf-pilltabs', 'sf-table-fields', 'sf-table-sort-button', 'sf-sidebar-brand', 'CustomizableTextSelect', 'MultiSearchSelect', 'textChoice', '新建预算行', 'targetYear', 'adjTargetMonth']) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  }
  assert.match(source, /if \(await act\('\/budget-adjustments',[\s\S]*?\)\) onClose\(\)/u)
  assert.doesNotMatch(source, /sf-task-departments/u, 'department assignment must use the searchable multi-select')
  assert.doesNotMatch(source, /fetch\(`https?:\/\//u, 'client must only call same-origin routes')
})

test('search selectors use the shared accessible popup instead of browser datalist', async () => {
  const source = await readClientSource()
  assert.match(source, /function SearchSelect\(/u)
  assert.match(source, /className: 'sf-search-menu'/u)
  assert.match(source, /'aria-controls': menuId/u)
  assert.doesNotMatch(source, /h\('datalist'/u)
  assert.match(source, /className: 'sf-search-clear'/u)
})

test('table keeps column identities after hiding fields and offers settings when empty', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8')
  const element = (type, props, ...children) => ({ type, props: props || {}, children })
  const storage = { getItem: () => JSON.stringify(['column-1', 'column-2']), setItem() {} }
  const table = new Function('h', 'useState', 'useEffect', 'useMemo', 'localStorage', `${source}\nreturn Table`)(
    element,
    initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    () => {},
    compute => compute(),
    storage,
  )
  const columns = [{ label: 'A', sortKey: 'a' }, { label: 'B', sortKey: 'b' }, { label: 'C', sortKey: 'c' }]
  const descendants = node => [node, ...(node?.children || []).flatMap(child => child && typeof child === 'object' ? descendants(child) : [])]
  const filled = descendants(table({ columns, rows: [{ a: 1, b: 2, c: 3 }], empty: '暂无数据' }))
  assert.deepEqual(filled.filter(node => node?.type === 'th').map(node => node.props.key), ['column-1', 'column-2'])
  const empty = descendants(table({ columns, rows: [], empty: '暂无数据' }))
  assert.ok(empty.some(node => node?.type === 'summary' && node.props.className === 'sf-table-tool'))
  assert.ok(empty.some(node => node?.props?.className === 'sf-empty'))
})

test('filing task dialog submits the same dimensions and keeps failures open', async () => {
  const components = await readFile(new URL('src/components.js', root), 'utf8')
  const entry = await readFile(new URL('src/views/entry.js', root), 'utf8')
  const element = (type, props, ...children) => ({ type, props: props || {}, children })
  const createDialog = values => {
    let index = 0
    return new Function('h', 'useState', 'useEffect', `${components}\n${entry}\nreturn CreateTaskDialog`)(
      element,
      initial => [index in values ? values[index++] : (index++, initial), () => {}],
      () => {},
    )
  }
  const values = ['十月资金填报', 'PAYMENT_PLAN', '10', '', null, ['dept-1'], '2026-10-10T12:00', '填写说明', '负责人', '审核人', true, false, true]
  let closed = false
  let payload
  const dialog = createDialog(values)({
    year: 2026, departments: [{ id: 'dept-1', name: '部门一' }], busy: false, t: key => key,
    onClose: () => { closed = true }, act: async (_path, body) => { payload = body; return false },
  })
  await dialog.props.footer[1].props.onClick()
  assert.equal(closed, false)
  assert.equal(payload.month, 10)
  assert.deepEqual(payload.departments, [{ departmentId: 'dept-1' }])
  assert.equal(payload.instructions, '填写说明')
  assert.equal(payload.freezeCurrentMonth, false)
  assert.equal(payload.startAsDraft, true)

  const budget = createDialog(['年度预算', 'BUDGET', '10', 'version-1', [{ id: 'version-1', name: '预算版本' }], ['dept-1'], '2026-10-10T12:00'])({
    year: 2026, departments: [{ id: 'dept-1', name: '部门一' }], busy: false, t: key => key,
    onClose: () => { closed = true }, act: async (_path, body) => { payload = body; return true },
  })
  await budget.props.footer[1].props.onClick()
  assert.equal(closed, true)
  assert.equal(payload.versionId, 'version-1')
  assert.equal(payload.month, undefined)
})

test('clicking the sidebar button renders the dashboard without render-time reference errors', async () => {
  // 回归：hook 依赖数组在渲染期求值，引用未声明标识符（曾经的 focusReady）会让
  // 看板首渲染即抛 ReferenceError，shell.overlay slot entry 崩溃，表现为“点击看板无反应”。
  // 桩 React 会真正调用函数组件（仅顶层一层），让渲染期错误在测试里当场抛出。
  globalThis.window = { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} }
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail } }
  globalThis.document = { activeElement: null, createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } }
  globalThis.requestAnimationFrame = () => 0
  const source = await readClientSource()
  const module = { exports: {} }
  let renderDepth = 0
  const createElement = (type, props, ...children) => {
    const merged = { ...props, children }
    if (typeof type === 'function' && renderDepth === 0) {
      renderDepth += 1
      try { return type(merged) } finally { renderDepth -= 1 }
    }
    return { type, props: merged }
  }
  const reactStub = {
    createElement,
    Fragment: 'Fragment',
    useState: initial => [initial === null ? true : (typeof initial === 'function' ? initial() : initial), () => {}],
    useRef: initial => ({ current: initial }),
    useEffect: () => {},
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
  const primitivesStub = new Proxy({}, { get: (_target, key) => key === 'Tooltip' ? props => props.children : () => null })
  const requireStub = name => {
    if (name === 'react') return reactStub
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub
    throw new Error(`unexpected require: ${name}`)
  }
  new Function('require', 'module', 'exports', `${source}\nmodule.exports = { apply, Button, Overlay }`)(requireStub, module, module.exports)
  const { apply, Button, Overlay } = module.exports

  const registered = {}
  apply({
    effect(factory) { return factory() },
    locale: { register() {}, bind: () => key => key },
    slots: { inject(_key, register) { register() }, register(options, component) { registered[options.name] = component; return () => {} } },
    get: () => undefined,
  })
  assert.equal(registered['shell.overlay'], Overlay, 'shell.overlay must register the Overlay')

  const closed = Overlay({ t: key => key })
  assert.equal(closed, null, 'closed overlay renders nothing')

  // 点侧栏按钮 → openOverlay 置 opened=true（点击链路本身不许出错）
  const button = Button({ wide: true, t: key => key })
  const findClick = node => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findClick(child)
        if (found) return found
      }
      return undefined
    }
    if (!node || typeof node !== 'object') return undefined
    if (node.props?.onClick) return node.props.onClick
    for (const child of [].concat(node.props?.children ?? [])) {
      const found = findClick(child)
      if (found) return found
    }
    return undefined
  }
  const onClick = findClick(button)
  assert.equal(typeof onClick, 'function', 'sidebar button must carry the open handler')
  onClick({ currentTarget: null })

  // 打开状态的首渲染：曾因 focusReady 未定义在这里抛 ReferenceError
  const opened = Overlay({ t: key => key })
  assert.match(String(opened?.props?.className), /\bsf-overlay\b/, 'opened overlay must render the dashboard shell')
  assert.match(String(opened?.props?.className), /\bsf-root\b/, 'overlay must carry the sf-root token scope')
})

test('client field names match the finance contract schemas', async () => {
  const source = await readClientSource()
  // 契约字段回归：FinanceMetric/trend 扁平 *Amount、BudgetSummary {list,totals}、PaymentPlan remainingAmount
  for (const token of ['budgetAmount', 'prSubmittedAmount', 'paidAmount', 'summary?.list', 'summary?.totals', 'remainingAmount', 'data?.list', "name: 'departmentId'", "name: 'planMonth'"]) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'), token)
  }
  // `.rows ||` 已不再陈旧：版本 diff 契约（BudgetVersionDiffResponse.rows）合法使用该字段
  for (const stale of ['taxFreeAmount', "metric.key === 'budgetTotal'"]) {
    assert.doesNotMatch(source, new RegExp(stale.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'), stale)
  }
})

test('client build concatenates every registered fragment', async () => {
  // 防回归：新增 src 片段必须登记进 build.mjs 的 FILES（列表与测试 CLIENT_FILES 同步）
  const build = await readFile(new URL('scripts/build.mjs', root), 'utf8')
  for (const file of CLIENT_FILES) assert.match(build, new RegExp(file.replace(/\//g, '\\/'), 'u'), file)
})
