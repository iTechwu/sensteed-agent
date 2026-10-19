// 与网页经营分析统一：预算使用正式预算汇总，计划和实际收支分别展示。
function financeBudgetTrend(rows) {
  const months = new Map()
  for (const row of rows || []) {
    if (!row.month) continue
    const point = months.get(row.month) || { month: row.month, prSubmittedAmount: 0, prEstimatedAmount: 0, paidAmount: 0 }
    for (const key of ['prSubmittedAmount', 'prEstimatedAmount', 'paidAmount']) point[key] += finite(row[key]) ?? 0
    months.set(row.month, point)
  }
  return [...months.values()].sort((a, b) => a.month - b.month)
}
function financeCashNet(rows) {
  const months = new Map()
  for (const row of rows) {
    const key = `${row.year}-${String(row.month).padStart(2, '0')}`
    const point = months.get(key) || { label: key, month: row.month, planned: 0, actual: 0, plannedComplete: true, actualComplete: true }
    for (const kind of ['planned', 'actual']) {
      const income = finite(row[`${kind}Income`]), expense = finite(row[`${kind}Expense`])
      point[`${kind}Complete`] &&= income !== null && expense !== null
      point[kind] += (income ?? 0) - (expense ?? 0)
    }
    months.set(key, point)
  }
  const list = [...months.values()].sort((a, b) => a.label.localeCompare(b.label))
  return { list, actual: list.length && list.every(row => row.actualComplete) ? list.reduce((sum, row) => sum + row.actual, 0) : null }
}
function OperationsView({ brief, t, onDrill }) {
  if (!brief) return h(EmptyState, null, t('empty'))
  const data = brief.data || brief
  const budget = data.budget || {}
  const m = budget.totals || {}
  const net = financeCashNet(data.cash?.list || [])
  const exec = execRateOf(m.prSubmittedAmount, m.prEstimatedAmount, m.budgetAmount)
  const composition = new Map()
  for (const row of budget.list || []) composition.set(row.expenseType, (composition.get(row.expenseType) || 0) + (finite(row.budgetAmount) ?? 0))
  const segments = [...composition].map(([expenseType, value], index) => ({ expenseType, value, label: expenseType ? financeEnumLabel(expenseType, t, EXPENSE_LABELS) : '未分类', tone: ['a', 'b', 'c', 'd'][index % 4] }))
  const trend = financeBudgetTrend(budget.list).map(row => ({ label: mm(row.month), prSubmitted: row.prSubmittedAmount, prEstimated: row.prEstimatedAmount, paid: row.paidAmount }))
  return h('div', { className: 'sf-view' },
    budget.budgetVersionId == null ? h('p', { role: 'status', className: 'sf-banner sf-banner-amber' }, '当前年度尚未发布预算，不能将空汇总视为已批准零预算。') : null,
    h('div', { className: 'sf-kpis' },
      h(KpiCard, { icon: 'data', label: t('kpiExecRate'), value: ratio(exec, 1) ?? '—', hint: `${t('kpiBudget')} ${wan(m.budgetAmount) ?? '—'}`, onClick: () => onDrill('budget', { view: 'lines' }) }),
      h(KpiCard, { icon: 'plan', label: t('kpiPayRate'), value: ratio(m.paidAmount, m.prSubmittedAmount) ?? '—', hint: `${t('kpiPrSubmitted')} ${wan(m.prSubmittedAmount) ?? '—'}`, onClick: () => onDrill('budget', { view: 'ledger', recordType: 'SUBMITTED' }) }),
      h(KpiCard, { icon: 'goal', label: t('kpiNetInflow'), value: wan(net.actual) ?? '—', hint: net.actual === null ? '实际收支尚未补齐' : '实际收支口径', negative: net.actual !== null && net.actual < 0, onClick: () => onDrill('cash', { view: 'summary' }) })),
    h(Card, { title: '费用构成（年度预算）', unit: t('unitNote') },
      h(StackedShare, { segments }),
      h('div', { className: 'sf-row' }, ...segments.map(segment => h(GhostButton, { key: segment.expenseType || 'unknown', onClick: () => onDrill('budget', { view: 'lines', ...(segment.expenseType ? { expenseType: segment.expenseType } : {}) }) }, `${segment.label} · ${wan(segment.value)}`)))),
    h(Card, { title: t('trendTitle'), unit: t('unitNote') }, h(GroupedBars, { data: trend, series: [
      { key: 'prSubmitted', label: t('kpiPrSubmitted'), tone: 'a' }, { key: 'prEstimated', label: t('kpiPrEstimated'), tone: 'b' }, { key: 'paid', label: t('kpiPaid'), tone: 'c' },
    ], onBarClick: point => onDrill('budget', { view: 'month', month: Number(point.label) }) })),
    h(Card, { title: '收支净额：计划 vs 实际', unit: t('unitNote') },
      h('p', { className: 'sf-note' }, '计划与实际分别计算；任一主体缺少收支金额时，显示待补齐。'),
      h(Table, { tableId: 'finance-operations-net', rows: net.list, empty: t('empty'), onRowClick: row => onDrill('cash', { view: 'summary', month: row.month }), columns: [
        { key: 'label', label: '月份' },
        { key: 'planned', label: '计划净流入', num: true, render: row => row.plannedComplete ? wan(row.planned) : '待补齐' },
        { key: 'actual', label: '实际净流入', num: true, render: row => row.actualComplete ? wan(row.actual) : '待补齐' },
      ] })))
}
