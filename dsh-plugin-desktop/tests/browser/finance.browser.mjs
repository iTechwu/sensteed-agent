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
    let body = { ok: true, data: { list: [], total: 0 } }
    const bomAccess = url.searchParams.get('permission') === 'cost.engineering.read'
    const status = url.pathname.endsWith('/access') ? bomAccess ? bomAccessStatus : accessStatus : url.pathname.endsWith('/rollup') ? bomRollupStatus : failBrief && url.pathname.endsWith('/brief') ? 502 : 200
    if (url.pathname.endsWith('/access')) body = { ok: status === 200, allowed: bomAccess ? bomAllowed : financeAllowed }
    if (url.pathname.endsWith('/bom/packages')) {
      bomPage = Number(url.searchParams.get('page'))
      body.data = { list: [{ id: 'pkg-1', name: bomPage === 1 ? '测试车型 BOM' : '第二页成本包', modelCode: 'EV-1', version: 'V1', status: 'APPROVED', targetCost: 1000 }], total: 21 }
      assert.equal(url.searchParams.has('year'), false)
      assert.equal(url.searchParams.has('orgId'), false)
    }
    if (url.pathname.endsWith('/bom/packages/pkg-1')) body.data = { package: { name: '测试车型 BOM' }, totalCost: 800, targetCost: 1000, nodeCount: 2, leafCount: 1, nodes: [{ id: 'node-1', partNo: 'EV-001', name: '测试电池', level: 1, qty: 2, unitCost: 400 }] }
    if (url.pathname.endsWith('/rollup')) body = bomRollupStatus === 200 ? { ok: true, data: { entries: [{ nodeId: 'node-1', extendedCost: 800 }] } } : { ok: false, error: '汇总暂不可用' }
    if (url.pathname.endsWith('/status')) body = { status: 'bound', user: { name: '测试用户' } }
    if (url.pathname.endsWith('/context')) body.data = { orgs: [{ id: 'org-1', name: '测试主体' }], departments: [{ id: 'dept-1', name: '测试部门' }] }
    if (url.pathname.endsWith('/brief')) body = failBrief ? { ok: false, error: '服务暂不可用' } : { ok: true, data: { year, overview: { metrics: { budgetAmount: 100000, prSubmittedAmount: 25000, prEstimatedAmount: 10000, paidAmount: 15000 }, trend: [{ month: 3, prSubmittedAmount: 25000, paidAmount: 15000 }], byOrg: [] }, cash: { list: [] }, alertsSummary: { total: 0 }, openAlerts: [] } }
    if (url.pathname.endsWith('/budget')) body = { ok: true, summary: { list: [], totals: {} }, lines: { list: [], total: 0 } }
    if (url.pathname.endsWith('/quality')) body = { ok: true, quality: { issues: [] }, batches: { list: [], total: 0 } }
    if (url.pathname.endsWith('/data-source-metrics')) body = { ok: true, data: [] }
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
  // Every top-level section must render, including empty-data state.
  for (const tab of ['预算执行', '经营分析', '资金分析', '预警中心', '数据中心', '录入', '深度分析']) {
    await page.locator('.sf-tabs').getByRole('button', { name: tab, exact: true }).click()
    await page.screenshot({ path: resolve(evidence, `tab-${tab}.png`) })
  }
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
  assert((await page.evaluate(() => window.analysisPrompts)).every(p => typeof p === 'string' && p.length > 40))
  await page.locator('.sf-tabs').getByRole('button', { name: '预算执行', exact: true }).click()
  for (const button of await page.locator('.sf-pilltabs button').all()) await button.click()
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
  console.log(JSON.stringify({ passed: true, sections: 9, bom: 'permission, pagination, detail, partial failure, retry, revocation', analyses: count, requests: requests.length, evidence }))
} finally { await browser.close(); await vite.close() }
