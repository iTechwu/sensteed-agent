import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

export async function verifyProfileRenderer({ url, cookie, rendererHeader }) {
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
  } catch (cause) {
    throw new Error(`Desktop renderer smoke failed: ${String(cause)}\n${errors.join('\n')}`, { cause })
  } finally {
    await browser.close()
  }
}
