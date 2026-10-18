import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
const source = (await Promise.all(['format', 'views/operations'].map(name => readFile(new URL(`../src/${name}.js`, import.meta.url), 'utf8')))).join('\n')
const { financeCashNet, financeBudgetTrend } = new Function(source + '\nreturn { financeCashNet, financeBudgetTrend }')()
test('actual net never substitutes planned amounts or treats missing actuals as zero', () => {
  const row = { year: 2026, month: 10, plannedIncome: 200, plannedExpense: 50, actualIncome: null, actualExpense: 80 }
  const result = financeCashNet([row])
  assert.equal(result.actual, null)
  assert.equal(result.list[0].planned, 150)
  assert.equal(result.list[0].actualComplete, false)
  assert.equal(financeCashNet([{ ...row, actualIncome: 80 }]).actual, 0)
  assert.equal(financeCashNet([]).actual, null)
  assert.equal(financeCashNet([{ ...row, actualIncome: 100 }, row]).actual, null)
})
test('execution trend aggregates scoped budget rows by month instead of global overview', () => {
  const rows = [{ month: 10, prSubmittedAmount: 10, prEstimatedAmount: 4, paidAmount: 2 }, { month: 10, prSubmittedAmount: 20, prEstimatedAmount: 1, paidAmount: 5 }, { month: 2, prSubmittedAmount: 0, paidAmount: 0 }]
  assert.deepEqual(financeBudgetTrend(rows).map(row => [row.month, row.prSubmittedAmount, row.paidAmount]), [[2, 0, 0], [10, 30, 7]])
})
