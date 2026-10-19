/** Headless integration of shipped plugin clients and the actual Desktop sidebar. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = dirname(desktop)
const require = createRequire(resolve(workspace, '../deepseek-harness/apps/web/package.json'))
const local = createRequire(resolve(desktop, 'package.json'))
const { chromium } = require('playwright')
const fixture = await mkdtemp(resolve(tmpdir(), 'sensteed-business-navigation-'))
let server, browser
try {
  await writeFile(resolve(fixture, 'index.html'), '<!doctype html><html lang="zh-CN"><div id="root"></div><script type="module" src="/entry.tsx"></script></html>')
  const pluginSources = await Promise.all(['supplier-intelligence','finance','knowledge'].map(name => readFile(resolve(workspace, `.ci/dsh-sensteed-${name}/lib/client.js`), 'utf8')))
  await writeFile(resolve(fixture, 'entry.tsx'), `
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives';
import {DesktopNavigationFrame,DesktopNavigationSidebar} from '${desktop}/src/client/DesktopNavigation.tsx';
import {installDesktopNavigationStyles} from '${desktop}/src/client/desktop-navigation-styles.ts';
installDesktopNavigationStyles();
document.head.insertAdjacentHTML('beforeend','<style>html,body,#root{height:100%;margin:0;font:14px system-ui;--dsw-alias-bg-layer-1:#202020;--dsw-alias-bg-layer-2:#343434;--dsw-alias-border-l1:#444;--dsw-alias-label-primary:#eee;--dsw-alias-label-secondary:#aaa;--dsw-alias-brand-primary:#9cbfff}main{min-width:0}</style>');
const clients=new Map(), slots=new Map(), dictionaries={};let active=null, select=()=>{};
window.__ModuleLoader__={load({id,factory}){clients.set(id,factory(name=>name==='react'?React:primitives))}};
for(const source of ${JSON.stringify(pluginSources)}) new Function(source)();
const ctx={effect(fn){return fn()},locale:{register(ns,copy){dictionaries[ns]=copy},bind(ns){return key=>dictionaries[ns]?.zh?.[key]||key}},slots:{inject(name,fn){return fn()},register(options,Component){const key=options.name+':'+(options.key||options.id||'');slots.set(key,{options,Component});return()=>slots.delete(key)}},layout:{panelInfo:{getSnapshot:()=>({activePanelId:active})},selectPanel(id){active=id;select(id)}},sessions:{},uiWorkspace:{}};
for(const client of clients.values())client.apply(ctx);
function slot(name,owner,opts){const key=name+':'+(opts?.entryKey||opts?.only||'');const entry=slots.get(key);return entry?React.createElement(entry.Component,{...entry.options.inject?.(),...owner,...(entry.options.locale?{t:ctx.locale.bind(entry.options.locale)}:{})}):opts?.fallback||null}
function Frame(){const [panel,setPanel]=useState(null),[collapsed,collapse]=useState(false);select=setPanel;active=panel;return <div style={{display:'flex',height:'100%'}}><div style={{width:collapsed?0:280,overflow:'hidden'}}><DesktopNavigationSidebar collapsed={collapsed} width={280} startSession={()=>{}} toggleSidebar={()=>collapse(!collapsed)} selectPanel={id=>ctx.layout.selectPanel(id)} usePanels={s=>s([])} useExtensions={s=>s(['supplier-risk','dofe-sensteed-finance','dofe-sensteed-knowledge'])} usePanelInfo={s=>s({activePanelId:panel})} t={()=>'新聊天'} renderSlot={slot}/></div><div style={{flex:1,minWidth:0,background:'#181818',color:'#eee'}}>{panel?slot('main',{}, {entryKey:panel}):<h1>主页</h1>}</div></div>}
createRoot(document.getElementById('root')).render(<DesktopNavigationFrame Frame={Frame} frameProps={{}} platform="linux"/>);
window.__fixtureReady=true;
`)
  server = await createServer({ configFile: false, root: fixture,
    resolve: { alias: { react: dirname(local.resolve('react')), 'react-dom/client': local.resolve('react-dom/client'), 'react-dom': dirname(local.resolve('react-dom')), '@deepseek-ai/dsh-client-ui-primitives': local.resolve('@deepseek-ai/dsh-client-ui-primitives') }, dedupe: ['react', 'react-dom'] },
    optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [dirname(workspace), fixture] } },
  })
  await server.listen()
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  const errors = [], requests = []
  let denyKnowledge = false
  let holdAccess = true
  let releaseAccess
  const accessReady = new Promise(resolve => { releaseAccess = resolve })
  page.on('pageerror', error => { errors.push(error.message); console.error('Fixture page error:', error.stack) })
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()); requests.push(url.pathname)
    if (holdAccess && (url.pathname.endsWith('/access') || url.searchParams.has('access'))) await accessReady
    let body = { ok: true, data: { list: [], total: 0 }, scopeId: 'fixture-scope' }
    if (url.pathname.endsWith('/access') || url.searchParams.has('access')) body = { ok: true, allowed: !(denyKnowledge && url.pathname.endsWith('/knowledge')), scopeId: 'fixture-scope' }
    else if (url.pathname.endsWith('/permissions/me')) body = { ok: true, data: { permissions: ['cash.plan.read','budget.execution.read','budget.activity.read','finance.source.review','budget.activity.manage','budget.submission.verify','budget.submission.edit'] } }
    else if (url.pathname.endsWith('/members/me')) body = { ok: true, data: { role: 'FINANCE_OWNER', fullAccess: true } }
    else if (url.pathname.endsWith('/knowledge')) body = { scopeId: 'fixture-scope', status: 'ready', permissions: { allowed: true }, overview: { status: 'ready', data: {} }, capabilities: { tools: [] } }
    else if (url.pathname.includes('supplier-risk/call')) body = { ok: true, scopeId: 'fixture-scope', data: { items: [], list: [], total: 0, suppliers: [], counts: {}, changes: [] } }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  page.on('console', m => { if (m.type() === 'error') console.error('Fixture console:', m.text()) });
  await page.goto(server.resolvedUrls.local[0])
  await page.waitForFunction(() => window.__fixtureReady === true)
  for (const name of ['供应链管理', '财务管理', '企业知识']) {
    const launcher = page.getByRole('button', { name, exact: true })
    await launcher.waitFor({ state: 'visible' })
    assert.equal(await launcher.getAttribute('aria-busy'), 'true')
  }
  holdAccess = false; releaseAccess()
  await page.getByRole('button', { name: '供应链管理', exact: true }).click()
  const context = page.locator('.sensteedBusinessNavigation')
  await context.getByRole('button', { name: '供应商台账', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.sensteedBusinessNavigation [aria-current="page"]')?.textContent === '供应商台账')
  await page.getByRole('button', { name: '主页', exact: true }).click()
  await page.getByRole('button', { name: '供应链管理', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.sensteedBusinessNavigation [aria-current="page"]')?.textContent === '供应商台账')
  await page.getByRole('button', { name: '财务管理', exact: true }).click()
  await context.getByRole('button', { name: '资金分析', exact: true }).click()
  await page.locator('h1').filter({ hasText: '资金分析' }).waitFor()
  assert.equal(await page.locator('.sf-tabs').isVisible(), false)
  await page.getByRole('button', { name: '主页', exact: true }).click()
  await page.getByRole('button', { name: '财务管理', exact: true }).click()
  await page.locator('h1').filter({ hasText: '资金分析' }).waitFor()
  await page.getByRole('button', { name: '企业知识', exact: true }).click()
  await context.getByRole('button', { name: /知识图谱/ }).click()
  assert.equal(await page.locator('.yk-tabs').isVisible(), false)
  await page.getByRole('button', { name: '主页', exact: true }).click()
  await page.getByRole('button', { name: '企业知识', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.sensteedBusinessNavigation [aria-current="page"]')?.textContent.includes('图谱'))
  denyKnowledge = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.getByRole('heading', { name: '主页', exact: true }).waitFor()
  await page.getByRole('button', { name: '企业知识', exact: true }).waitFor({ state: 'hidden' })
  denyKnowledge = false
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.getByRole('button', { name: '企业知识', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.sensteedBusinessNavigation [aria-current="page"]')?.textContent.includes('总览'))
  await page.evaluate(() => window.dispatchEvent(new Event('sensteed:identity-changed')))
  await page.getByRole('heading', { name: '主页', exact: true }).waitFor()
  assert.ok(requests.some(path => path.includes('/finance')))
  assert.deepEqual(errors, [])
  console.log('Business navigation: three shipped plugins share real routes with Desktop, restore module positions, remove duplicate menus, and return home on identity change.')
} finally {
  await browser?.close(); await server?.close(); await rm(fixture, { recursive: true, force: true })
}
