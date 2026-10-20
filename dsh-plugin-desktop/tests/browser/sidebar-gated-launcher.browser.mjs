import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from '../../../deepseek-harness/apps/web/node_modules/playwright/index.mjs'

const source = await readFile(new URL('../../src/client/desktop-navigation-styles.ts', import.meta.url), 'utf8')
const css = source.split('style.textContent = `')[1].split('`')[0]
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.setContent(`<style>:root { --dsw-alias-bg-layer-2: rgb(230,230,230); } ${css}</style>
    <div class="sensteedModuleRail"><div class="sensteedModuleScroll">
      <div class="sensteedPluginRailSeat" data-module-icon><span class="sensteedRailGlyph">shield</span></div>
    </div></div>`)
  const seat = page.locator('.sensteedPluginRailSeat')
  assert.equal(await seat.isVisible(), false, 'a denied launcher must not leave a visible glyph')
  await seat.evaluate(element => {
    const button = document.createElement('button')
    button.setAttribute('aria-label', '供应链管理')
    button.onclick = () => { element.dataset.clicked = 'true' }
    element.prepend(button)
  })
  assert.equal(await seat.isVisible(), true)
  const button = seat.getByRole('button', { name: '供应链管理' })
  await button.hover()
  assert.equal(await button.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(230, 230, 230)')
  await button.click()
  assert.equal(await seat.getAttribute('data-clicked'), 'true')
  await button.evaluate(element => element.remove())
  assert.equal(await seat.isVisible(), false, 'revoking access must hide the glyph again')
  console.log('PASS: gated sidebar launcher visibility, hover and click')
} finally {
  await browser.close()
}
