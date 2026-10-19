import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Readable } from 'node:stream'
import { apply } from '../index.js'
import { PUBLIC_FINANCE_ROUTES } from '../public-routes.js'

const source = await readFile(new URL('../src/views/revenue-adjustment.js', import.meta.url), 'utf8')
const reviewSource = await readFile(new URL('../src/views/review.js', import.meta.url), 'utf8')
const nodes = tree => tree && typeof tree === 'object' ? [tree, ...(tree.children || []).flatMap(nodes)] : []
const find = (tree, type) => nodes(tree).find(node => node.type === type)
const okButton = tree => tree.props.footer.find(button => button.props.key === 'ok')
const plan = { id: 'revenue-plan-1', plannedAmount: 100, actualAmount: 60 }
const submitted = { id: 'revenue-adjustment-1', code: 'REV-1', oldAmount: 100, newAmount: 90, reason: 'reduction', status: 'SUBMITTED' }
const fullCtx = { permissions: ['cash.plan.write', 'cash.plan.verify', 'cash.plan.adjustment.approve'], financeWriter: true, year: 2027, orgId: 'org-1', revision: 0 }

function harness({ post = async () => ({ data: { id: 'draft-1' } }), run = async () => ({}), list = { list: [submitted], total: 21 }, detail = { ...submitted, logs: [{ id: 'log-1', action: 'SUBMIT' }] } } = {}) {
  const values = [], refs = [], effects = [], paths = []
  let cursor = 0, refCursor = 0, effectCursor = 0
  const useState = initial => { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], value => { values[i] = typeof value === 'function' ? value(values[i]) : value }] }
  const useRef = initial => { const i = refCursor++; return refs[i] ||= { current: initial } }
  const useEffect = (effect, deps) => { const i = effectCursor++, key = JSON.stringify(deps); if (effects[i]?.key !== key) { effects[i]?.cleanup?.(); effects[i] = { key, cleanup: effect() } } }
  const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) })
  const components = Object.fromEntries(['Dialog', 'GhostButton', 'PrimaryButton', 'FormRow', 'Field', 'Textarea', 'Table', 'Pager', 'Select', 'Notice', 'FinanceResource', 'FinanceEvidence'].map(name => [name, name]))
  const resource = path => { paths.push(path); return { data: path ? path.includes('?') ? list : detail : null, loading: false, error: null } }
  const finite = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)
  const ui = new Function('h', 'useState', 'useRef', 'useEffect', 'post', 'finite', 'formatNumber', 'useFinanceAction', 'useFinanceResource', 'financeRows', 'financeColumns', 'financeDisplayValue', ...Object.keys(components), source + '\nreturn { RevenueAdjustmentDialog, validRevenueAdjustment, revenueAdjustmentActions, RevenueAdjustmentActionDialog, RevenueAdjustmentsQueue }')(
    h, useState, useRef, useEffect, post, finite, value => value == null ? null : String(value), () => ({ run, revision: 0, busy: false, notice: null }), resource, data => data?.list || [], fields => fields.map(([key, label]) => ({ key, label })), value => value, ...Object.values(components),
  )
  return { ui, paths, render: (name, props) => { cursor = refCursor = effectCursor = 0; return ui[name]({ t: key => key, ...props }) } }
}
const queueActions = (tree, row = submitted) => {
  const table = nodes(tree).find(node => node.type === 'Table' && node.props.tableId === 'finance-revenue-adjustments')
  return nodes(table.props.columns.find(column => column.key === 'actions').render(row)).filter(node => node.type === 'GhostButton')
}

test('income adjustment amount floor, precision and reason match the server contract', () => {
  const valid = harness().ui.validRevenueAdjustment
  for (const amount of ['90', '60', '150', '99999999999999.99']) assert.equal(valid(plan, amount, 'reason'), true)
  for (const amount of ['59.99', '100', '-1', '90.001', 'NaN', '', '100000000000000']) assert.equal(valid(plan, amount, 'reason'), false)
  assert.equal(valid(plan, '90', ' '.repeat(5)), false)
  assert.equal(valid(plan, '90', 'r'.repeat(501)), false)
  assert.equal(valid({ ...plan, actualAmount: null }, '90', 'reason'), false)
  assert.equal(valid({ ...plan, actualAmount: null }, '150', 'reason'), true)
  assert.equal(valid({ ...plan, actualAmount: 150 }, '120', 'reason'), false)
  assert.equal(valid({ ...plan, plannedAmount: null }, '150', 'reason'), false)
})

test('create and submit use revenue routes; an immediate second click and close cannot interrupt a pending draft', async () => {
  const writes = [], submits = []; let release, closed = 0
  const h = harness({ post: async (path, body) => { writes.push({ path, body }); await new Promise(resolve => { release = resolve }); return { data: { id: 'draft-1' } } } })
  const props = { plan, onClose: () => closed++, act: async (path, body) => { submits.push({ path, body }); return true } }
  let tree = h.render('RevenueAdjustmentDialog', props)
  find(tree, 'Field').props.onChange('90'); find(tree, 'Textarea').props.onChange(' reason ')
  tree = h.render('RevenueAdjustmentDialog', props)
  const pending = okButton(tree).props.onClick()
  await okButton(tree).props.onClick(); tree.props.onClose()
  assert.equal(writes.length, 1); assert.equal(closed, 0)
  release(); await pending
  assert.deepEqual(writes, [{ path: '/rest/finance/revenue-plans/revenue-plan-1/adjustments', body: { newAmount: 90, reason: 'reason' } }])
  assert.deepEqual(submits, [{ path: '/rest/finance/revenue-plan-adjustments/draft-1/submit', body: {} }])
  assert.equal(closed, 1)
})

test('submission failure locks saved amount and reason and retries the same draft without another create', async () => {
  let creates = 0, submits = 0, closed = 0
  const h = harness({ post: async () => { creates++; return { data: { id: 'draft-1' } } } })
  const props = { plan, onClose: () => closed++, act: async () => ++submits > 1 }
  let tree = h.render('RevenueAdjustmentDialog', props)
  find(tree, 'Field').props.onChange('90'); find(tree, 'Textarea').props.onChange('reason')
  await okButton(h.render('RevenueAdjustmentDialog', props)).props.onClick()
  tree = h.render('RevenueAdjustmentDialog', props)
  assert.equal(find(tree, 'Field').props.disabled, true); assert.equal(find(tree, 'Textarea').props.disabled, true)
  assert.ok(nodes(tree).some(node => node.props.role === 'alert'))
  await okButton(tree).props.onClick()
  assert.equal(creates, 1); assert.equal(submits, 2); assert.equal(closed, 1)
})

test('a saved draft remains retryable if the plan changes while submission is pending', async () => {
  let creates = 0, submits = 0
  const h = harness({ post: async () => { creates++; return { data: { id: 'draft-1' } } } })
  const props = { plan, onClose() {}, act: async () => ++submits > 1 }
  let tree = h.render('RevenueAdjustmentDialog', props)
  find(tree, 'Field').props.onChange('90'); find(tree, 'Textarea').props.onChange('reason')
  await okButton(h.render('RevenueAdjustmentDialog', props)).props.onClick()
  tree = h.render('RevenueAdjustmentDialog', { ...props, plan: { ...plan, actualAmount: 95 } })
  assert.equal(okButton(tree).props.disabled, false)
  await okButton(tree).props.onClick()
  assert.equal(creates, 1); assert.equal(submits, 2)
})

test('creation failure retains editable input and retry can create successfully', async () => {
  let creates = 0, closed = 0
  const h = harness({ post: async () => { if (++creates === 1) throw new Error('offline'); return { data: { id: 'draft-1' } } } })
  const props = { plan, onClose: () => closed++, act: async () => true }
  let tree = h.render('RevenueAdjustmentDialog', props)
  find(tree, 'Field').props.onChange('80'); find(tree, 'Textarea').props.onChange('reason')
  await okButton(h.render('RevenueAdjustmentDialog', props)).props.onClick()
  tree = h.render('RevenueAdjustmentDialog', props)
  assert.equal(find(tree, 'Field').props.value, '80'); assert.equal(find(tree, 'Field').props.disabled, false)
  assert.equal(find(tree, 'Textarea').props.value, 'reason')
  await okButton(tree).props.onClick()
  assert.equal(creates, 2); assert.equal(closed, 1)
})

test('income approve/reject require finance role, verify and dedicated approval; posting and cancel retain separate duties', () => {
  const actions = harness().ui.revenueAdjustmentActions
  for (const permissions of [[], ['cash.plan.verify'], ['cash.plan.adjustment.approve'], ['cash.plan.write']])
    assert.ok(!actions({ ...fullCtx, permissions }, 'SUBMITTED').some(([kind]) => ['approve', 'reject'].includes(kind)))
  assert.deepEqual(actions({ ...fullCtx, financeWriter: false }, 'SUBMITTED'), [])
  assert.deepEqual(actions(fullCtx, 'SUBMITTED').map(([kind]) => kind), ['approve', 'reject', 'cancel'])
  assert.deepEqual(actions({ ...fullCtx, permissions: ['cash.plan.verify'] }, 'APPROVED').map(([kind]) => kind), ['post'])
  assert.deepEqual(actions({ ...fullCtx, permissions: ['cash.plan.write'] }, 'DRAFT').map(([kind]) => kind), ['submit', 'cancel'])
  for (const status of ['POSTED', 'REJECTED', 'CANCELLED']) assert.deepEqual(actions(fullCtx, status), [])
})

test('queue scopes year and org before paging; status change resets page and approved rows offer posting without approving twice', () => {
  const h = harness(), props = { ctx: fullCtx }
  let tree = h.render('RevenueAdjustmentsQueue', props)
  assert.match(h.paths.find(Boolean), /year=2027&orgId=org-1&status=SUBMITTED/)
  assert.deepEqual(queueActions(tree).map(node => node.children.join('')), ['查看明细', '审批通过', '驳回', '撤销'])
  find(tree, 'Pager').props.onPage(2); tree = h.render('RevenueAdjustmentsQueue', props)
  assert.ok(h.paths.some(path => path?.includes('page=2')))
  find(tree, 'Select').props.onChange('APPROVED'); tree = h.render('RevenueAdjustmentsQueue', props)
  assert.ok(h.paths.some(path => path?.includes('page=1') && path.includes('status=APPROVED')))
  assert.deepEqual(queueActions(tree, { ...submitted, status: 'APPROVED' }).map(node => node.children.join('')), ['查看明细', '过账', '撤销'])
})

test('detail uses revenue detail route and shows audit rows, with explicit approved pending-post label', () => {
  const h = harness({ detail: { ...submitted, status: 'APPROVED', logs: [{ id: 'log-1', action: 'APPROVE' }] } }), props = { ctx: fullCtx }
  let tree = h.render('RevenueAdjustmentsQueue', props)
  queueActions(tree)[0].props.onClick(); tree = h.render('RevenueAdjustmentsQueue', props)
  assert.ok(h.paths.includes('/finance/revenue-plan-adjustments/revenue-adjustment-1'))
  assert.equal(nodes(tree).find(node => node.type === 'Table' && node.props.tableId === 'finance-revenue-adjustment-history').props.rows[0].action, 'APPROVE')
  assert.ok(nodes(tree).some(node => node.children.some(value => typeof value === 'string' && value.includes('已批准待过账'))))
})

test('reject and cancel use note dialogs, require concrete reasons and do not close on failed actions', async () => {
  for (const kind of ['reject', 'cancel']) {
    const writes = []; let closed = 0
    const h = harness(), props = { row: submitted, kind, label: kind === 'reject' ? '驳回' : '撤销', onClose: () => closed++, act: async (path, body) => { writes.push({ path, body }); throw new Error('denied') } }
    let tree = h.render('RevenueAdjustmentActionDialog', props)
    assert.equal(okButton(tree).props.disabled, true)
    await okButton(tree).props.onClick(); assert.equal(writes.length, 0)
    find(tree, 'Textarea').props.onChange(' specific reason ')
    await okButton(h.render('RevenueAdjustmentActionDialog', props)).props.onClick()
    tree = h.render('RevenueAdjustmentActionDialog', props)
    assert.deepEqual(writes, [{ path: `/finance/revenue-plan-adjustments/revenue-adjustment-1/${kind}`, body: { note: 'specific reason' } }])
    assert.equal(closed, 0); assert.equal(find(tree, 'Textarea').props.value, ' specific reason ')
    assert.ok(nodes(tree).some(node => node.props.role === 'alert'))
  }
  assert.ok(!source.includes('window.prompt'))
})

test('approve remains pending posting and posting submits no invented note or amount', async () => {
  for (const kind of ['approve', 'post']) {
    const writes = []; let closed = 0
    const h = harness(), props = { row: submitted, kind, label: kind, onClose: () => closed++, act: async (path, body) => { writes.push({ path, body }); return {} } }
    const tree = h.render('RevenueAdjustmentActionDialog', props)
    if (kind === 'approve') assert.ok(nodes(tree).some(node => node.children.some(value => typeof value === 'string' && value.includes('不会直接修改收入计划金额'))))
    await okButton(tree).props.onClick()
    assert.deepEqual(writes, [{ path: `/finance/revenue-plan-adjustments/revenue-adjustment-1/${kind}`, body: kind === 'post' ? {} : { note: '' } }])
    assert.equal(closed, 1)
  }
})

test('review income section composes an independent queue and does not request an undefined payment path', () => {
  const paths = [], h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) })
  const names = ['Card', 'FinanceResource', 'FinanceEvidence', 'KpiCard', 'Select', 'Notice', 'GhostButton', 'Table', 'Pager', 'Dialog', 'FinanceFormDialog', 'RevenueAdjustmentsQueue']
  const view = new Function('h', 'useFinanceViewState', 'useState', 'useEffect', 'useFinanceAction', 'useFinanceResource', 'financeRows', 'financeColumns', ...names, reviewSource + '\nreturn ReviewView')(
    h, (_ctx, _key, initial) => [typeof initial === 'function' ? initial() : initial, () => {}], initial => [initial, () => {}], () => {}, () => ({ revision: 0 }), path => { paths.push(path); return { data: {} } }, () => [], () => [], ...names,
  )
  const tree = view({ ctx: { ...fullCtx, drillParams: { section: 'revenue' } }, t: key => key })
  assert.ok(find(tree, 'RevenueAdjustmentsQueue'))
  assert.ok(!paths.some(path => path?.includes('undefined')))
  assert.ok(find(tree, 'Select').props.options.some(([id]) => id === 'plans'))
  assert.ok(find(tree, 'Select').props.options.some(([id]) => id === 'revenue'))
})

test('all eight public income routes traverse the real host proxy, preserve scope and strip forged identity', async () => {
  const calls = []; let handler
  const dispose = apply({
    hubMcp: { register: () => ({ dispose() {} }) },
    dofeAuth: { getDatasourceSession: () => ({ accessToken: 'test-session', tenantId: 'test-tenant', operator: 'test-actor' }) },
    webServer: { port: 38271, register: route => { handler = route.handler; return () => {} } },
  }, { fetch: async (url, options) => {
    if (String(url).includes('/permissions/workspace-access')) return { ok: true, status: 200, json: async () => ({ data: { allowed: true } }) }
    calls.push({ url: new URL(url), method: options.method, body: options.body ? JSON.parse(options.body) : null })
    return { ok: true, status: 200, json: async () => ({ code: 200, data: { id: 'result-1', list: [], total: 0, page: 2, limit: 20 } }) }
  } })
  const invoke = async (method, path, body = {}) => {
    const req = Readable.from(method === 'GET' ? [] : [Buffer.from(JSON.stringify(body))])
    Object.assign(req, { method, url: `/api/desktop/sensteed/finance/rest${path}`, socket: { remoteAddress: '127.0.0.1' }, headers: { origin: 'http://127.0.0.1:38271', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } })
    const response = { writeHead(status) { this.status = status }, end(value) { this.body = value ? JSON.parse(value) : null } }
    await handler(req, response)
    return response
  }
  try {
    const routes = PUBLIC_FINANCE_ROUTES.filter(([, path]) => /^\/finance\/(revenue-plan-adjustments(?:\/|$)|revenue-plans\/:id\/adjustments$)/.test(path))
    assert.equal(routes.length, 8)
    for (const [method, template] of routes) {
      const path = template.replace(':id', 'adjustment-1')
      const query = method === 'GET' && !template.includes(':id') ? '?year=2027&orgId=org-1&status=SUBMITTED&page=2&limit=20&operator=forged&tenantId=forged&unlisted=bad' : ''
      const response = await invoke(method, path + query, { newAmount: 90, reason: 'basis', note: 'specific', tenantId: 'forged', operator: 'forged', actorId: 'forged' })
      assert.equal(response.status, 200, `${method} ${template} must be publicly reachable`)
      const call = calls.at(-1)
      assert.equal(call.url.pathname, '/api' + path); assert.equal(call.method, method)
      if (query) assert.deepEqual(Object.fromEntries(call.url.searchParams), { year: '2027', orgId: 'org-1', status: 'SUBMITTED', page: '2', limit: '20' })
      if (method !== 'GET') assert.deepEqual(call.body, { newAmount: 90, reason: 'basis', note: 'specific' })
    }
    const count = calls.length
    assert.equal((await invoke('DELETE', '/finance/revenue-plan-adjustments/adjustment-1')).status, 404)
    assert.equal((await invoke('POST', '/finance/revenue-plan-adjustments/adjustment-1/patch')).status, 404)
    assert.equal(calls.length, count, 'unsupported methods/actions must not reach Datasource')
  } finally { dispose() }
})
