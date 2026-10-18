import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
const read = name => readFile(new URL(`../src/${name}.js`, import.meta.url), 'utf8')
const source = (await Promise.all(['format', 'components', 'views/budget'].map(read))).join('\n')
const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) })
const ui = new Function('h', 'financeEnumLabel', 'EXPENSE_LABELS', 'PAGE_SIZE', source + '\nreturn { financeBudgetFilters, financeBudgetSavedQuery, financeBudgetVisible, MatrixView, MonthView, LinesView }')(h, value => value, {}, 20)
const nodes = tree => tree && typeof tree === 'object' ? [tree, ...(tree.children || []).flatMap(nodes)] : []
test('saved budget views round trip all dimensions using the web query names', () => {
  const original = { orgs: 'a,b', depts: 'd', expenses: 'PROJECT_OPERATION', months: '3,10', version: 'v', unassigned: '1', recordType: 'SUBMITTED' }
  const filters = ui.financeBudgetFilters(original)
  assert.deepEqual(filters.months, ['3', '10'])
  assert.deepEqual(ui.financeBudgetSavedQuery('lines', filters), { view: 'lines', ...original })
  assert.equal(ui.financeBudgetFilters({ version: 'primary', unassigned: true }, 'org').versionId, '')
  assert.equal(ui.financeBudgetFilters({ unassigned: true }, 'org').unassigned, false)
})
test('matrix drill retains row identities even for equal display names and real zero budgets', () => {
  const drills = []
  const row = { orgName: '同名主体', departmentName: '部门', expenseType: 'PROJECT_OPERATION', month: 10, budgetAmount: 0, prSubmittedAmount: 10 }
  const tree = ui.MatrixView({ budget: { summary: { list: [{ ...row, orgId: 'a', departmentId: 'd1' }, { ...row, orgId: 'b', departmentId: 'd2' }] } }, t: key => key, onCell: value => drills.push(value) })
  const table = tree.children[0]
  assert.equal(table.props.rows.length, 2)
  const cell = table.props.columns.find(column => column.key === 'month-10').render(table.props.rows[1])
  cell.props.onClick({ preventDefault() {} })
  assert.deepEqual(drills, [{ month: 10, orgId: 'b', departmentId: 'd2', expenseType: 'PROJECT_OPERATION' }])
})
test('monthly view uses the supplied month and pagination matches the requested 20 rows', () => {
  let month
  const tree = ui.MonthView({ budget: { summary: { list: [{ month: 10, paidAmount: 20 }, { month: 3, paidAmount: 999 }] } }, month: 10, onMonth: value => { month = value }, t: key => key })
  const table = nodes(tree).find(node => node.props.tableId === 'finance-MonthView-1')
  assert.equal(table.props.rows[0].paidAmount, 20)
  nodes(tree).find(node => node.children.includes('prevMonth')).props.onClick()
  assert.equal(month, 9)
  const list = ui.LinesView({ budget: { lines: { list: [], total: 41 } }, page: 2, onPage() {}, t: key => key })
  assert.equal(nodes(list).find(node => node.type?.name === 'Pager').props.limit, 20)
})
test('summary filters expense and month consistently while monthly view retains previous-month rows', () => {
  const budget = { summary: { list: [{ month: 3, expenseType: 'PROJECT_OPERATION' }, { month: 10, expenseType: 'PROJECT_OPERATION' }, { month: 10, expenseType: 'FIXED_OPERATION' }] } }
  const filters = ui.financeBudgetFilters({ expense: 'PROJECT_OPERATION', month: 10 })
  assert.equal(ui.financeBudgetVisible(budget, filters, 'matrix').summary.list.length, 1)
  assert.equal(ui.financeBudgetVisible(budget, filters, 'month').summary.list.length, 2)
})
test('business links preserve multiselect, pending assignment and historical comparison destinations', async () => {
  const resolve = new Function(await read('navigation') + '\nreturn financeBusinessDestination')()
  assert.deepEqual(resolve('/budget?unassigned=1&page=2&months=3,10&version=primary'), { tab: 'budget', params: { unassigned: true, page: 2, months: ['3', '10'] } })
  assert.deepEqual(resolve('/budget?view=snapshot-compare&year=2026&org=all'), { tab: 'comparisons', params: { mode: 'monthly', year: '2026', orgId: '' } })
  assert.deepEqual(resolve('/budget?view=versions'), { tab: 'comparisons', params: { mode: 'versions' } })
  assert.equal(resolve('/budget?orgs=invalid'), null)
})
