import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = (await Promise.all(['src/format.js', 'src/views/cash-evidence.js'].map(file => readFile(new URL('../' + file, import.meta.url), 'utf8')))).join('\n')

function harness({ api = async () => ({ data: { list: [], total: 0, limit: 20 } }), post = async () => ({ data: {} }) } = {}) {
  const values = [], refs = [], effects = []
  let cursor = 0, refCursor = 0, effectCursor = 0
  const useState = initial => { const i = cursor++; if (!(i in values)) values[i] = initial; return [values[i], value => { values[i] = typeof value === 'function' ? value(values[i]) : value }] }
  const useRef = initial => { const i = refCursor++; return refs[i] ||= { current: initial } }
  const useEffect = (effect, deps) => { const i = effectCursor++, key = JSON.stringify(deps); if (effects[i]?.key !== key) { effects[i]?.cleanup?.(); effects[i] = { key, cleanup: effect() } } }
  const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) })
  const components = Object.fromEntries(['Dialog', 'GhostButton', 'PrimaryButton', 'FormRow', 'Field', 'Textarea', 'LinkButton', 'Table', 'Pager', 'Card', 'Select', 'SearchSelect', 'Notice'].map(name => [name, name]))
  const ui = new Function('h', 'useState', 'useRef', 'useEffect', 'api', 'post', ...Object.keys(components), source + '\nreturn { CashSettlementsSection, CashAccuracyView, CashAccuracyPeriod, CashAccuracySourceForms, financeSettlementBody, financeEvidenceAmount, financeBeijingInstant }')(h, useState, useRef, useEffect, api, post, ...Object.values(components))
  return { ui, render: (name, props) => { cursor = refCursor = effectCursor = 0; return ui[name]({ t: key => key, ...props }) }, settle: () => new Promise(resolve => setImmediate(resolve)) }
}
const nodes = tree => tree && typeof tree === 'object' ? [tree, ...(tree.children || []).flatMap(nodes)] : []
const text = tree => nodes(tree).map(node => String(node.children ?? '')).join('|')
const fields = tree => nodes(tree).filter(node => node.type === 'Field')
const primaryButtons = tree => nodes(tree).filter(node => node.type === 'PrimaryButton')
const checkboxes = tree => nodes(tree).filter(node => node.type === 'input' && node.props.type === 'checkbox')
const fileInput = tree => nodes(tree).find(node => node.type === 'input' && node.props.type === 'file')
const check = (tree, index) => checkboxes(tree)[index].props.onChange({ target: { checked: true } })
const upload = (tree, file) => fileInput(tree).props.onChange({ target: { files: [file] } })
const alerts = tree => nodes(tree).filter(node => node.props.role === 'alert')
const statuses = tree => nodes(tree).filter(node => node.props.role === 'status')

const ctx = { financeWriter: true, permissions: ['cash.plan.write', 'cash.plan.verify'] }
const ctxReadonly = { financeWriter: false, permissions: [] }

test('settlement body mirrors the server zod rules and converts Beijing time to UTC', () => {
  const { ui } = harness()
  const t = key => key
  const base = { direction: 'PAYMENT', planId: 'p-1', sourceId: 'TX-1', occurredAt: ui.financeBeijingInstant('2026-10-17T12:00'), currency: 'cny', amount: '120.5', note: '银行回单核对', sourceRef: 'OA/2026/TX-1.pdf' }
  const ok = ui.financeSettlementBody(t, base)
  assert.equal(ok.body.currency, 'CNY')
  assert.equal(ok.body.occurredAt, '2026-10-17T04:00:00.000Z')
  assert.equal(ok.body.cashAmount, null)
  assert.equal(ok.body.processNo, null)
  assert.equal(ok.body.reversesId, null)
  for (const patch of [{ sourceId: '  ' }, { amount: '0.001' }, { amount: '-1' }, { note: '' }, { sourceRef: '' }, { cash: '1.234' }]) {
    assert.ok(ui.financeSettlementBody(t, { ...base, ...patch }).error, `expected rejection for ${JSON.stringify(patch)}`)
  }
  const withSplit = ui.financeSettlementBody(t, { ...base, cash: '70.50', acceptance: '50' })
  assert.equal(withSplit.body.cashAmount, '70.50')
  assert.equal(withSplit.body.acceptanceAmount, '50')
  assert.ok(ui.financeSettlementBody(t, { ...base, amount: '1'.repeat(20) }).error)
  assert.ok(ui.financeSettlementBody(t, { ...base, occurredAt: null }).error)
})

test('settlement section stays read-only without write and verify permissions', () => {
  const h = harness()
  const tree = h.render('CashSettlementsSection', { planId: 'p-1', direction: 'PAYMENT', ctx: ctxReadonly })
  assert.equal(checkboxes(tree).length, 0)
  assert.equal(primaryButtons(tree).length, 0)
})

test('settlement registration requires the attestation, converts time, resets on success and keeps input on failure', async () => {
  const writes = []
  const h = harness({ post: async (path, body) => { writes.push({ path, body }); if (writes.length === 1) throw new Error('币种不一致'); return { data: {} } } })
  const props = { planId: 'p-1', direction: 'PAYMENT', ctx }
  let tree = h.render('CashSettlementsSection', props)
  assert.equal(primaryButtons(tree).find(node => String(node.children).includes('settlementRegister')).props.disabled, true, 'registration disabled before attestation')
  check(tree, 0)
  tree = h.render('CashSettlementsSection', props)
  fields(tree)[0].props.onChange('TX-9')
  nodes(tree).find(node => node.type === 'Field' && node.props.type === 'datetime-local').props.onChange('2026-10-17T12:00')
  fields(tree)[2].props.onChange('80')
  fields(tree)[3].props.onChange('cny')
  fields(tree)[7].props.onChange('OA/9.pdf')
  fields(tree)[8].props.onChange('回单已核对')
  tree = h.render('CashSettlementsSection', props)
  await primaryButtons(tree).find(node => String(node.children).includes('settlementRegister')).props.onClick()
  assert.equal(writes.length, 1)
  assert.equal(writes[0].path, '/rest/finance/cash-evidence/settlements')
  tree = h.render('CashSettlementsSection', props)
  assert.ok(alerts(tree).some(node => String(node.children).includes('币种不一致')), 'server reason is preserved')
  assert.equal(fields(tree)[0].props.value, 'TX-9', 'failed submit keeps the source id')
  await primaryButtons(tree).find(node => String(node.children).includes('settlementRegister')).props.onClick()
  assert.equal(writes.length, 2)
  assert.equal(writes[1].body.currency, 'CNY')
  assert.equal(writes[1].body.occurredAt, '2026-10-17T04:00:00.000Z')
  tree = h.render('CashSettlementsSection', props)
  assert.equal(fields(tree)[0].props.value, '', 'success resets the transaction id')
  assert.equal(fields(tree)[8].props.value, '回单已核对', 'success keeps the note like the web')
})

test('settlement JSON import enforces size, plan/direction match and success notice', async () => {
  const writes = []
  const h = harness({ post: async (path, body) => { writes.push({ path, body }); return { data: {} } } })
  const props = { planId: 'p-1', direction: 'RECEIPT', ctx }
  let tree = h.render('CashSettlementsSection', props)
  check(tree, 0)
  tree = h.render('CashSettlementsSection', props)
  const voucher = { planId: 'p-1', direction: 'RECEIPT', sourceSystem: 'PROJECT_ENTRY', sourceId: 'S-1', sourceRef: 'ref-1', occurredAt: '2026-10-17T04:00:00.000Z', currency: 'CNY', amount: '10', cashAmount: null, acceptanceAmount: null, processNo: null, reversesId: null, note: 'n' }
  await upload(tree, { size: 1024 * 1024 + 1, text: async () => JSON.stringify(voucher) })
  tree = h.render('CashSettlementsSection', props)
  assert.ok(alerts(tree).some(node => String(node.children).includes('settlementTooLarge')))
  await upload(tree, { size: 10, text: async () => JSON.stringify({ ...voucher, planId: 'other' }) })
  tree = h.render('CashSettlementsSection', props)
  assert.ok(alerts(tree).some(node => String(node.children).includes('settlementImportMismatch')))
  await upload(tree, { size: 10, text: async () => JSON.stringify(voucher) })
  await h.settle()
  assert.equal(writes.length, 1)
  assert.equal(writes[0].body.occurredAt, '2026-10-17T04:00:00.000Z')
  assert.equal(writes[0].body.direction, 'RECEIPT')
  tree = h.render('CashSettlementsSection', props)
  assert.ok(statuses(tree).some(node => String(node.children).includes('settlementImportOk')))
})

test('accuracy view demands an org, and a failed evidence load stays retryable', async () => {
  const h = harness()
  const empty = h.render('CashAccuracyView', { ctx: { ...ctx, orgId: '' }, year: 2027 })
  assert.ok(text(empty).includes('accuracyNeedOrg'))
  const failing = harness({ api: async () => { throw new Error('offline') } })
  const scoped = failing.render('CashAccuracyPeriod', { ctx: { ...ctx, orgId: 'org-1' }, year: 2027, month: 3, currency: 'CNY' })
  await failing.settle()
  const rerendered = failing.render('CashAccuracyPeriod', { ctx: { ...ctx, orgId: 'org-1' }, year: 2027, month: 3, currency: 'CNY' })
  assert.ok(text(rerendered).includes('accuracyLoadFail'))
  assert.ok(nodes(rerendered).some(node => node.type === 'LinkButton' && String(node.children).includes('accuracyRetryLoad')))
})

test('accuracy source forms gate capture, snapshot upload and rule confirmation', async () => {
  const writes = []
  const h = harness({ post: async (path, body) => { writes.push({ path, body }); return { data: {} } } })
  const scope = { orgId: 'org-1', year: 2027, month: 3, currency: 'CNY' }
  const props = { scope, onChanged: () => {} }
  let tree = h.render('CashAccuracySourceForms', props)
  const captureButtons = () => primaryButtons(tree).filter(node => String(node.children).includes('accuracyCapture'))
  assert.equal(captureButtons()[0].props.disabled, true, 'baseline capture needs note')
  fields(tree)[0].props.onChange('十月封存')
  tree = h.render('CashAccuracySourceForms', props)
  assert.equal(captureButtons()[0].props.disabled, false)
  assert.equal(captureButtons()[1].props.disabled, true, 'month-end capture needs cutoff')
  await captureButtons()[0].props.onClick()
  await h.settle()
  assert.equal(writes[0].path, '/rest/finance/cash-evidence/snapshots/capture')
  assert.equal(writes[0].body.kind, 'BASELINE')
  // 快照：>1MB 与范围不匹配都拒绝；匹配时整体转发。页面里快照声明是第一个复选框，规则确认是最后一个。
  const snapshotFile = mismatch => ({ size: 10, text: async () => JSON.stringify({ sourceSystem: 'PROJECT_ENTRY', sourceId: 's', sourceRef: 'r', attestation: 'a', snapshot: { orgId: mismatch ? 'org-2' : 'org-1', year: 2027, month: 3, currency: 'CNY', rows: [] } }) })
  check(tree, 0)
  tree = h.render('CashAccuracySourceForms', props)
  await upload(tree, { size: 1024 * 1024 + 1, text: async () => '{}' })
  tree = h.render('CashAccuracySourceForms', props)
  assert.ok(alerts(tree).some(node => String(node.children).includes('accuracySnapshotTooLarge')))
  check(tree, 0)
  tree = h.render('CashAccuracySourceForms', props)
  await upload(tree, snapshotFile(true))
  tree = h.render('CashAccuracySourceForms', props)
  assert.ok(alerts(tree).some(node => String(node.children).includes('accuracySnapshotScopeBad')))
  check(tree, 0)
  tree = h.render('CashAccuracySourceForms', props)
  await upload(tree, snapshotFile(false))
  await h.settle()
  assert.equal(writes.some(write => write.path === '/rest/finance/cash-evidence/snapshots'), true)
  // 规则签认：必填项不齐不发；勾选确认后携带归因布尔
  const ruleButton = () => primaryButtons(tree).find(node => String(node.children).includes('ruleConfirmAction'))
  assert.equal(ruleButton().props.disabled, true)
  const ruleFields = () => fields(tree).slice(-3)
  ruleFields()[0].props.onChange('v1')
  ruleFields()[1].props.onChange('0.01')
  ruleFields()[2].props.onChange('按财务核对口径')
  // 取消/延期归因规则：必选；选「排除」应映射为 excludeCancelled/excludeDeferred true
  const attributionSelects = () => nodes(tree).filter(node => node.type === 'Select' && node.props.placeholder === 'rulePickAttribution')
  attributionSelects()[0].props.onChange('exclude')
  attributionSelects()[1].props.onChange('include')
  tree = h.render('CashAccuracySourceForms', props)
  checkboxes(tree).at(-1).props.onChange({ target: { checked: true } })
  tree = h.render('CashAccuracySourceForms', props)
  assert.equal(ruleButton().props.disabled, false)
  await ruleButton().props.onClick()
  await h.settle()
  const ruleWrite = writes.find(write => write.path === '/rest/finance/cash-evidence/rules')
  assert.equal(ruleWrite.body.excludeCancelled, true)
  assert.equal(ruleWrite.body.excludeDeferred, false)
  assert.equal(ruleWrite.body.tolerance, '0.01')
})
