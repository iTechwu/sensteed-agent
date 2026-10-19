import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'
const { chromium } = await import(process.env.FINANCE_PLAYWRIGHT_MODULE
  ? pathToFileURL(resolve(process.env.FINANCE_PLAYWRIGHT_MODULE)).href
  : new URL('../../../deepseek-harness/apps/web/node_modules/playwright/index.mjs', import.meta.url).href)
const root = resolve(import.meta.dirname, '../../..')
const source = resolve(process.env.FINANCE_CLIENT_SOURCE || resolve(root, '.ci/dsh-sensteed-finance/lib/client.js'))
const evidence = resolve(process.env.FINANCE_EVIDENCE_DIR || '/tmp/sensteed-finance-analysis-evidence')
await mkdir(evidence, { recursive: true })
const vite = await createServer({ root: resolve(import.meta.dirname, 'finance-analysis-harness'), server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'finance-analysis-source', configureServer(server) {
  server.middlewares.use('/__finance_source__', async (_request, response) => { response.setHeader('content-type', 'text/plain'); response.end(await readFile(source, 'utf8')) })
} }] })
await vite.listen()
let browser
try {
  browser = await chromium.launch({ headless: true, ...(process.env.FINANCE_CHROME_PATH ? { executablePath: process.env.FINANCE_CHROME_PATH } : {}) })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(10000)
  const errors = []
  const methods = []
  const external = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  let accessStatus = 200, assistantAllowed = true
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('synthetic clipboard denial') } } }))
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.hostname !== '127.0.0.1') { external.push(url.origin); return route.abort() }
    if (!url.pathname.startsWith('/api/desktop/')) return route.continue()
    methods.push({ path: url.pathname, method: request.method() })
    let body = { ok: true, data: { list: [], total: 0 } }, status = 200
    if (url.pathname.endsWith('/access')) {
      const assistant = url.searchParams.get('permission') === 'finance.assistant.read'
      status = assistant ? accessStatus : 200
      body = { ok: status === 200, allowed: assistant ? assistantAllowed : true }
    } else if (url.pathname.endsWith('/permissions/me')) body.data = { permissions: ['finance.assistant.read', 'budget.execution.read'] }
    else if (url.pathname.endsWith('/assignments/summary')) body.data = { fillablePending: 0, fillableDraft: 0, fillableRejected: 0, submitted: 0 }
    else if (url.pathname.endsWith('/members/me')) body.data = { role: 'FINANCE_STAFF', fullAccess: true }
    else if (url.pathname.endsWith('/context')) body.data = { orgs: [{ id: 'org-fixture', name: '合成验证主体' }], departments: [] }
    else if (url.pathname.endsWith('/status')) body = { status: 'bound', user: { name: '合成验证用户' } }
    else if (url.pathname.endsWith('/brief')) body.data = { budget: { budgetVersionId: 'fixture-version', list: [], totals: {} }, overview: {}, cash: { list: [] } }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  const url = `http://127.0.0.1:${vite.httpServer.address().port}/`
  await page.goto(url)
  assert.equal(page.url(), url)
  assert.equal(await page.title(), '财务分析入口验证')
  const enter = async () => {
    await page.getByRole('button', { name: '财务管理', exact: true }).click()
    await page.locator('.sf-tabs').getByRole('button', { name: 'AI 财务助手', exact: true }).click()
    await page.locator('.sf-analysis-grid .sf-analysis-card').first().waitFor()
    await page.locator('.sf-header-side select').selectOption('2027')
    await page.locator('.sf-header-side').getByRole('combobox', { name: '搜索全部主体（集团）' }).click()
    await page.getByRole('option', { name: '合成验证主体', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '2027 年 · 合成验证主体 (org-fixture)' }).waitFor()
  }
  await enter()
  assert.equal(await page.locator('.sf-analysis-grid .sf-analysis-card').count(), 9)
  await page.screenshot({ path: resolve(evidence, 'scope-desktop.png') })
  await page.evaluate(() => { window.analysisFixture.catalogMode = 'missing' })
  await page.locator('.sf-analysis-grid .sf-analysis-card button').first().click()
  const recovery = page.getByRole('textbox', { name: '本次未发送的分析指令（可手动复制）' })
  await recovery.waitFor()
  assert.match(await recovery.inputValue(), /^\/finance-monthly-risk\n/)
  await page.getByText(/当前会话缺少对应分析技能/).waitFor()
  assert.equal(await page.evaluate(() => window.analysisFixture.opened.length), 0)
  assert.equal(await page.evaluate(() => window.analysisFixture.sent.length), 0)
  await page.screenshot({ path: resolve(evidence, 'missing-skill-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  assert(await recovery.isVisible())
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.getByRole('alert').scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(evidence, 'missing-skill-mobile.png') })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => { window.analysisFixture.catalogMode = 'failed' })
  await page.locator('.sf-analysis-grid .sf-analysis-card button').first().click()
  await page.getByRole('alert').filter({ hasText: '无法核验分析技能' }).waitFor()
  assert.equal(await page.evaluate(() => window.analysisFixture.opened.length), 0)
  await page.evaluate(() => { window.analysisFixture.catalogMode = 'ready' })
  const createdBefore = await page.evaluate(() => window.analysisFixture.created.length)
  for (const state of [401, 403, 503, 'denied']) {
    accessStatus = state === 'denied' ? 200 : state
    assistantAllowed = state !== 'denied'
    await page.locator('.sf-analysis-grid .sf-analysis-card button').first().click()
    await page.getByText(state === 401 ? /登录已过期/ : state === 403 || state === 'denied' ? /当前账号没有财务助手权限/ : /无法核验财务助手权限/).waitFor()
    assert.equal(await page.evaluate(() => window.analysisFixture.created.length), createdBefore)
  }
  accessStatus = 200; assistantAllowed = true
  await page.evaluate(() => { window.analysisFixture.sendMode = 'rejected' })
  await page.locator('.sf-analysis-grid .sf-analysis-card button').first().click()
  await page.getByText(/会话未能接受分析请求/).waitFor()
  assert.equal(await page.evaluate(() => window.analysisFixture.opened.length), 0)
  await page.evaluate(() => { window.analysisFixture.sendMode = 'ready' })
  // The Host accepted the request, but navigation failed. Recovery must only reopen it.
  await page.evaluate(() => { window.analysisFixture.openMode = 'failed'; window.analysisFixture.sendMode = 'pending' })
  const beforeNavigationFailure = await page.evaluate(() => window.analysisFixture.created.length)
  await page.locator('.sf-analysis-grid .sf-analysis-card button').first().click()
  await page.waitForFunction(() => typeof window.analysisFixture.finishSend === 'function')
  await page.locator('.sf-tabs').getByRole('button', { name: '工作台', exact: true }).click()
  await page.locator('.sf-analysis-grid').waitFor({ state: 'hidden' })
  await page.locator('.sf-tabs').getByRole('button', { name: 'AI 财务助手', exact: true }).click()
  await page.locator('.sf-analysis-grid').waitFor()
  assert.equal(await page.locator('.sf-analysis-grid button:not(:disabled)').count(), 0)
  await page.evaluate(() => { window.analysisFixture.sendMode = 'ready'; window.analysisFixture.finishSend() })
  await page.getByRole('alert').filter({ hasText: '分析请求已提交，但暂时无法打开会话' }).waitFor()
  assert.equal(await recovery.count(), 0)
  assert.equal(await page.locator('.sf-analysis-grid button:not(:disabled)').count(), 0)
  const reopen = page.getByRole('button', { name: '打开已创建的会话', exact: true })
  // Remount the analysis view, then the whole finance panel. Both retain the receipt.
  await page.locator('.sf-tabs').getByRole('button', { name: '工作台', exact: true }).click()
  await page.locator('.sf-analysis-grid').waitFor({ state: 'hidden' })
  await page.locator('.sf-tabs').getByRole('button', { name: 'AI 财务助手', exact: true }).click()
  await reopen.waitFor()
  assert.equal(await page.locator('.sf-analysis-grid button:not(:disabled)').count(), 0)
  await page.locator('.sf-header-buttons').getByRole('button', { name: '关闭', exact: true }).click()
  await page.locator('.sf-analysis-grid').waitFor({ state: 'hidden' })
  await enter()
  await reopen.waitFor()
  assert.equal(await recovery.count(), 0)
  assert.equal(await page.locator('.sf-analysis-grid button:not(:disabled)').count(), 0)
  await reopen.click()
  await page.getByRole('alert').filter({ hasText: '分析请求已提交，但暂时无法打开会话' }).waitFor()
  const pending = await page.evaluate(() => window.analysisFixture)
  assert.equal(pending.created.length, beforeNavigationFailure + 1)
  assert.equal(pending.sent.length, 1)
  assert.equal(pending.opened.length, 0)
  assert.deepEqual(pending.openAttempts, [pending.sent[0].id, pending.sent[0].id])
  await page.screenshot({ path: resolve(evidence, 'submitted-navigation-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('alert').scrollIntoViewIfNeeded()
  assert(await reopen.isVisible())
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: resolve(evidence, 'submitted-navigation-mobile.png') })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => { window.analysisFixture.openMode = 'ready' })
  await reopen.click()
  await page.locator('.sf-analysis-grid').waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => window.analysisFixture.sent.length), 1)
  for (let index = 1; index < 9; index++) {
    await enter()
    await page.locator('.sf-analysis-grid .sf-analysis-card button').nth(index).click()
    await page.locator('.sf-analysis-grid .sf-analysis-card').first().waitFor({ state: 'hidden' })
  }
  const result = await page.evaluate(() => window.analysisFixture)
  assert.equal(result.sent.length, 9)
  assert.equal(new Set(result.sent.map(item => item.id)).size, 9)
  assert.deepEqual(result.opened, result.sent.map(item => item.id))
  for (const { prompt } of result.sent) { assert.match(prompt, /2027/); assert.match(prompt, /org-fixture/); assert.match(prompt, /合成验证主体/) }
  assert.equal(new Set(result.sent.map(item => item.prompt.split('\n')[0])).size, 9)
  assert.deepEqual(external, [])
  assert.equal(methods.some(({ path, method }) => path.includes('/sensteed/finance/') && method !== 'GET'), false)
  // Only the existing synthetic desktop identity-status read uses POST; finance APIs are GET.
  assert.equal(await page.locator('vite-error-overlay').count(), 0)
  // HTTP 401/403/503 console messages are the intentional failure fixtures.
  assert.deepEqual(errors.filter(message => !/Failed to load resource: the server responded with a status of (401|403|503)/.test(message)), [])
  console.log('finance-analysis browser: nine scoped sessions, accepted-request recovery across page/panel remounts, missing skill, login/permission/outage, send rejection, clipboard recovery and 390px layout passed; no external requests')
  console.log('evidence:', evidence)
} finally {
  await browser?.close()
  await vite.close()
}
