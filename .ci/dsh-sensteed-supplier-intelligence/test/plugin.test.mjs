import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

function loadHost(names = []) {
  const tools = new Map()
  const sections = []
  return import('../index.js').then(({ apply }) => {
    apply({
      tools: {
        schemas: () => names.map(name => ({ name })),
        register(value) { tools.set(value.name, value); return () => {} },
      },
      systemPrompt: { section(value) { sections.push(value); return () => {} } },
    })
    return { tools, sections }
  })
}

test('package registers the supply-chain MCP patch', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
  assert.equal(manifest.name, '@dofe/dsh-sensteed-supplier-intelligence')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.match(patch, /serverName: supply-chain/u)
  assert.match(patch, /https:\/\/ai\.hozonauto\.com\/mcp\/tools\/supply-chain/u)
  assert.doesNotMatch(patch, /authorizationCredential|api[_-]?key|token/u)
})

test('loads the skill as system guidance and registers a read-only bootstrap', async () => {
  const { tools, sections } = await loadHost([
    'mcp__supply-chain__supply_chain_suppliers_list',
    'mcp__supply-chain__supply_chain_qcc_company_search',
  ])
  assert.equal(sections[0].name, 'sensteed:supplier-intelligence-skill')
  assert.match(sections[0].text({}), /供应商全量归集与舆情分析/u)
  assert.match(sections[0].text({}), /QCC_MCP_UNAVAILABLE/u)
  const bootstrap = tools.get('sensteed_supplier_intelligence_bootstrap')
  assert.ok(bootstrap)
  assert.equal(bootstrap.isConcurrencySafe(), true)
  const result = await bootstrap.execute({})
  assert.equal(result.result.dataSource, 'local_tool_catalog')
  assert.equal(result.result.externalCallMade, false)
  assert.equal(result.result.tools.supply_chain_qcc_company_search, true)
})

test('skill preserves cache, verification, idempotency, and evidence boundaries', async () => {
  const skill = await readFile(new URL('skills/supplier-intelligence/SKILL.md', root), 'utf8')
  for (const token of [
    '30 分钟数据库优先缓存',
    'supply_chain_qcc_company_search',
    '禁止默认选第一条',
    'confirm=true',
    '稳定 `idempotencyKey`',
    '已核验供应商',
    'entitlement_required',
    'externalCallMade=false',
    '不能写成企业事实',
  ]) assert.match(skill, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  assert.doesNotMatch(skill, /Bearer\s+[A-Za-z0-9]/u)
})

test('supplier guidance and bootstrap follow the live product gate and tool connection', async () => {
  const { apply } = await import('../index.js')
  const listeners = new Map()
  const tools = new Map()
  let enabled = false
  let connected = true
  let section
  const dispose = apply({
    dofeAccess: () => ({ ready: true, enabledPlugins: enabled ? ['supplier-intelligence'] : [], entitlements: { plugins: enabled ? ['supplier-intelligence'] : [] } }),
    on(name, callback) { listeners.set(name, callback); return () => listeners.delete(name) },
    tools: {
      schemas: scope => connected && scope !== 'restricted' ? [{ name: 'mcp__supply-chain__supply_chain_suppliers_list' }] : [],
      register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) },
    },
    systemPrompt: { section(value) { section = value; return () => {} } },
  })
  assert.equal(tools.size, 0)
  assert.equal(section.text({}), '')
  enabled = true
  listeners.get('dofe/access-changed')()
  assert.equal(tools.size, 1)
  assert.match(section.text({}), /供应商/u)
  assert.equal(section.text({ scope: 'restricted' }), '')
  connected = false
  listeners.get('tools/change')()
  assert.equal(tools.size, 0)
  enabled = false
  assert.equal(section.text({}), '')
  dispose()
  assert.equal(listeners.size, 0)
})

test('workbench host adapter uses only the fixed gateway and hides the stored key', async () => {
  const { apply } = await import('../index.js')
  let route
  let request
  const dispose = apply({
    webServer: { port: 43123, register(value) { route = value; return () => {} } },
    dofeAccess: () => ({ ready: true, enabledPlugins: ['supplier-intelligence'], entitlements: { plugins: ['supplier-intelligence'] } }),
    tools: { schemas: () => [
      'supply_chain_workbench_overview_get', 'supply_chain_weekly_report_retry',
    ].map(name => ({ name: `mcp__supply-chain__${name}` })) },
    credentials: { async resolve(name) { assert.equal(name, 'MODELS_API_KEY'); return { value: 'fixture-only-secret' } } },
  }, { fetch: async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 'fixture', result: { structuredContent: { counts: { suppliers: 3 }, dataSource: 'database' } } }), { status: 200, headers: { 'content-type': 'application/json' } })
  } })
  const call = async ({ body = '{}', pathname = '/api/desktop/sensteed/supplier-risk/call' } = {}) => {
    const chunks = [Buffer.from(body)]
    const req = {
      method: 'POST', url: pathname, socket: { remoteAddress: '127.0.0.1' },
      headers: { origin: 'http://127.0.0.1:43123', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      async *[Symbol.asyncIterator]() { yield* chunks },
    }
    let status
    let payload
    const res = { writeHead(code) { status = code }, end(value) { payload = value } }
    await route.handler(req, res)
    return { status, payload: JSON.parse(payload || 'null') }
  }
  const read = await call({ body: JSON.stringify({ action: 'supply_chain_workbench_overview_get', args: {} }) })
  assert.equal(read.status, 200)
  assert.equal(read.payload.data.counts.suppliers, 3)
  assert.equal(read.payload.data.dataSource, 'database')
  assert.equal(request.url, 'https://ai.hozonauto.com/mcp/tools/supply-chain')
  assert.equal(request.options.headers.Authorization, 'Bearer fixture-only-secret')
  assert.doesNotMatch(JSON.stringify(read.payload), /fixture-only-secret/u)

  const forged = await call({ body: JSON.stringify({ action: 'supply_chain_workbench_overview_get', args: { tenantId: 'forged' } }) })
  assert.equal(forged.status, 400)
  assert.equal(forged.payload.error, 'invalid_arguments')
  const unlisted = await call({ body: JSON.stringify({ action: 'supply_chain_qcc_company_search', args: { query: 'example' } }) })
  assert.equal(unlisted.status, 404)
  const unconfirmed = await call({ body: JSON.stringify({ action: 'supply_chain_weekly_report_retry', args: { reportId: 'r1' } }) })
  assert.equal(unconfirmed.status, 400)
  assert.equal(unconfirmed.payload.error, 'confirmation_required')
  dispose()
})

test('client bundle registers a keyed main panel and a native sidebar panel row', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.exports['./client'], './lib/client.js')
  const bundle = await readFile(new URL('lib/client.js', root), 'utf8')
  assert.match(bundle, /key: PANEL_ID/u)
  assert.match(bundle, /name: 'sidebar\.panellist'/u)
  assert.doesNotMatch(bundle, /shell\.overlay|aria-modal/u)
  assert.match(bundle, /supply_chain_weekly_report_plan_save/u)
  assert.match(bundle, /supply_chain_business_analysis_save/u)
})

test('workbench and guidance honor the product Tools entitlement without granting disabled access', async () => {
  const { apply } = await import('../index.js')
  let gate = { ready: true, enabledPlugins: ['supplier-intelligence'], entitlements: { plugins: ['tools'] } }
  let connected = true
  let credential = { value: 'fixture-only-secret' }
  let route
  let section
  const tools = new Map()
  let externalCalls = 0
  const dispose = apply({
    dofeAccess: () => gate,
    webServer: { port: 43123, register(value) { route = value; return () => {} } },
    systemPrompt: { section(value) { section = value; return () => {} } },
    tools: {
      schemas: () => connected ? [{ name: 'mcp__tools-supply-chain__supply_chain_workbench_overview_get' }] : [],
      register(value) { tools.set(value.name, value); return () => tools.delete(value.name) },
    },
    credentials: { async resolve() { return credential } },
  }, { fetch: async () => {
    externalCalls++
    return new Response(JSON.stringify({ result: { structuredContent: { counts: { suppliers: 3 } } } }))
  } })
  const request = async (method = 'GET') => {
    let status
    let payload
    await route.handler({
      method, url: `/api/desktop/sensteed/supplier-risk/${method === 'GET' ? 'access' : 'call'}`,
      socket: { remoteAddress: '127.0.0.1' },
      headers: { origin: 'http://127.0.0.1:43123', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ action: 'supply_chain_workbench_overview_get', args: {} })) },
    }, { writeHead(value) { status = value }, end(value) { payload = JSON.parse(value) } })
    return { status, ...payload }
  }
  assert.equal((await request()).allowed, true)
  assert.match(section.text({}), /供应商/u)
  assert.ok(tools.has('sensteed_supplier_intelligence_bootstrap'))
  assert.equal((await request('POST')).status, 200)
  assert.equal(externalCalls, 1)

  for (const plugins of [['supplier-intelligence'], ['tools']]) {
    gate.entitlements.plugins = plugins
    assert.equal((await request()).allowed, true)
  }
  for (const [update, reason] of [
    [() => { gate.ready = false }, 'login_required'],
    [() => { gate.ready = true; gate.enabledPlugins = [] }, 'plugin_disabled'],
    [() => { gate.enabledPlugins = ['supplier-intelligence']; gate.entitlements.plugins = [] }, 'entitlement_required'],
    [() => { gate.entitlements.plugins = ['tools']; credential = undefined }, 'credential_unavailable'],
    [() => { credential = { value: 'fixture-only-secret' }; connected = false }, 'supply_chain_unavailable'],
  ]) {
    update()
    const access = await request()
    assert.equal(access.allowed, false)
    assert.equal(access.reason, reason)
    assert.equal((await request('POST')).ok, false)
  }
  assert.equal(externalCalls, 1, 'unavailable requests must not reach the gateway')
  dispose()
})
