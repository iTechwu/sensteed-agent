import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '../../../deepseek-harness/apps/web/node_modules/playwright/index.mjs'
const root = resolve(import.meta.dirname, '../../..')
const evidence = resolve(root, 'dsh-plugin-desktop/dist/finance-evidence')
await mkdir(evidence, { recursive: true })
const vite = await createServer({ root: resolve(import.meta.dirname, 'finance-harness'), server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'finance-source', configureServer(server) {
  server.middlewares.use('/__finance_source__', async (_req, res) => { res.setHeader('content-type', 'text/plain'); res.end(await readFile(resolve(root, '../docker-helm.dofe.ai/plugins/dsh-sensteed-finance/lib/client.js'), 'utf8')) })
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
try {
  await page.route('**/api/desktop/**', async route => {
    const url = new URL(route.request().url()); requests.push(url.pathname + url.search)
    let body = { ok: true, data: { list: [], total: 0 } }
    if (url.pathname.endsWith('/status')) body = { status: 'bound', user: { name: '测试用户' } }
    if (url.pathname.endsWith('/context')) body.data = { orgs: [{ id: 'org-1', name: '测试主体' }], departments: [{ id: 'dept-1', name: '测试部门' }] }
    if (url.pathname.endsWith('/brief')) body = failBrief ? { ok: false, error: '服务暂不可用' } : { ok: true, data: { year, overview: { metrics: { budgetAmount: 100000, prSubmittedAmount: 25000, prEstimatedAmount: 10000, paidAmount: 15000 }, trend: [{ month: 3, prSubmittedAmount: 25000, paidAmount: 15000 }], byOrg: [] }, cash: { list: [] }, alertsSummary: { total: 0 }, openAlerts: [] } }
    if (url.pathname.endsWith('/budget')) body = { ok: true, summary: { list: [], totals: {} }, lines: { list: [], total: 0 } }
    if (url.pathname.endsWith('/quality')) body = { ok: true, quality: { issues: [] }, batches: { list: [], total: 0 } }
    await route.fulfill({ status: failBrief && url.pathname.endsWith('/brief') ? 502 : 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}`)
  await page.getByRole('button', { name: '财务管理', exact: true }).click()
  await page.getByRole('heading', { name: '经营总览', exact: true }).waitFor()
  await page.getByText('测试主体', { exact: true }).first().waitFor({ state: 'attached' })
  await page.screenshot({ path: resolve(evidence, 'overview.png') })
  // Every top-level section must render, including empty-data state.
  for (const tab of ['预算执行', '经营分析', '资金分析', '预警中心', '数据中心', '录入', '深度分析']) {
    await page.locator('.sf-tabs').getByRole('button', { name: tab, exact: true }).click()
    await page.screenshot({ path: resolve(evidence, `tab-${tab}.png`) })
  }
  const analyses = page.locator('.sf-analysis-card button')
  const count = await analyses.count()
  assert(count >= 7)
  for (let i = 0; i < count; i++) await analyses.nth(i).click()
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
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, sections: 8, analyses: count, requests: requests.length, evidence }))
} finally { await browser.close(); await vite.close() }
