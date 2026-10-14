const FINANCE_REVIEW_SOURCES = [['filing', '填报复核'], ['facts', 'OA 批次核对'], ['budget', '预算调整'], ['plans', '付款计划调整']]
function ReviewView({ ctx }) {
  const [section, setSection] = useState('filing')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState([])
  const [dialog, setDialog] = useState(null)
  const [receipt, setReceipt] = useState(null)
  const action = useFinanceAction()
  const revision = `${ctx.revision}-${action.revision}`
  const summary = useFinanceResource('/finance/review/summary', revision)
  const paths = { filing: '/finance/filing/assignments?status=SUBMITTED', facts: '/data-source/fact-batches?status=PENDING_REVIEW', budget: '/finance/budget/adjustments?status=SUBMITTED', plans: '/finance/payment-plan-adjustments?status=SUBMITTED' }
  const list = useFinanceResource(`${paths[section]}&page=${page}&limit=20`, revision)
  const detailPath = dialog?.kind === 'detail' ? section === 'filing' ? `/finance/filing/assignments/${dialog.row.id}` : section === 'budget' ? `/finance/budget/adjustments/${dialog.row.id}` : section === 'plans' ? `/finance/payment-plan-adjustments/${dialog.row.id}` : null : null
  const detail = useFinanceResource(detailPath, revision)
  const batch = useFinanceResource(ctx.drillParams?.sourcePath?.match(/batch=([\w-]+)/)?.[1] ? `/finance/filing/batches/${ctx.drillParams.sourcePath.match(/batch=([\w-]+)/)[1]}` : null, revision)
  useEffect(() => { setSelected([]) }, [section, page, revision])
  const rows = financeRows(list.data)
  const selectedRows = rows.filter(row => selected.includes(row.id))
  const mixedTasks = new Set(selectedRows.map(row => row.taskId)).size > 1
  const canVerify = ctx.permissions.includes(section === 'facts' ? 'finance.source.review' : section === 'budget' ? 'budget.adjustment.approve' : section === 'plans' ? 'cash.plan.verify' : 'budget.submission.verify') && ctx.financeWriter
  const act = async (target, body) => { const result = await action.run(target, body); if (result?.results) setReceipt(result); return result }
  return h('div', { className: 'sf-stack' },
    h(Card, { title: '复核队列汇总' }, h(FinanceResource, { resource: summary }, h('div', { className: 'sf-kpis' }, ...(summary.data?.sources || []).map(row => h(KpiCard, { key: row.source, label: ({ FILING: '填报', FACT_BATCH: '事实批次', BUDGET_ADJUSTMENT: '预算调整', PLAN_ADJUSTMENT: '计划调整' })[row.source], value: row.pending }))))),
    h(Select, { 'aria-label': '复核类别', value: section, options: FINANCE_REVIEW_SOURCES, onChange: value => { setSection(value); setPage(1); setDialog(null) } }), h(Notice, null, action.notice),
    section === 'filing' && canVerify ? h(GhostButton, { disabled: !selected.length || mixedTasks || action.busy, onClick: () => setDialog({ kind: 'batch', title: `批量定稿（${selected.length} 条）` }) }, `批量定稿（已选 ${selected.length}${mixedTasks ? ' · 跨任务不可批量定稿' : ''}）`) : null,
    h(Card, { title: FINANCE_REVIEW_SOURCES.find(([id]) => id === section)[1], unit: '元' }, h(FinanceResource, { resource: list }, h(Table, { tableId: `finance-review-${section}`, rows, empty: '暂无待复核事项', columns: [
      ...(section === 'filing' && canVerify ? [{ key: 'select', label: '选择', sortable: false, render: row => h('input', { type: 'checkbox', 'aria-label': `选择 ${row.departmentName || row.id}`, checked: selected.includes(row.id), onChange: event => setSelected(current => event.target.checked ? [...current, row.id] : current.filter(id => id !== row.id)) }) }] : []),
      ...financeColumns(section === 'filing' ? [['taskTitle', '活动'], ['departmentName', '部门'], ['status', '状态'], ['rowCount', '行数'], ['submittedAt', '提交时间']] : section === 'facts' ? [['batchKey', '批次'], ['scope', '范围'], ['headerRows', '主表行数'], ['detailRows', '明细行数'], ['amountTotal', '金额（来源币种）'], ['currency', '币种']] : [['code', '单号'], ['reason', '原因'], ['status', '状态'], ['submittedAt', '提交时间']]),
      { key: 'actions', label: '操作', sortable: false, render: row => h('div', { className: 'sf-row' },
        h(GhostButton, { onClick: () => setDialog({ kind: 'detail', row, title: '事项明细' }) }, '查看明细'),
        canVerify ? h(GhostButton, { disabled: action.busy, onClick: () => setDialog({ kind: 'approve', row, title: section === 'facts' ? '确认发布事实批次' : section === 'filing' ? '确认定稿填报' : '审批通过' }) }, section === 'facts' ? '发布' : section === 'filing' ? '定稿' : '通过') : null,
        canVerify ? h(GhostButton, { disabled: action.busy, onClick: () => setDialog({ kind: 'reject', row, title: section === 'filing' ? '退回填报' : '驳回' }) }, section === 'filing' ? '退回' : '驳回') : null) },
    ] })), h(Pager, { page, total: list.data?.total, limit: 20, onPage: setPage })),
    receipt ? h(Card, { title: `批量回执：已确认 ${receipt.committed} · 失败 ${receipt.failed}` }, h(Table, { tableId: 'finance-review-receipt', rows: receipt.results || [], columns: financeColumns([['id', '填报'], ['ok', '结果'], ['error', '失败原因']]), empty: '暂无回执' })) : null,
    batch.data ? h(Card, { title: '通知关联的批量确认回执' }, h(FinanceEvidence, { value: batch.data })) : null,
    dialog?.kind === 'detail' ? h(Dialog, { title: dialog.title, onClose: () => setDialog(null) }, detailPath ? h(FinanceResource, { resource: detail }, h(FinanceEvidence, { value: detail.data })) : h(FinanceEvidence, { value: dialog.row })) : null,
    dialog && dialog.kind !== 'detail' ? h(FinanceFormDialog, { title: dialog.title, fields: dialog.kind === 'batch' ? [] : [{ key: section === 'filing' ? 'reason' : 'note', label: '复核说明', type: 'textarea', required: dialog.kind === 'reject' }], onClose: () => setDialog(null), onSubmit: async body => {
      if (dialog.kind === 'batch') {
        if (!selectedRows.length || mixedTasks) throw new Error('请选择同一填报任务内的指派')
        return act('/finance/filing/assignments/batch-commit', { ids: selected })
      }
      const id = dialog.row.id
      if (section === 'filing') return dialog.kind === 'approve' ? act('/finance/filing/assignments/batch-commit', { ids: [id] }) : act(`/finance/filing/assignments/${id}/reject`, body)
      if (section === 'facts') return act(`/data-source/fact-batches/${id}/review`, { ...body, decision: dialog.kind === 'approve' ? 'PUBLISH' : 'REJECT' })
      return act(`${section === 'budget' ? '/finance/budget/adjustments' : '/finance/payment-plan-adjustments'}/${id}/${dialog.kind === 'approve' ? 'approve' : 'reject'}`, body)
    } }) : null)
}
