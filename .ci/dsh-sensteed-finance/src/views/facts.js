function FactsView({ ctx }) {
  const [type, setType] = useState('payment')
  const path = { payment: '/finance/payment-fact-summary', budget: '/finance/budget-fact-summary', plan: '/finance/plan-fact-summary' }[type]
  const resource = useFinanceResource(`${path}?year=${ctx.year}`, ctx.revision)
  const data = resource.data
  const table = (id, title, rows, columns) => h(Card, { title }, h(Table, { tableId: `finance-facts-${id}`, rows: rows || [], columns: financeColumns(columns), empty: '暂无已发布事实' }))
  const planColumns = [['month', '月份'], ['plannedAmount', '计划金额（元）'], ['actualAmount', '实际金额（元）']]
  const paymentRows = data?.byScope?.flatMap(item => item.byCurrency.map(row => ({ ...row, scope: item.scope === 'HEADQUARTERS' ? '总部' : '合众' }))) || []
  return h('div', { className: 'sf-stack' },
    h(Select, { 'aria-label': '事实口径', value: type, options: [['payment', '已发布付款事实'], ['budget', '预算事实（正式与草稿分列）'], ['plan', '已发布收支计划事实']], onChange: setType }),
    h('p', { className: 'sf-banner sf-banner-amber' }, '全部主体，不随主体筛选变化。正式口径仅采用审核发布批次；草稿、暂存、不同来源、不同币种分列，不能直接相加。'),
    h(FinanceResource, { resource }, data ? type !== 'budget' && data.batches === 0
      ? h(EmptyState, null, '尚无已发布批次，暂不展示金额。')
      : type === 'payment' ? h(React.Fragment, null,
        table('currency', '应付与已付：范围、币种分列', paymentRows, [['scope', '范围'], ['currency', '币种'], ['payableRows', '应付行数'], ['payableAmount', '应付金额（来源币种）'], ['paidRows', '已付行数'], ['paidAmount', '已付金额（来源币种）']]),
        table('sources', '不同业务来源独立列示', (data.byScope || []).flatMap(item => [['oaPaid', 'OA 报销实付', 'paymentRows'], ['prSubmitted', '已打 PR', 'rows'], ['prEstimated', '预计 PR', 'rows']].map(([key, source, countKey]) => ({ scope: item.scope === 'HEADQUARTERS' ? '总部' : '合众', source, count: item[key]?.[countKey], amount: item[key]?.amount }))), [['scope', '范围'], ['source', '来源口径'], ['count', '行数'], ['amount', '来源汇总金额']]),
        h('p', { className: 'sf-note' }, '预计 PR 是预测口径，不能与已打 PR、OA 实付相加；来源汇总金额不代表币种统一后的金额。'))
      : type === 'budget' ? h(React.Fragment, null,
        table('budget', '预算正式与草稿独立列示', [['published', '正式预算（已发布 / 锁定）'], ['draft', '草稿预算（草稿 / 已确认）']].map(([key, status]) => ({ status, versions: data[key]?.versions, lines: data[key]?.lines, amount: data[key]?.versions ? data[key].amount : null })), [['status', '口径'], ['versions', '版本数'], ['lines', '明细行数'], ['amount', '金额（元）']]),
        table('draft-department', '草稿按部门分列（不计入正式预算）', (data.draftByDepartment || []).map(row => ({ ...row, department: row.department || '未归属' })), [['department', '部门'], ['lines', '明细行数'], ['amount', '草稿金额（元）']]))
      : h(React.Fragment, null,
        table('plan', '收支计划与实际独立列示', [['payment', '付款计划'], ['revenue', '收入计划']].map(([key, label]) => ({ label, ...data[key] })), [['label', '类型'], ['rows', '行数'], ['plannedAmount', '计划金额（元）'], ['actualAmount', '实际金额（元）']]),
        table('plan-type', '付款计划分类', (data.payment?.byType || []).map(row => ({ ...row, planType: ({ PURCHASE: '采购', REIMBURSEMENT: '报销', PAYROLL: '薪酬', TAX: '税费', OTHER: '其他' })[row.planType] || row.planType })), [['planType', '类型'], ['rows', '行数'], ['plannedAmount', '计划金额（元）'], ['actualAmount', '实际金额（元）']]),
        table('payment-month', '付款计划月度事实', data.payment?.byMonth, planColumns), table('revenue-month', '收入计划月度事实', data.revenue?.byMonth, planColumns)) : null))
}
