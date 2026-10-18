const BUDGET_HISTORY_ACTIONS = { COPY_ROUND: '复制预算新轮次', SAVE: '保存草稿', SUBMIT: '提交初审', INITIAL_APPROVE: '初审通过', FINAL_APPROVE: '终审通过', REJECT: '退回条目', DELETE: '删除条目', ASSIGN_OWNER: '明确归属', DEPARTMENT_SUBMIT: '部门提交', DEPARTMENT_CONFIRM: '财务确认', DEPARTMENT_REJECT: '财务退回', IMPORT_EXCEL: 'Excel 追加草稿' }
const BUDGET_HISTORY_CHANGES = { ADDED: '新增', MODIFIED: '修改', DELETED: '删除', UNCHANGED: '未变' }
function BudgetHistoryRows({ rows, label }) {
  return h('div', { className: 'sf-stack' },
    h('strong', null, `${label} · ${rows.length} 条 · ¥ ${budgetFilingMoney(rows.reduce((sum, row) => sum + row.plannedAmount, 0))}`),
    h('ul', null, ...rows.map(row => h('li', { key: row.id },
      [row.ownerName, row.costItemName, row.expenseType ? financeLabel(row.expenseType) : null, row.expenseMappingCode, `${row.month ?? '未分'}月`, `¥ ${budgetFilingMoney(row.plannedAmount)}`, row.description, BUDGET_FILING_STAGES[row.reviewStatus] || row.reviewStatus].filter(Boolean).join(' · ')))))
}
function BudgetFilingHistory({ id, onClose }) {
  const [page, setPage] = useState(1)
  const resource = useFinanceResource(`/finance/budget-filing/${id}/history?page=${page}&limit=20`, 0)
  const status = value => BUDGET_FILING_STAGES[value] || value || '无'
  return h(Dialog, { title: '预算变动历史', onClose },
    h('div', { className: 'sf-stack' },
      h('p', { className: 'sf-note' }, '仅展示本人或授权部门范围；提交快照保留当时的金额与说明。'),
      h(FinanceResource, { resource },
        resource.data?.roundChanges?.length ? h('section', { className: 'sf-inline-form sf-stack' },
          h('h3', null, '与上一轮逐项对比'),
          ...resource.data.roundChanges.map((item, index) => h('details', { key: index },
            h('summary', null, `${BUDGET_HISTORY_CHANGES[item.type] || item.type} · ${item.after?.costItemName || item.before?.costItemName} · ¥ ${budgetFilingMoney(item.before?.plannedAmount ?? 0)} → ¥ ${budgetFilingMoney(item.after?.plannedAmount ?? 0)}`),
            item.before ? h(BudgetHistoryRows, { label: '上一轮', rows: [item.before] }) : null,
            item.after ? h(BudgetHistoryRows, { label: '本轮', rows: [item.after] }) : null))) : null,
        !financeRows(resource.data).length ? h(EmptyState, null, '暂无可访问的操作记录。') : h('ol', { className: 'sf-stack sf-budget-history-list' },
          ...financeRows(resource.data).map(event => h('li', { key: event.id, className: 'sf-inline-form sf-stack' },
            h('strong', null, `${BUDGET_HISTORY_ACTIONS[event.action] || event.action} · ${event.actorName}`),
            h('p', { className: 'sf-note' }, new Date(event.at).toLocaleString('zh-CN')),
            event.reason ? h('p', null, '原因：' + event.reason) : null,
            event.beforeStatus || event.afterStatus ? h('p', null, `${status(event.beforeStatus)} → ${status(event.afterStatus)}`) : null,
            !event.snapshotAvailable ? h('p', null, '历史记录未保存条目快照，无法还原当时明细。')
              : h('details', null, h('summary', null, '查看当时明细'),
                event.before ? h(BudgetHistoryRows, { label: '变更前', rows: event.before }) : null,
                event.after ? h(BudgetHistoryRows, { label: '变更后', rows: event.after }) : null)))),
        resource.data ? h(Pager, { page, total: resource.data.total, limit: 20, onPage: setPage, disabled: resource.loading }) : null)))
}
