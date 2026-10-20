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
  await page.locator('.sensteedModuleScroll').evaluate(element => {
    const button = document.createElement('button')
    button.className = 'sensteedModuleButton'
    button.setAttribute('aria-label', 'Home')
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 10 12 3 21 10V21H3Z" /></svg>'
    element.prepend(button)
  })
  const home = page.getByRole('button', { name: 'Home', exact: true })
  for (const primary of ['rgb(20, 20, 20)', 'rgb(240, 240, 240)']) {
    await page.evaluate(color => {
      document.documentElement.style.setProperty('--dsw-alias-label-primary', color)
      document.documentElement.style.setProperty('--dsw-alias-label-secondary', 'rgb(120, 120, 120)')
      document.documentElement.style.setProperty('--dsw-alias-bg-layer-1', color === 'rgb(20, 20, 20)' ? 'white' : 'black')
    }, primary)
    for (const active of [false, true, false]) {
      await home.evaluate((element, selected) => {
        if (selected) element.setAttribute('aria-current', 'page')
        else element.removeAttribute('aria-current')
      }, active)
      await home.hover()
      assert.equal(await home.locator('svg').isVisible(), true, `Home icon must remain visible when active=${active}`)
      await page.waitForFunction(expected => getComputedStyle(document.querySelector('[aria-label="Home"] svg')).color === expected, active ? primary : 'rgb(120, 120, 120)')
      assert.equal(await home.locator('svg').evaluate(element => getComputedStyle(element).strokeWidth), active ? '2.4px' : '1.8px')
    }
  }
  console.log('PASS: gated launcher and Home active icon visibility, colors, stroke, hover and click')
} finally {
  await browser.close()
}
