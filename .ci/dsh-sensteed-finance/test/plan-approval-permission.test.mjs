import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../src/views/review.js', import.meta.url), 'utf8')
function renderReview(permissions, financeWriter = true, section = 'plans') {
  const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) })
  const components = Object.fromEntries(['Card', 'FinanceResource', 'FinanceEvidence', 'KpiCard', 'Select', 'Notice', 'GhostButton', 'Table', 'Pager', 'Dialog', 'FinanceFormDialog'].map(name => [name, name]))
  const ReviewView = new Function('h', 'useFinanceViewState', 'useState', 'useEffect', 'useFinanceAction', 'useFinanceResource', 'financeRows', 'financeColumns', ...Object.keys(components), source + '\nreturn ReviewView')(
    h, (_ctx, _key, initial) => [typeof initial === 'function' ? initial() : initial, () => {}], initial => [initial, () => {}], () => {},
    () => ({ revision: 0, run() {} }), () => ({ data: { list: [{ id: 'a', code: 'ADJ-1', status: 'SUBMITTED' }] } }), data => data.list || [], () => [], ...Object.values(components),
  )
  return ReviewView({ ctx: { permissions, financeWriter, revision: 0, drillParams: { section } } })
}
const nodes = tree => tree && typeof tree === 'object' ? [tree, ...(tree.children || []).flatMap(nodes)] : []
function actions(tree) {
  const table = nodes(tree).find(node => node.type === 'Table')
  return nodes(table.props.columns.find(col => col.key === 'actions').render({ id: 'a' })).filter(node => node.type === 'GhostButton').map(node => node.children.join(''))
}

test('资金调整审批需专用授权与普通确认权同时满足，读明细仍可用', () => {
  for (const permissions of [[], ['cash.plan.verify'], ['cash.plan.adjustment.approve']]) {
    assert.deepEqual(actions(renderReview(permissions)), ['查看明细'])
  }
  const permissions = ['cash.plan.verify', 'cash.plan.adjustment.approve']
  assert.deepEqual(actions(renderReview(permissions)), ['查看明细', '通过', '驳回'])
  assert.deepEqual(actions(renderReview(permissions, false)), ['查看明细'])
})

test('专用资金审批授权不改变预算调整的审批资格', () => {
  assert.deepEqual(actions(renderReview(['budget.adjustment.approve'], true, 'budget')), ['查看明细', '通过', '驳回'])
  assert.deepEqual(actions(renderReview(['cash.plan.adjustment.approve'], true, 'budget')), ['查看明细'])
})
