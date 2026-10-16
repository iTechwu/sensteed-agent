import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PUBLIC_FINANCE_ROUTES } from '../public-routes.js'

const source = (await Promise.all(['src/format.js', 'src/views/cash.js'].map(file => readFile(new URL('../' + file, import.meta.url), 'utf8')))).join('\n')
function harness({ api = async () => ({}), post = async () => ({ data: { id: 'draft-1' } }) } = {}) {
  const values = [], refs = [], effects = []
  let cursor = 0, refCursor = 0, effectCursor = 0
  const useState = initial => { const i = cursor++; if (!(i in values)) values[i] = initial; return [values[i], value => { values[i] = typeof value === 'function' ? value(values[i]) : value }] }
  const useRef = initial => { const i = refCursor++; return refs[i] ||= { current: initial } }
  const useEffect = (effect, deps) => { const i = effectCursor++, key = JSON.stringify(deps); if (effects[i]?.key !== key) { effects[i]?.cleanup?.(); effects[i] = { key, cleanup: effect() } } }
  const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) })
  const components = Object.fromEntries(['Dialog', 'GhostButton', 'PrimaryButton', 'FormRow', 'Field', 'Textarea', 'LinkButton', 'Table', 'Pager'].map(name => [name, name]))
  const ui = new Function('h', 'useState', 'useRef', 'useEffect', 'api', 'post', ...Object.keys(components), source + '\nreturn { IncreaseDialog, validPlanAdjustment, PlanPayments }')(h, useState, useRef, useEffect, api, post, ...Object.values(components))
  return { ui, render: (name, props) => { cursor = refCursor = effectCursor = 0; return ui[name]({ t: key => key, ...props }) }, settle: () => new Promise(resolve => setImmediate(resolve)) }
}
const nodes = tree => tree && typeof tree === 'object' ? [tree, ...(tree.children || []).flatMap(nodes)] : []
const find = (tree, type) => nodes(tree).find(node => node.type === type)
const button = tree => tree.props.footer.find(button => button.props.key === 'ok')
const plan = { id: 'plan-1', plannedAmount: 100, actualAmount: 50 }

test('both adjustment directions share actual-payment floor and decimal rules', () => {
  const { validPlanAdjustment: valid } = harness().ui
  for (const value of ['150', '60', '50']) assert.equal(valid(plan, value, 'reason'), true)
  for (const value of ['100', '49.99', '-1', '0.001', '', 'NaN']) assert.equal(valid(plan, value, 'reason'), false)
  assert.equal(valid({ ...plan, actualAmount: null }, '60', 'reason'), false)
  assert.equal(valid({ ...plan, plannedAmount: null }, '150', 'reason'), false)
  assert.equal(valid(plan, '150', '   '), false)
  assert.equal(valid({ ...plan, actualAmount: 0 }, '0', 'reason'), true)
})

test('a failed submit retains the draft and retries only submission; immediate double click is locked', async () => {
  const writes = [], submissions = []; let release; let closed = 0
  const h = harness({ post: async (path, body) => { writes.push({ path, body }); await new Promise(resolve => { release = resolve }); return { data: { id: 'draft-1' } } } })
  const props = { plan, onClose: () => closed++, act: async path => { submissions.push(path); return submissions.length > 1 } }
  let tree = h.render('IncreaseDialog', props)
  find(tree, 'Field').props.onChange('60'); find(tree, 'Textarea').props.onChange('reduction')
  tree = h.render('IncreaseDialog', props)
  const first = button(tree).props.onClick(); await button(tree).props.onClick(); tree.props.onClose()
  assert.equal(writes.length, 1); assert.equal(closed, 0)
  release(); await first
  tree = h.render('IncreaseDialog', props)
  assert.equal(find(tree, 'Field').props.disabled, true)
  await button(tree).props.onClick()
  assert.equal(writes.length, 1); assert.equal(submissions.length, 2); assert.equal(closed, 1)
  assert.equal(submissions[0], '/rest/finance/payment-plan-adjustments/draft-1/submit')
  assert.equal(submissions[0], submissions[1])
})

test('draft creation failure keeps amount and reason for retry', async () => {
  const h = harness({ post: async () => { throw new Error('denied') } })
  const props = { plan, onClose: () => assert.fail('must remain open'), act: () => assert.fail('must not submit') }
  let tree = h.render('IncreaseDialog', props)
  find(tree, 'Field').props.onChange('70'); find(tree, 'Textarea').props.onChange('reason')
  await button(h.render('IncreaseDialog', props)).props.onClick()
  tree = h.render('IncreaseDialog', props)
  assert.equal(find(tree, 'Field').props.value, '70'); assert.equal(find(tree, 'Textarea').props.value, 'reason')
  assert.ok(nodes(tree).some(node => node.props.role === 'alert'))
})

test('payment detail reads only the public route, preserves unknown amounts and payment evidence', async () => {
  const reads = [], row = { id: 'payment', amount: null, cashAmount: 0, acceptanceAmount: null, paidAt: '2027-01-01T16:00:00Z', evidence: 'RETURNED', status: '已退票' }
  const h = harness({ api: async path => { reads.push(path); return { data: { list: [row], total: 21, message: 'source unverified' } } } })
  const props = { planId: 'plan-1' }
  h.render('PlanPayments', props); await h.settle()
  let tree = h.render('PlanPayments', props); const table = find(tree, 'Table')
  assert.equal(table.props.columns.find(col => col.key === 'amount').render(row), '—')
  assert.equal(table.props.columns.find(col => col.key === 'cashAmount').render(row), '0')
  assert.equal(table.props.columns.find(col => col.key === 'paidAt').render(row), '2027-01-02')
  assert.match(table.props.columns.find(col => col.key === 'status').render(row), /paymentReturned/)
  find(tree, 'Pager').props.onPage(2); h.render('PlanPayments', props); await h.settle(); tree = h.render('PlanPayments', props)
  assert.deepEqual(reads, ['/rest/finance/payment-plans/plan-1/payments?page=1&limit=20', '/rest/finance/payment-plans/plan-1/payments?page=2&limit=20'])
  assert.ok(nodes(tree).some(node => node.children.includes('paymentCoverageUnknown')))
  assert.ok(PUBLIC_FINANCE_ROUTES.some(([method, path]) => method === 'GET' && path === '/finance/payment-plans/:id/payments'))
  assert.ok(!PUBLIC_FINANCE_ROUTES.some(([method, path]) => method === 'POST' && path === '/finance/payment-plans/:id/payments'))
})

test('payment source failure remains an error and supports retry', async () => {
  let calls = 0
  const h = harness({ api: async () => { if (++calls === 1) throw new Error('offline'); return { data: { list: [], total: 0 } } } })
  const props = { planId: 'plan-1' }
  h.render('PlanPayments', props); await h.settle()
  let tree = h.render('PlanPayments', props)
  assert.equal(tree.props.role, 'alert'); assert.equal(find(tree, 'Table'), undefined)
  find(tree, 'LinkButton').props.onClick(); h.render('PlanPayments', props); await h.settle(); tree = h.render('PlanPayments', props)
  assert.deepEqual(find(tree, 'Table').props.rows, [])
  assert.equal(find(tree, 'Table').props.empty, 'paymentNone')
})
