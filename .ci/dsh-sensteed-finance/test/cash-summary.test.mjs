import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function load() {
  const files = ['src/format.js', 'src/views/cash.js']
  const source = (await Promise.all(files.map(file => readFile(new URL('../' + file, import.meta.url), 'utf8')))).join('\n')
  const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) })
  const components = { KpiCard() {}, Card() {}, EmptyState() {}, Table() {} }
  return new Function('h', ...Object.keys(components), source + '\nreturn { SummaryTab, CashSummaryTable, model: typeof cashSummaryModel === "function" ? cashSummaryModel : null }')(h, ...Object.values(components))
}
function nodes(tree) {
  return tree && typeof tree === 'object' ? [tree, ...(tree.children || []).flatMap(nodes)] : []
}
const row = { id: 'oct', year: 2026, month: 10, actualBalance: 50, plannedIncome: 100, actualIncome: 80, plannedExpense: 70, actualExpense: 50, remainingPayment: 20 }
const now = new Date('2026-10-16T08:00:00Z')

test('cash summary shows current-month cash balance and preserves annual detail without a matrix', async () => {
  const ui = await load()
  const tree = ui.SummaryTab({ cash: { list: [row, { ...row, id: 'sep', month: 9, actualBalance: 900 }] }, year: 2026, now, t: key => key })
  const cards = nodes(tree).filter(node => node.type?.name === 'KpiCard')
  assert.equal(cards.find(node => node.props.label === 'cashBalance')?.props.value, '¥50.00')
  assert.equal(cards.find(node => node.props.label === 'plannedIncome')?.props.value, '¥100.00')
  assert.ok(nodes(tree).some(node => node.type?.name === 'CashSummaryTable'))
  assert.ok(!nodes(tree).some(node => node.type?.name === 'CashMatrix'))
})

test('a missing amount from one org stays unknown, while actual zero stays zero', async () => {
  const ui = await load()
  assert.ok(ui.model, 'summary must calculate the current month explicitly')
  const result = ui.model([row, { ...row, id: 'missing', actualBalance: null, plannedIncome: null }], 2026, now)
  assert.equal(result.totals.actualBalance, null)
  assert.equal(result.totals.plannedIncome, null)
  assert.equal(ui.model([{ ...row, actualBalance: 0 }], 2026, now).totals.actualBalance, 0)
})

test('historical rows and another selected year do not become current-month figures', async () => {
  const ui = await load()
  assert.ok(ui.model)
  assert.equal(ui.model([{ ...row, month: 9 }], 2026, now).rows.length, 0)
  assert.equal(ui.model([{ ...row, year: 2027 }], 2027, now).isCurrentYear, false)
  assert.equal(ui.model([row], 2026, new Date('2026-10-31T16:00:00Z')).month, 11)
})


test('annual detail reads the contracted previous-month balance field without losing a real zero', async () => {
  const ui = await load()
  const tree = ui.CashSummaryTable({ rows: [{ ...row, prevMonthEndBalance: 0 }], t: key => key })
  const column = tree.props.columns.find(column => column.key === 'prevMonthEndBalance')
  assert.ok(column)
  assert.equal(column.sortValue(tree.props.rows[0]), 0)
  assert.equal(column.render(tree.props.rows[0]), '0')
})
