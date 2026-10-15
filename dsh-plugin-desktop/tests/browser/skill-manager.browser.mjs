import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '../../../deepseek-harness/apps/web/node_modules/playwright/index.mjs'

const root = resolve(import.meta.dirname, '../../..')
const require = createRequire(resolve(root, 'dsh-plugin-desktop/package.json'))
const source = require.resolve('@dofe/dsh-sensteed-skill-manager/client')
const sibling = resolve(root, '../docker-helm.dofe.ai/plugins/dsh-sensteed-skill-manager/lib/client.js')
assert.equal(await readFile(source, 'utf8'), await readFile(sibling, 'utf8'), 'packaged skill manager must match its built source')
const evidence = '/tmp/sensteed-skill-manager-evidence'
await mkdir(evidence, { recursive: true })
const vite = await createServer({ root: resolve(import.meta.dirname, 'skill-manager-harness'), server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'skill-manager-source', configureServer(server) {
  server.middlewares.use('/__skill_source__', async (_request, response) => { response.setHeader('content-type', 'text/plain'); response.end(await readFile(source, 'utf8')) })
} }] })
await vite.listen()
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.setDefaultTimeout(10000)
const screenshot = async name => {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))
  })
  await page.screenshot({ path: resolve(evidence, name) })
}
const errors = []
page.on('pageerror', error => errors.push(error.message))
const skills = Array.from({ length: 140 }, (_, index) => ({
  name: index === 0 ? '销售周报' : index === 1 ? 'git-workflow-and-versioning-with-a-long-skill-name' : `skill-${String(index).padStart(3, '0')}`,
  description: index === 0 ? '读取销售数据，提取关键指标并生成管理层摘要。' : 'Structures git workflow practices. Use when committing, branching, resolving conflicts, or when organizing work across multiple parallel streams. '.repeat(3),
  source: index < 7 ? 'bundled' : 'user-dsh', provider: 'filesystem',
}))
const sharedSkills = [{ name: '公司经营分析', description: '每周汇总销售指标与财务数据', version: 3, sha256: 'fixture', canManage: true }]
let failInstall = true, failRefresh = false, posts = 0
try {
  await page.route('**/api/desktop/sensteed/skills**', async route => {
    if (route.request().method() === 'POST') {
      posts++
      assert.equal(route.request().postDataJSON().repository, 'https://github.com/example/weekly-report')
      await route.fulfill({ status: failInstall ? 422 : 200, contentType: 'application/json', body: JSON.stringify(failInstall ? { error: '技能结构无效，请检查后重试。' } : { skill: { name: 'weekly-report' } }) })
      return
    }
    await route.fulfill({ status: failRefresh ? 503 : 200, contentType: 'application/json', body: JSON.stringify(failRefresh ? { error: 'unavailable' } : { skills, sharedSkills }) })
  })
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}`)
  await page.locator('.sm-installed .sm-row').first().waitFor()
  assert.equal(await page.locator('.sm-installed .sm-row').count(), 140)
  const bounds = await page.evaluate(() => {
    const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON()
    return { heading: box('.sm-header'), toolbar: box('.sm-toolbar'), list: box('.sm-installed'), title: box('#sm-title') }
  })
  assert(bounds.heading.y >= 32 && bounds.title.width > 150)
  assert(bounds.toolbar.y >= bounds.heading.bottom && bounds.list.y >= bounds.toolbar.bottom)
  await screenshot('desktop-light.png')
  await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
  await screenshot('desktop-dark.png')
  await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'))

  await page.getByRole('button', { name: /^公司共享/ }).click()
  assert.equal(await page.locator('.sm-installed').count(), 0)
  await page.getByLabel('搜索技能名称或说明').fill('财务')
  await page.getByText('公司经营分析', { exact: true }).waitFor()
  await page.getByLabel('搜索技能名称或说明').fill('no-match')
  await page.getByText('没有匹配的技能', { exact: true }).waitFor()
  await page.getByLabel('搜索技能名称或说明').fill('')
  await page.getByRole('button', { name: /^全部/ }).click()
  await page.getByRole('button', { name: /^本机/ }).click()
  assert.equal(await page.locator('.sm-installed .sm-row').count(), 133)
  await page.getByRole('button', { name: /^内置/ }).click()
  assert.equal(await page.locator('.sm-installed .sm-row').count(), 7)
  await page.getByRole('button', { name: /^全部/ }).click()

  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const layout = await page.evaluate(() => ({ viewport: innerWidth, doc: document.documentElement.scrollWidth, page: document.querySelector('.sm-page').scrollWidth, client: document.querySelector('.sm-page').clientWidth, title: document.querySelector('#sm-title').getBoundingClientRect().height }))
    assert(layout.doc <= width && layout.page <= layout.client, `no horizontal overflow at ${width}: ${JSON.stringify(layout)}`)
    assert(layout.title < 40, `title must remain horizontal at ${width}`)
    await screenshot(`width-${width}.png`)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  const dropdown = page.getByRole('button', { name: '选择添加技能方式', exact: true })
  await dropdown.click()
  await page.getByRole('menuitem', { name: /让 Agent 创建/ }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('menu').waitFor({ state: 'hidden' })
  await dropdown.click()
  await page.getByRole('menuitem', { name: /安装第三方技能/ }).click()
  const dialog = page.getByRole('dialog', { name: '安装第三方技能', exact: true })
  await dialog.waitFor()
  const input = dialog.getByLabel('GitHub 仓库或技能目录链接')
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-modal-autofocus'))
  assert.equal((await page.locator('.sm-header').boundingBox()).y, bounds.heading.y)
  await input.fill('https://github.com/example/weekly-report')
  await screenshot('install-dialog.png')
  assert.equal(await dialog.evaluate(element => getComputedStyle(element).opacity), '1')
  await dialog.getByRole('button', { name: '安装', exact: true }).click()
  await dialog.getByRole('alert').waitFor()
  assert.equal(await input.inputValue(), 'https://github.com/example/weekly-report')
  failInstall = false
  await dialog.getByRole('button', { name: '安装', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByText('已安装 weekly-report', { exact: true }).waitFor()
  assert.equal(posts, 2)
  await page.getByRole('button', { name: '添加技能', exact: true }).click()
  await dialog.waitFor()
  // Tab stays in the shared modal; Escape restores focus to the opener.
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press('Tab')
    assert(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null))
  }
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), '添加技能')

  failRefresh = true
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByText('技能服务暂时不可用，请稍后重试。', { exact: false }).waitFor()
  assert.equal(await page.locator('.sm-installed .sm-row').count(), 140)
  failRefresh = false
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await page.locator('.sm-inline-error').waitFor({ state: 'hidden' })
  await page.evaluate(() => { window.failSkillCreation = true })
  await dropdown.click()
  await page.getByRole('menuitem', { name: /让 Agent 创建/ }).click()
  await page.getByRole('alert').getByText('无法开始创建技能，请重试。', { exact: true }).waitFor()
  assert.equal(await page.locator('textarea').count(), 0)
  await page.evaluate(() => { window.failSkillCreation = false; window.skillEvents = [] })
  await dropdown.click()
  await page.getByRole('menuitem', { name: /让 Agent 创建/ }).click()
  await page.getByRole('heading', { name: '创建技能', exact: true }).waitFor()
  await page.waitForFunction(() => window.skillEvents.some(event => event.type === 'release'))
  const events = await page.evaluate(() => window.skillEvents)
  assert.deepEqual(events.map(event => event.type), ['create', 'open', 'prompt', 'release'])
  assert.deepEqual(events[0].options, { workspaceId: 'workspace-fixture', agentPreset: 'cordis' })
  assert.match(events[2].messages[0].text, /^\/skill-creator\n\n请先询问/)
  assert.equal(events[2].mode, 'queue')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, source, skills: 140, viewports: [1440, 768, 390, 320], evidence }))
} finally { await browser.close(); await vite.close() }
