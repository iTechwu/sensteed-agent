import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '../../../deepseek-harness/apps/web/node_modules/playwright/index.mjs'
const root = resolve(import.meta.dirname, '../../..')
const evidence = resolve('/tmp/sensteed-finance-evidence')
await mkdir(evidence, { recursive: true })
const vite = await createServer({ root: resolve(import.meta.dirname, 'finance-harness'), server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'finance-source', configureServer(server) {
  server.middlewares.use('/__finance_source__', async (_req, res) => { res.setHeader('content-type', 'text/plain'); res.end(await readFile(resolve(root, '.ci/dsh-sensteed-finance/lib/client.js'), 'utf8')) })
} }] })
await vite.listen()
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const page = await browser.newPage({ viewport: { width: 1360, height: 920 } })
page.setDefaultTimeout(10000)
page.setDefaultNavigationTimeout(15000)
const errors = []
const requests = []
const mutations = []
let financeRole = 'FINANCE_OWNER'
let failCreate = false
let failBudgetEntry = true
let failCostCatalog = false
const deniedPermissions = new Set()
const permissionCodes = ['budget.activity.read', 'budget.activity.manage', 'budget.activity.reopen', 'budget.submission.read', 'budget.submission.edit', 'budget.submission.verify', 'budget.adjustment.approve', 'budget.version.manage', 'budget.version.publish', 'budget.compare.read', 'budget.execution.read', 'cash.plan.read', 'cash.plan.write', 'cash.plan.verify', 'finance.source.review', 'finance.assistant.read', 'finance.permission.manage']
page.on('pageerror', e => errors.push(e.message))
const year = new Date().getFullYear()
let failBrief = false
let accessStatus = 401
let financeAllowed = false
let bomAllowed = false
let bomAccessStatus = 200
let bomRollupStatus = 200
let bomPage = 0
const recheckAccess = async () => {
  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/access')).then(response => response.finished()),
    page.evaluate(() => window.dispatchEvent(new Event('focus'))),
  ])
}
try {
  await page.route('**/api/desktop/**', async route => {
    const url = new URL(route.request().url()); requests.push(url.pathname + url.search)
    const method = route.request().method()
    const pathname = url.pathname.replace('/api/desktop/sensteed/finance/rest', '')
    if (['POST', 'PUT', 'PATCH'].includes(method) && (url.pathname.includes('/rest/') || url.pathname.endsWith('/budget-lines'))) mutations.push({ path: pathname, method, body: route.request().postDataJSON() })
    let body = { ok: true, data: { list: [], total: 0 } }
    const bomAccess = url.searchParams.get('permission') === 'cost.engineering.read'
    let status = url.pathname.endsWith('/access') ? bomAccess ? bomAccessStatus : accessStatus : url.pathname.endsWith('/rollup') ? bomRollupStatus : failBrief && url.pathname.endsWith('/brief') ? 502 : 200

    if (pathname === '/finance/permissions/me') { status = bomAccessStatus; body = { ok: status === 200, data: { permissions: [...permissionCodes.filter(code => !deniedPermissions.has(code)), ...(bomAllowed ? ['cost.engineering.read'] : [])], scopes: [] } } }
    if (pathname === '/finance/members/me') body.data = { role: financeRole, fullAccess: true, departmentIds: [] }
    if (pathname === '/finance/budget/versions') body.data = { list: [{ id: 'version-1', name: '测试预算草稿', status: 'DRAFT', isPrimary: false, year, lineCount: 1 }] }
    if (pathname.endsWith('/params') && method === 'GET') body.data = [{ id: 'param-1', version: 'P1', params: { openingBalance: 100, safetyLine: 50 } }]
    if (pathname.endsWith('/runs') && method === 'GET') body.data = [{ id: 'run-1', status: 'SUCCESS', formulaVersion: 'formula-v3', startedAt: '2026-10-14T00:00:00Z' }]
    if (pathname.endsWith('/sales-inputs') && method === 'GET') body.data = [{ id: 'input-1', product: '测试产品', quantity: 2, unitPrice: 100, receiptRate: 0.5 }]
    if (pathname.endsWith('/outputs')) body.data = [{ id: 'out-1', kind: 'REVENUE', amount: 200, year, month: 1 }]
    if (pathname.endsWith('/statements')) body.data = { income: [{ year, month: 1, revenue: 200, profit: 20 }], cashflow: [], balance: [] }
    if (pathname === '/ce/packages' && method === 'GET') body.data = { list: [{ id: 'pkg-1', name: '测试车型 BOM', status: 'APPROVED', version: 'V1' }], total: 1 }
    if (pathname === '/ce/packages' && method === 'POST') { status = failCreate ? 502 : 200; body = failCreate ? { ok: false, error: '创建暂不可用' } : { ok: true, data: { id: 'pkg-1' } } }
    if (/\/ce\/packages\/pkg-1\/(changes|quotes|param-versions|approvals)$/.test(pathname)) body.data = []
    if (pathname === '/finance/review/summary') body.data = { sources: [{ source: 'FILING', pending: 1 }], total: 1 }
    if (pathname === '/finance/notifications/summary') body.data = { total: 1, unread: 1, pending: 1 }
    if (pathname === '/finance/notifications') body.data = { list: [{ id: 'notification-1', title: '测试通知', category: 'ACTION_REQUIRED', status: 'PENDING', readAt: null }], total: 1 }
    if (pathname === '/finance/members') body.data = { list: [{ id: 'member-1', userId: 'user-1', name: '测试成员', role: 'FINANCE_STAFF', enabled: true }] }
    if (pathname === '/data-source/records') body.data = { list: [{ id: 'record-1', sourceDocNo: 'OA-1', fields: [{ key: 'source-name', label: '业务描述', value: '测试来源单据' }], financialAnalysis: { category: '采购支出' } }], total: 1 }
    if (url.pathname.endsWith('/access')) body = { ok: status === 200, allowed: bomAccess ? bomAllowed : financeAllowed }
    if (url.pathname.endsWith('/bom/packages')) {
      bomPage = Number(url.searchParams.get('page'))
      body.data = { list: [{ id: 'pkg-1', name: bomPage === 1 ? '测试车型 BOM' : '第二页成本包', modelCode: 'EV-1', version: 'V1', status: 'APPROVED', targetCost: 1000 }], total: 21 }
      assert.equal(url.searchParams.has('year'), false)
      assert.equal(url.searchParams.has('orgId'), false)
    }
    if (url.pathname.endsWith('/bom/packages/pkg-1')) body.data = { package: { id: 'pkg-1', name: '测试车型 BOM', status: 'DRAFT' }, totalCost: 800, targetCost: 1000, nodeCount: 2, leafCount: 1, nodes: [{ id: 'node-1', partNo: 'EV-001', name: '测试电池', level: 1, qty: 2, unitCost: 400 }] }
    if (url.pathname.endsWith('/rollup')) body = bomRollupStatus === 200 ? { ok: true, data: { entries: [{ nodeId: 'node-1', extendedCost: 800 }] } } : { ok: false, error: '汇总暂不可用' }
    if (url.pathname.endsWith('/status')) body = { status: 'bound', user: { name: '测试用户' } }
    if (url.pathname.endsWith('/context')) body.data = { orgs: [{ id: 'org-1', name: '测试主体' }], departments: [{ id: 'dept-1', name: '测试部门' }] }
    if (url.pathname.endsWith('/brief')) body = failBrief ? { ok: false, error: '服务暂不可用' } : { ok: true, data: { year, overview: { metrics: { budgetAmount: 100000, prSubmittedAmount: 25000, prEstimatedAmount: 10000, paidAmount: 15000 }, trend: [{ month: 3, prSubmittedAmount: 25000, paidAmount: 15000 }], byOrg: [] }, cash: { list: [] }, alertsSummary: { total: 0 }, openAlerts: [] } }
    if (url.pathname.endsWith('/budget')) body = { ok: true, summary: { list: [], totals: {} }, lines: { list: [], total: 0 } }
    if (url.pathname.endsWith('/quality')) body = { ok: true, quality: { issues: [] }, batches: { list: [], total: 0 } }
    if (url.pathname.endsWith('/data-source-metrics')) body = { ok: true, data: [] }
    if (url.pathname.endsWith('/cost-items')) {
      status = failCostCatalog ? 503 : 200
      body = failCostCatalog ? { ok: false, error: '科目暂不可用' } : { ok: true, data: { list: [{ id: 'cost-travel', name: '差旅费', active: true }, { id: 'inactive', name: '停用科目', active: false }] } }
    }
    if (url.pathname.endsWith('/budget-versions')) body.data = { list: Number(url.searchParams.get('year')) === year ? [{ id: 'primary', name: '年度正式预算', year, isPrimary: true, status: 'PUBLISHED' }] : [] }
    if (url.pathname.endsWith('/budget-lines') && method === 'POST') {
      status = failBudgetEntry ? 404 : 200
      body = failBudgetEntry ? { ok: false, error: `年度 ${year} 暂无已发布预算版本，请先导入数据` } : { ok: true, data: { id: 'budget-line-1' } }
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  const pageUrl = `http://127.0.0.1:${vite.httpServer.address().port}`
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/access')), page.goto(pageUrl)])
  assert.equal(page.url(), pageUrl + '/')
  assert.equal(await page.getByRole('button', { name: '财务管理', exact: true }).count(), 0)
  accessStatus = 200
  financeAllowed = true
  await recheckAccess()
  await page.getByRole('button', { name: '财务管理', exact: true }).click()
  await page.getByRole('heading', { name: '经营总览', exact: true }).waitFor()
  await page.getByText('测试主体', { exact: true }).first().waitFor({ state: 'attached' })
  await page.screenshot({ path: resolve(evidence, 'overview.png') })
  assert.equal(await page.locator('.sf-tabs').getByRole('button', { name: '成本 BOM', exact: true }).count(), 0)
  assert.equal(requests.some(path => path.includes('/bom/packages')), false)
  bomAllowed = true
  await recheckAccess()
  await page.locator('.sf-tabs').getByRole('button', { name: '成本 BOM', exact: true }).click()
  await page.getByRole('button', { name: '测试车型 BOM', exact: true }).click()
  await page.getByText('测试电池', { exact: true }).waitFor()
  await page.getByRole('cell', { name: '800', exact: true }).waitFor()
  await page.screenshot({ path: resolve(evidence, 'bom.png') })
  const pagerButtons = page.locator('.sf-pager button')
  await pagerButtons.last().click()
  await page.getByRole('button', { name: '第二页成本包', exact: true }).waitFor()
  assert.equal(bomPage, 2)
  await pagerButtons.first().click()
  await page.getByRole('button', { name: '测试车型 BOM', exact: true }).waitFor()
  bomRollupStatus = 502
  await page.getByRole('button', { name: '刷新数据', exact: true }).click()
  await page.getByText('成本汇总加载失败，物料明细仍可查看。', { exact: false }).waitFor()
  await page.getByText('测试电池', { exact: true }).waitFor()
  bomRollupStatus = 200
  await page.locator('[role="alert"]').getByRole('button', { name: '重新加载' }).click()
  await page.getByRole('cell', { name: '800', exact: true }).waitFor()
  bomAccessStatus = 503
  await recheckAccess()
  await page.getByText('测试电池', { exact: true }).waitFor()
  bomAccessStatus = 200
  bomAllowed = false
  await recheckAccess()
  await page.locator('.sf-tabs').getByRole('button', { name: '成本 BOM', exact: true }).waitFor({ state: 'hidden' })
  await page.getByRole('heading', { name: '经营总览', exact: true }).waitFor()
  // BOM creation keeps input on failure and allows retry; writes use the public CE contract.
  bomAllowed = true
  await recheckAccess()
  await page.locator('.sf-tabs').getByRole('button', { name: '成本 BOM', exact: true }).click()
  await page.getByRole('button', { name: '新建成本包', exact: true }).click()
  const createDialog = page.getByRole('dialog', { name: '新建成本包', exact: true })
  await createDialog.getByLabel('项目 / 车型名称', { exact: true }).fill('回归成本项目')
  failCreate = true
  await createDialog.getByRole('button', { name: '确认', exact: true }).click()
  await createDialog.getByText('创建暂不可用', { exact: true }).waitFor()
  assert.equal(await createDialog.getByLabel('项目 / 车型名称', { exact: true }).inputValue(), '回归成本项目')
  failCreate = false
  await createDialog.getByRole('button', { name: '确认', exact: true }).click()
  await createDialog.waitFor({ state: 'hidden' })
  assert.equal(mutations.at(-1).body.name, '回归成本项目')
  financeRole = 'BOSS'
  await recheckAccess()
  await page.getByRole('button', { name: '新建成本包', exact: true }).waitFor({ state: 'hidden' })
  await page.getByText('测试电池', { exact: true }).waitFor()
  financeRole = 'FINANCE_OWNER'
  await recheckAccess()
  await page.getByRole('button', { name: '新建成本包', exact: true }).waitFor()
  // Every top-level section must render, including empty-data state.
  for (const tab of ['预算执行', '经营分析', '资金分析', '预警中心', '数据中心', '录入', '预算编制', '预算比较', '复核中心', '来源记录', '已发布事实', '通知中心', '权限中心', '深度分析']) {
    await page.locator('.sf-tabs').getByRole('button', { name: tab, exact: true }).click()
    await page.screenshot({ path: resolve(evidence, `tab-${tab}.png`) })
  }
  // Budget entry: translated categories, authoritative cost IDs, annual preflight and failed-save retry.
  await page.locator('.sf-tabs').getByRole('button', { name: '录入', exact: true }).click()
  const entry = page.locator('form.sf-card')
  await entry.getByRole('tab', { name: '预算行', exact: true }).click()
  const submitBudget = entry.getByRole('button', { name: '提交', exact: true })
  await page.waitForFunction(() => !document.querySelector('form.sf-card button[type="submit"]')?.disabled)
  assert.equal(await entry.locator('[name="year"]').inputValue(), String(year))
  assert.deepEqual(await entry.locator('[name="expenseType"] option').allTextContents(), ['项目运营成本', '固定运营成本', '车型专属成本', '非项目类'])
  await entry.getByRole('combobox', { name: '搜索主体', exact: true }).click()
  await entry.getByRole('option', { name: '测试主体', exact: true }).click()
  await entry.getByRole('combobox', { name: '搜索费用科目', exact: true }).fill('差旅')
  await entry.getByRole('option', { name: '差旅费', exact: true }).click()
  assert.equal(await entry.locator('[name="costItemId"]').inputValue(), 'cost-travel')
  assert.equal(await entry.getByRole('option', { name: '停用科目', exact: true }).count(), 0)
  await entry.locator('[name="month"]').selectOption('2')
  await entry.locator('[name="budgetAmount"]').fill('300000')
  await entry.locator('[name="note"]').fill('包含海外3人次差旅')
  await submitBudget.click()
  await entry.getByText(`操作失败: 年度 ${year} 暂无已发布预算版本，请先导入数据`, { exact: true }).waitFor()
  assert.equal(await entry.locator('[name="budgetAmount"]').inputValue(), '300000')
  assert.equal(await entry.locator('[name="note"]').inputValue(), '包含海外3人次差旅')
  assert.equal(mutations.at(-1).body.costItemId, 'cost-travel')
  assert.equal(mutations.at(-1).body.costItemName, undefined)
  await page.screenshot({ path: resolve(evidence, 'entry-budget-error.png') })
  await entry.locator('[name="year"]').selectOption(String(year + 1))
  await entry.getByText('该年度暂无已发布预算主版本，请先完成预算编制并发布，或选择已有主版本的年度。', { exact: true }).waitFor()
  assert.equal(await submitBudget.isDisabled(), true)
  await page.screenshot({ path: resolve(evidence, 'entry-budget-no-primary.png') })
  await entry.locator('[name="year"]').selectOption(String(year))
  await page.waitForFunction(() => !document.querySelector('form.sf-card button[type="submit"]')?.disabled)
  failBudgetEntry = false
  await submitBudget.click()
  await entry.getByText('已提交', { exact: true }).waitFor()
  assert.equal(await entry.locator('[name="budgetAmount"]').inputValue(), '')
  assert.equal(await entry.locator('[name="costItemId"]').inputValue(), '')
  assert.equal(await entry.getByRole('combobox', { name: '搜索费用科目', exact: true }).inputValue(), '')
  // Directory outages are visible and retryable, and cannot be mistaken for empty payment history.
  await entry.getByRole('tab', { name: '付款计划', exact: true }).click()
  failCostCatalog = true
  await entry.getByRole('tab', { name: '预算行', exact: true }).click()
  await entry.getByText('费用科目加载失败，请重试。', { exact: true }).waitFor()
  assert.equal(await submitBudget.isDisabled(), true)
  failCostCatalog = false
  await entry.getByRole('button', { name: '重新加载', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('form.sf-card button[type="submit"]')?.disabled)
  await page.screenshot({ path: resolve(evidence, 'entry-budget-ready.png') })
  financeRole = 'BOSS'
  await recheckAccess()
  await page.locator('form.sf-card').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('form.sf-card').count(), 0)
  financeRole = 'FINANCE_OWNER'
  await recheckAccess()
  await page.locator('form.sf-card').waitFor()
  await page.locator('.sf-tabs').getByRole('button', { name: '预算编制', exact: true }).click()
  await page.getByLabel('编制预算版本', { exact: true }).selectOption('version-1')
  await page.getByLabel('预算参数版本', { exact: true }).selectOption('param-1')
  await page.getByRole('button', { name: '计算预算', exact: true }).waitFor()
  await page.getByLabel('计算结果批次', { exact: true }).selectOption('run-1')
  await page.getByRole('cell', { name: '200', exact: true }).first().waitFor()
  await page.screenshot({ path: resolve(evidence, 'engine-results.png') })
  await page.locator('.sf-tabs').getByRole('button', { name: '来源记录', exact: true }).click()
  await page.getByText('测试来源单据', { exact: true }).waitFor()
  await Promise.all([page.waitForResponse(response => response.url().includes('/data-source/records?scope=HEZHONG')), page.getByLabel('来源范围', { exact: true }).selectOption('HEZHONG')])
  await page.locator('.sf-tabs').getByRole('button', { name: '通知中心', exact: true }).click()
  await page.getByRole('button', { name: '标为已读', exact: true }).click()
  assert(mutations.some(call => call.path === '/finance/notifications/notification-1/read'))
  await page.locator('.sf-tabs').getByRole('button', { name: '来源记录', exact: true }).click()
  deniedPermissions.add('finance.source.review')
  await recheckAccess()
  await page.locator('.sf-tabs').getByRole('button', { name: '来源记录', exact: true }).waitFor({ state: 'hidden' })
  await page.getByRole('heading', { name: '经营总览', exact: true }).waitFor()
  deniedPermissions.clear()
  await recheckAccess()
  await page.locator('.sf-tabs').getByRole('button', { name: '深度分析', exact: true }).click()
  const analyses = page.locator('.sf-analysis-card button')
  const count = await analyses.count()
  assert(count >= 7)
  for (let i = 0; i < count; i++) {
    await page.locator('.sf-analysis-card button').nth(i).click()
    await page.waitForFunction(expected => window.analysisPrompts.length === expected, i + 1)
    await page.locator('.sf-overlay').waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: '财务管理', exact: true }).click()
    if (i + 1 < count) await page.locator('.sf-tabs').getByRole('button', { name: '深度分析', exact: true }).click()
  }
  assert.equal(await page.evaluate(() => window.analysisPrompts.length), count)
  const prompts = await page.evaluate(() => window.analysisPrompts)
  assert(prompts.every(prompt => typeof prompt === 'string' && /^\/finance-[a-z-]+\n[^\n]+/.test(prompt)))
  assert(prompts.filter(prompt => !/^\/finance-(?:data-quality|alert-rules-audit)\n/.test(prompt)).every(prompt => prompt.includes(String(year))))
  await page.locator('.sf-tabs').getByRole('button', { name: '预算执行', exact: true }).click()
  for (const button of await page.locator('.sf-pilltabs [role="tab"]').all()) await button.click()
  await page.locator('.sf-tabs').getByRole('button', { name: '经营总览', exact: true }).click()
  await page.locator('.sf-kpis').getByText('已打 PR', { exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.sf-pilltabs button[aria-selected="true"]')?.textContent?.includes('台账'))
  await page.locator('.sf-tabs').getByRole('button', { name: '经营总览', exact: true }).click()
  failBrief = true
  await page.getByRole('button', { name: '刷新数据', exact: true }).click()
  await page.locator('[role="alert"]').waitFor()
  await page.screenshot({ path: resolve(evidence, 'error.png') })
  failBrief = false
  await page.locator('[role="alert"] button').click()
  await page.locator('.sf-kpis').waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.sf-overlay').count(), 0)
  accessStatus = 503
  await recheckAccess()
  await page.getByRole('button', { name: '财务管理', exact: true }).waitFor()
  accessStatus = 200
  financeAllowed = false
  await recheckAccess()
  await page.getByRole('button', { name: '财务管理', exact: true }).waitFor({ state: 'hidden' })
  financeAllowed = true
  await recheckAccess()
  await page.getByRole('button', { name: '财务管理', exact: true }).click()
  await page.getByRole('heading', { name: '经营总览', exact: true }).waitFor()
  await page.locator('.sf-kpis').waitFor()
  await page.screenshot({ path: resolve(evidence, 'recovered.png') })
  assert.equal(await page.locator('vite-error-overlay').count(), 0)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, sections: 16, workflows: 'budget entry: labels, master-data IDs, missing-year preflight, 404 preservation, retry and role guard; planning, source scope, notification read, permission revocation', bom: 'permission, pagination, detail, partial failure, retry, revocation', analyses: count, requests: requests.length, evidence }))
} finally { await browser.close(); await vite.close() }
