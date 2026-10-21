import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

export async function verifyProfileRenderer({ url, cookie, rendererHeader, twoLevelNavigation = false }) {
  const require = createRequire(new URL('../../deepseek-harness/apps/web/package.json', import.meta.url))
  const { chromium } = require('playwright')
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  })
  const errors = []
  try {
    const page = await browser.newPage({
      extraHTTPHeaders: { [rendererHeader.name]: rendererHeader.value },
    })
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error' && errors.length < 20) errors.push(message.text().slice(0, 2_000))
    })
    const separator = cookie.indexOf('=')
    assert.ok(separator > 0)
    await page.context().addCookies([{
      name: cookie.slice(0, separator),
      value: cookie.slice(separator + 1),
      url: new URL(url).origin,
    }])
    const bootResponse = page.waitForResponse(response => {
      return new URL(response.url()).pathname === '/_dsh/desktop/renderer-boot'
        && response.request().method() === 'POST'
    }, { timeout: 25_000 })
    await Promise.all([
      page.goto(url, { waitUntil: 'domcontentloaded' }),
      bootResponse.then(response => {
        assert.equal(response.status(), 204)
        assert.deepEqual(response.request().postDataJSON(), { status: 'healthy' })
      }),
    ])
    await page.locator('[data-slot="main"]').first().waitFor({ state: 'attached', timeout: 5_000 })
    await page.locator('[data-slot="sidebar.workspaces"]').first().waitFor({ state: 'attached', timeout: 5_000 })
    if (twoLevelNavigation) {
      const rail = page.locator('.sensteedModuleRail')
      await rail.waitFor({ state: 'visible' })
      assert.equal(await rail.evaluate(element => element.getBoundingClientRect().width), 52)
      assert.equal(await rail.locator('[data-slot="sidebar.settings"]').count(), 1)
      assert.equal(await rail.locator('[data-slot="sidebar.workspaces"]').count(), 0)
      // This isolated Host intentionally retains its login gate; exercise shell actions directly.
      await rail.locator('.sensteedModuleFoot .sensteedModuleButton').last().evaluate(button => button.click())
      await page.waitForFunction(() => document.querySelector('.sensteedAgentSidebarSurface')?.getBoundingClientRect().width === 0)
      assert.equal(await rail.evaluate(element => element.getBoundingClientRect().width), 52)
      await rail.locator('.sensteedModuleFoot .sensteedModuleButton').last().evaluate(button => button.click())
      await page.waitForFunction(() => (document.querySelector('.sensteedAgentSidebarSurface')?.getBoundingClientRect().width ?? 0) >= 264)
      await rail.locator('[data-slot="sidebar.settings"] button').first().evaluate(button => button.click())
      const dialog = page.locator('[data-shortcut-modal="settings"]')
      await dialog.waitFor({ state: 'visible' })
      const labels = await dialog.locator('nav button').allTextContents()
      assert.equal(labels.length, new Set(labels).size, `Duplicate settings categories: ${labels}`)
      await page.keyboard.press('Escape')
      await rail.getByRole('button', { name: /^(自动化任务|Automation tasks)$/ }).evaluate(button => button.click())
      await page.locator('.sensteedBusinessNavigation input[aria-label="搜索自动化任务"]').waitFor({ state: 'attached' })
      assert.equal(await page.locator('.sensteedModuleContext').count(), 0)
      await rail.getByRole('button', { name: /^(插件|Plugins)$/ }).evaluate(button => button.click())
      const discovery = page.locator('.sensteedBusinessNavigation').getByRole('button', { name: '发现与安装', exact: true })
      await discovery.evaluate(button => button.click())
      assert.equal(await discovery.getAttribute('aria-current'), 'page')
      await rail.getByRole('button', { name: /^(技能|Skills)$/ }).evaluate(button => button.click())
      await page.locator('.sensteedBusinessNavigation').getByRole('button', { name: '本地技能', exact: true }).waitFor({ state: 'attached' })
    } else {
      assert.equal(await page.locator('.sensteedNavigationFrame').count(), 0)
    }
  } catch (cause) {
    throw new Error(`Desktop renderer smoke failed: ${String(cause)}\n${errors.join('\n')}`, { cause })
  } finally {
    await browser.close()
  }
}
