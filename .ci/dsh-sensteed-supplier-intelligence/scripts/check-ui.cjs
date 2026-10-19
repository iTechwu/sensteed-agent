/* Local, credential-free browser regression. Resolve optional tools via NODE_PATH. */
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const assert = require('node:assert/strict')
const { build } = require('esbuild')
const { chromium, expect } = require('playwright/test')

async function main() {
  const root = path.resolve(__dirname, '..')
  const output = process.env.SUPPLIER_UX_OUTPUT || await fs.mkdtemp(path.join(os.tmpdir(), 'supplier-pages-'))
  await fs.mkdir(output, { recursive: true })
  let contents = (await Promise.all(['head', 'desktop-navigation', 'styles', 'shell'].map(name => fs.readFile(path.join(root, 'src', `${name}.js`), 'utf8')))).join('\n')
  contents = contents.replace("require('@deepseek-ai/dsh-client-ui-primitives')", `({ Tooltip: ({children}) => children, IconShieldOutlineRegular: () => null, IconSearchOutlineRegular: () => null, IconRightUpOutlineRegular: () => null, IconRefreshOutlineRegular: () => h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', 'aria-hidden': true }, h('path', { d: 'M20 8a8 8 0 1 0 1 7M20 3v5h-5', fill: 'none', stroke: 'currentColor', strokeWidth: 2 })) })`)
  contents += `\nconst style = document.createElement('style'); style.textContent = css; document.head.appendChild(style); require('react-dom/client').createRoot(document.getElementById('root')).render(h(Workbench));`
  const result = await build({ stdin: { contents, resolveDir: root }, bundle: true, write: false, nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean), define: { 'process.env.NODE_ENV': '"development"' } })
  const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{color-scheme:light dark;--dsw-alias-bg-base:light-dark(#fff,#141817)}body{margin:0}#root{height:100dvh}</style><div id="root"></div><script src="/app.js"></script></html>'
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/app.js' ? 'application/javascript' : 'text/html; charset=utf-8')
    res.end(req.url === '/app.js' ? result.outputFiles[0].text : html)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.SUPPLIER_UX_BROWSER || 'chrome', headless: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const failures = [], calls = []
    page.on('pageerror', error => failures.push(error.message))
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes('Failed to load resource')) failures.push(message.text()) })
    const suppliers = [{ supplierId: 's1', displayName: '示例精密制造有限公司' }, { supplierId: 's2', displayName: '示例电子有限公司' }]
      .map(row => ({ ...row, verificationStatus: 'VERIFIED', monitoringScope: 'LEGAL_ENTITY_ONLY', updatedAt: '2026-10-20T01:00:00Z' }))
    const evidence = kind => [1, 2].map(i => ({ evidenceId: `${kind}${i}`, eventId: `event${i}`, supplierId: `s${i}`, supplierName: suppliers[i - 1].displayName, title: `${kind === 'media' ? '媒体线索' : '司法记录'}${i}`, reviewStatus: 'PENDING_REVIEW', summary: '本地测试样例，不代表真实企业风险。', source: '示例来源', sourceUrl: i === 1 ? 'https://example.com/evidence' : 'javascript:alert(1)', retrievedAt: '2026-10-20T01:00:00Z', reviews: [] }))
    let failDetail = false, failReport = false, failRegistry = false, failContext = false, emptyData = false
    let reviewDone = false, intakeDone = false, version = 0, fields = {}, planVersion = 0, read = false, slowEvidence = false
    const analyses = []
    await page.route('**/api/desktop/sensteed/supplier-risk/**', async route => {
      const request = route.request()
      if (request.method() === 'GET') return route.fulfill({ json: { allowed: true, scopeId: 'local-test-team' } })
      const { action, args } = request.postDataJSON()
      calls.push({ action, args })
      const reject = error => route.fulfill({ status: 409, json: { ok: false, error, scopeId: 'local-test-team' } })
      let data
      switch (action) {
        case 'supply_chain_workbench_overview_get': data = { counts: { suppliers: emptyData ? 0 : 2, pendingClues: emptyData ? 0 : 4 }, sources: [], changes: [] }; break
        case 'supply_chain_workbench_suppliers_list':
          if (failRegistry) return reject('supplier_list_incomplete')
          if (emptyData) { data = { items: [], total: 0 }; break }
          data = { items: suppliers.filter(row => !args.query || row.displayName.includes(args.query)), total: args.query ? suppliers.filter(row => row.displayName.includes(args.query)).length : suppliers.length }; break
        case 'supply_chain_workbench_evidence_list': {
          if (slowEvidence) await new Promise(resolve => setTimeout(resolve, 500))
          const items = (emptyData ? [] : evidence(args.kind)).filter(row => !args.supplierId || row.supplierId === args.supplierId)
          data = { items, total: items.length }; break
        }
        case 'supply_chain_workbench_evidence_get':
          if (failDetail) return reject('EVIDENCE_NOT_FOUND')
          data = { evidence: { ...evidence(args.kind).find(row => row.evidenceId === args.evidenceId), ...(reviewDone && args.evidenceId === 'media1' ? { reviewStatus: 'CONFIRMED' } : {}) } }; break
        case 'supply_chain_risk_event_review': data = { runId: 'review-fixture' }; break
        case 'supply_chain_supplier_create': case 'supply_chain_supplier_import': data = { runId: 'intake-fixture' }; break
        case 'supply_chain_run_get': {
          const done = args.runId === 'review-fixture' ? reviewDone : intakeDone
          data = { run: { terminal: done, status: done ? 'succeeded' : 'running', pollAfterSeconds: 1.5, result: done ? { created: 1 } : {} } }; break
        }
        case 'supply_chain_business_context_get': data = { version, evidenceVersion: 'fixture-evidence', context: { fields } }; break
        case 'supply_chain_business_analysis_list': data = { total: analyses.length, items: analyses }; break
        case 'supply_chain_business_context_save':
          if (failContext) return reject('VERSION_CONFLICT')
          fields = args.fields; data = { version: ++version }; break
        case 'supply_chain_business_analysis_save': analyses.unshift({ id: 'a1', version: 1, fields: args.fields }); data = { version: 1 }; break
        case 'supply_chain_weekly_report_plan_get': data = { plan: { version: planVersion, enabled: false, supplierIds: ['s1'], collectionBudget: 0 } }; break
        case 'supply_chain_weekly_report_plan_save': data = { plan: { ...args.fields, version: ++planVersion } }; break
        case 'supply_chain_weekly_reports_list': if (emptyData) { data = { items: [], unreadCount: 0 }; break } data = { total: 21, unreadCount: read ? 0 : 1, items: [{ reportId: 'r1', status: 'succeeded', isRead: read, summary: '本期测试报告', periodStart: '2026-10-12', periodEnd: '2026-10-19' }] }; break
        case 'supply_chain_weekly_report_get':
          if (failReport) return reject('REPORT_NOT_READY')
          data = { report: { reportId: 'r1', status: 'succeeded', isRead: read, content: { summary: '本地示例周报摘要' } } }; break
        case 'supply_chain_weekly_report_mark_read': read = true; data = {}; break
        default: throw new Error(`Unhandled fixture action: ${action}`)
      }
      await route.fulfill({ json: { ok: true, data, scopeId: 'local-test-team' } })
    })
    // Block external network: only our local page and mocked local API are allowed.
    await page.route('https://**/*', route => route.abort())
    const navigate = name => page.getByRole('navigation', { name: '供应商风险页面' }).getByRole('button', { name, exact: true }).click()
    const shot = async name => {
      await page.getByRole('heading', { name: '供应商风险', exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true, animations: 'disabled' })
    }
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await expect(page.getByText('暂无来源覆盖记录。', { exact: false })).toBeVisible()
    await shot('01-overview')
    await page.getByRole('button', { name: /供应商 2，查看记录/ }).click()
    await expect(page.getByRole('table')).toBeVisible()
    await page.getByRole('searchbox', { name: '搜索供应商' }).fill('精密')
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await expect(page.getByText('搜索“精密” · 找到 1 家供应商')).toBeVisible()
    await page.getByRole('button', { name: '清除筛选', exact: true }).click()
    await expect(page.getByRole('row')).toHaveCount(3)
    await page.getByRole('button', { name: '新增 / 导入', exact: true }).click()
    await page.getByRole('button', { name: '批量导入 CSV', exact: true }).click()
    await expect(page.getByLabel('CSV 内容')).toBeVisible()
    await page.getByRole('button', { name: '新增一家供应商' }).click()
    await page.getByLabel('供应商名称', { exact: true }).fill('本地测试供应商')
    await page.getByRole('button', { name: '确认新增' }).click()
    await expect(page.getByRole('button', { name: '确认新增' })).toBeDisabled()
    intakeDone = true
    await expect(page.getByText(/状态：已完成/)).toBeVisible({ timeout: 8000 })
    await page.getByRole('button', { name: '收起新增' }).click()
    await shot('02-suppliers')

    await navigate('工商与司法')
    await page.getByRole('combobox', { name: '按供应商筛选证据' }).selectOption('s2')
    await expect(page.getByRole('article')).toHaveCount(1)
    assert.equal(await page.getByRole('link', { name: '查看原文' }).count(), 0)
    failDetail = true
    await page.getByRole('button', { name: '查看证据', exact: true }).click()
    await expect(page.getByRole('button', { name: '返回证据列表' })).toBeVisible()
    await page.getByRole('button', { name: '返回证据列表' }).click()
    await expect(page.getByRole('button', { name: '查看证据', exact: true })).toBeFocused()
    failDetail = false
    await page.getByRole('button', { name: '清除证据筛选' }).click()
    await expect(page.getByRole('article')).toHaveCount(2)
    await shot('03-enterprise')

    await navigate('媒体舆情')
    await page.getByRole('button', { name: '查看证据', exact: true }).first().click()
    await page.getByLabel('核验原因').fill('已对照原始来源')
    await page.getByRole('button', { name: '返回证据列表' }).click()
    await page.getByRole('button', { name: '查看证据', exact: true }).last().click()
    await expect(page.getByLabel('核验原因')).toHaveValue('')
    await page.getByRole('button', { name: '返回证据列表' }).click()
    await page.getByRole('button', { name: '查看证据', exact: true }).first().click()
    await expect(page.getByLabel('核验原因')).toHaveValue('已对照原始来源')
    await page.getByRole('button', { name: '确认事件', exact: true }).click()
    await expect(page.getByRole('button', { name: '确认事件', exact: true })).toBeDisabled()
    reviewDone = true
    await expect(page.locator('.sr-detail .sr-status')).toHaveText('已确认', { timeout: 8000 })
    await shot('04-media')
    await page.getByRole('button', { name: '评估这条证据的业务影响' }).click()
    await expect(page.getByRole('heading', { name: suppliers[0].displayName, exact: true })).toBeVisible()
    await expect(page.locator('.sr-selected-evidence')).toContainText('媒体线索1')
    await page.getByLabel('可能影响（必填）').fill('可能影响装配进度')
    await page.getByRole('button', { name: '保存人工判断', exact: true }).click()
    await expect(page.getByText('人工判断已保存，可在历史分析中查看。')).toBeVisible()
    await page.getByRole('button', { name: '1 · 补充业务背景' }).click()
    await page.getByLabel('关键物料').fill('测试关键物料')
    failContext = true
    await page.getByRole('button', { name: '保存业务背景', exact: true }).click()
    await expect(page.getByLabel('关键物料')).toHaveValue('测试关键物料')
    failContext = false
    await page.getByRole('button', { name: '保存业务背景', exact: true }).click()
    await expect(page.getByText('业务背景已保存。可继续评估业务影响。')).toBeVisible()
    assert.ok(!('_baseVersion' in calls.findLast(row => row.action === 'supply_chain_business_context_save').args.fields))
    await shot('05-business')

    await navigate('风险周报')
    await expect(page.getByRole('heading', { name: '历史周报', exact: true })).toBeVisible()
    failReport = true
    await page.getByRole('button', { name: /本期测试报告/ }).click()
    await expect(page.getByRole('heading', { name: '周报详情', exact: true })).toBeFocused()
    await expect(page.getByRole('button', { name: '保存计划', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '收起周报' }).click()
    failReport = false
    await page.getByRole('button', { name: /本期测试报告/ }).click()
    await expect(page.getByText('本地示例周报摘要')).toBeVisible()
    await page.getByRole('button', { name: '标为已读', exact: true }).click()
    await expect(page.getByText('周报已标为已读。')).toBeVisible()
    await expect(page.getByRole('button', { name: /本期测试报告/ })).toContainText('已读')
    await shot('06-weekly')
    await page.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(page.getByText('21 条 · 第 2 / 2 页')).toBeVisible()
    await page.getByRole('button', { name: '上一页', exact: true }).click()
    await expect(page.getByText('21 条 · 第 1 / 2 页')).toBeVisible()
    await page.getByRole('checkbox', { name: suppliers[1].displayName, exact: true }).check()
    await page.getByRole('button', { name: '保存计划', exact: true }).click()
    await expect(page.getByText('周报计划已保存。')).toBeVisible()
    assert.deepEqual(calls.findLast(row => row.action === 'supply_chain_weekly_report_plan_save').args.fields.supplierIds, ['s1', 's2'])
    failRegistry = true
    await navigate('业务影响')
    await expect(page.getByRole('heading', { name: suppliers[0].displayName, exact: true })).toBeVisible()
    failRegistry = false

    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        for (const name of ['风险总览', '供应商台账', '工商与司法', '媒体舆情', '业务影响', '风险周报']) {
          await navigate(name)
          await expect(page.locator('.sr-content')).toBeVisible()
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth), `${name} overflow at ${width}/${scheme}`)
        }
      }
      await navigate('业务影响')
      await page.getByRole('button', { name: '1 · 补充业务背景' }).click()
      await expect(page.getByLabel('关键物料')).toBeVisible()
      const color = await page.getByLabel('关键物料').evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }))
      assert.notEqual(color.bg, color.fg)
      await shot(`business-${scheme}`)
    }
    slowEvidence = true
    await navigate('工商与司法')
    await page.getByRole('button', { name: '刷新数据', exact: true }).click()
    await expect(page.getByText('正在读取已归集数据…').first()).toBeVisible()
    await expect(page.getByRole('button', { name: '查看证据', exact: true }).first()).toBeVisible()
    await navigate('风险总览')
    await page.getByRole('button', { name: '核对工商与司法线索', exact: true }).click()
    await expect(page.getByRole('combobox', { name: '按核验状态筛选' })).toHaveValue('PENDING_REVIEW')
    await expect(page.getByRole('combobox', { name: '按供应商筛选证据' })).toHaveValue('')
    await page.getByRole('button', { name: '清除证据筛选', exact: true }).click()
    // Empty states must explain a next action, rather than imply that no data means no risk.
    emptyData = true
    await navigate('风险总览')
    await expect(page.getByText('暂无来源覆盖记录。', { exact: false })).toBeVisible()
    await navigate('供应商台账')
    await expect(page.getByRole('heading', { name: '当前团队尚未导入供应商' })).toBeVisible()
    for (const name of ['工商与司法', '媒体舆情']) {
      await navigate(name)
      const back = page.getByRole('button', { name: '返回证据列表' })
      if (await back.count()) await back.click()
      await expect(page.getByRole('heading', { name: '暂无已归集证据' })).toBeVisible()
    }
    await navigate('业务影响')
    await page.getByRole('button', { name: '更换供应商', exact: true }).click()
    await expect(page.getByText('暂无供应商，请先在台账中新增或导入。')).toBeVisible()
    await navigate('风险周报')
    await expect(page.getByText('暂无已生成周报。', { exact: false })).toBeVisible()
    assert.deepEqual(failures, [])
    console.log(`PASS: all six pages, filters, intake, evidence error/review, business save, weekly isolation/read/scope, six empty states, 36 theme/viewport/page checks. Screenshots: ${output}`)
  } finally {
    await browser?.close()
    await new Promise(resolve => server.close(resolve))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
