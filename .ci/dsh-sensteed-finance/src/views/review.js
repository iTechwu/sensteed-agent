const FINANCE_REVIEW_SOURCES = [['filing', '填报复核'], ['facts', 'OA 批次核对'], ['budget', '预算调整'], ['plans', '付款计划调整']]
function ReviewView({ ctx }) {
  // 深链定位（如旧资金页 tab=adjustments 迁移链接）直接落到对应复核类别。
  const [section, setSection] = useFinanceViewState(ctx, 'reviewSection', () => FINANCE_REVIEW_SOURCES.some(([id]) => id === ctx.drillParams?.section) ? ctx.drillParams.section : 'filing')
  const [page, setPage] = useFinanceViewState(ctx, 'reviewPage', 1)
  const [selected, setSelected] = useState([])
  const [dialog, setDialog] = useState(null)
  const [receipt, setReceipt] = useState(null)
  const action = useFinanceAction()
  const revision = `${ctx.revision}-${action.revision}`
  const summary = useFinanceResource('/finance/review/summary', revision)
  const paths = { filing: '/finance/filing/assignments?status=SUBMITTED', facts: '/data-source/fact-batches?status=PENDING_REVIEW', budget: '/finance/budget/adjustments?status=SUBMITTED', plans: '/finance/payment-plan-adjustments?status=SUBMITTED' }
  const list = useFinanceResource(`${paths[section]}&page=${page}&limit=20${section === 'filing' && ctx.drillParams?.taskId ? `&taskId=${encodeURIComponent(ctx.drillParams.taskId)}` : ''}`, revision)
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
    h(Card, { title: '复核队列汇总' }, h(FinanceResource, { resource: summary }, h('div', { className: 'sf-kpis' }, ...(summary.data?.sources || []).map(row => h(KpiCard, { key: row.source, label: ({ FILING: '填报', FACT_BATCH: '事实批次', BUDGET_ADJUSTMENT: '预算调整', PLAN_ADJUSTMENT: '计划调整' })[row.source], value: row.pending, onClick: () => { const next = ({ FILING: 'filing', FACT_BATCH: 'facts', BUDGET_ADJUSTMENT: 'budget', PLAN_ADJUSTMENT: 'plans' })[row.source]; if (next) { setSection(next); setPage(1); setDialog(null) } } }))))),
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
    dialog?.kind === 'detail' ? h(Dialog, { title: dialog.title, onClose: () => setDialog(null) }, detailPath ? h(FinanceResource, { resource: detail }, h(FinanceReviewEvidence, { value: detail.data, section, ctx })) : h(FinanceEvidence, { value: dialog.row })) : null,
    dialog && dialog.kind !== 'detail' ? h(FinanceFormDialog, { title: dialog.title, description: dialog.kind === 'batch' ? `当前选中${selected.length}份同活动填报。定稿后计入正式数据，请先逐项核对详情。` : `${dialog.row.task?.title || dialog.row.taskTitle || dialog.row.code || dialog.row.batchKey || '当前事项'} · ${financeDisplayValue(dialog.row.status, 'status')}。${section === 'facts' ? '发布后进入正式事实；金额须按来源币种核对。' : section === 'filing' ? '定稿后进入正式数据；预算逐条审核请在预算填报与审核完成。' : '审批通过不等于已过账，以服务端流程状态为准。'}`, fields: dialog.kind === 'batch' ? [] : [{ key: section === 'filing' ? 'reason' : 'note', label: '复核说明', type: 'textarea', required: dialog.kind === 'reject' }], onClose: () => setDialog(null), onSubmit: async body => {
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

function FinanceReviewEvidence({ value, section, ctx }) {
  if (!value) return null
  const department = ctx.departments?.find(row => row.id === value.departmentId)?.name || value.departmentName || '部门待核对'
  const org = ctx.orgs?.find(row => row.id === value.orgId)?.name || value.orgName || '主体待核对'
  return h('div', { className: 'sf-stack' },
    h('p', null, `${value.task?.title || value.code || '当前事项'} · ${financeDisplayValue(value.status, 'status')} · ${org} · ${department}`),
    section === 'filing' ? h('div', null,
      h('p', { className: 'sf-note' }, `截止 ${value.task?.dueAt || '待核对'} · 第${value.submissionNo ?? '—'}次提交。提交并不代表已确认入库。`),
      value.task?.type === 'BUDGET' ? h(GhostButton, { onClick: () => ctx.onNavigate('budget-filing', { year: String(value.task.year), taskId: value.taskId || value.task.id }) }, '进入预算逐条核对与审核')
        : h(Table, { tableId: 'finance-review-filing-rows', rows: value.rows || [], empty: '当前未提供填报行，请刷新详情核对', columns: [
          { key: 'costItemId', label: '费用项', render: row => row.costItemName || row.costItemId || '未指定' }, ...financeColumns([['expenseType', '费用类别'], ['month', '月份'], ['plannedAmount', '填报金额（元）'], ['description', '说明']]),
        ] })) : null,
    section === 'budget' ? h('div', null, h('p', null, `申请总额 ${formatNumber(value.totalAmount) ?? '—'} 元 · 原因：${value.reason || '未提供'}`),
      h(Table, { tableId: 'finance-review-adjustment-lines', rows: value.lines || [], empty: '未返回调整分录，请刷新核对后审批', columns: [
        ...financeColumns([['side', '调整方向'], ['amount', '调整金额（元）'], ['targetYear', '目标年度'], ['targetMonth', '目标月份'], ['targetExpenseType', '费用类别'], ['note', '说明']]),
        { key: 'targetOrgId', label: '目标主体', render: row => ctx.orgs?.find(org => org.id === row.targetOrgId)?.name || row.targetOrgId || '沿用原预算行' },
        { key: 'targetDepartmentId', label: '目标部门', render: row => ctx.departments?.find(dept => dept.id === row.targetDepartmentId)?.name || row.targetDepartmentId || '沿用原预算行' },
      ] })) : null,
    section === 'plans' ? h('div', null, h('p', null, `计划金额：${formatNumber(value.oldAmount) ?? '—'} → ${formatNumber(value.newAmount) ?? '—'} 元`), h('p', null, `原因：${value.reason || '未提供'}`),
      h(GhostButton, { onClick: () => ctx.onNavigate('cash', { view: 'plans' }) }, '前往付款计划核对')) : null,
    value.logs?.length ? h(Table, { tableId: 'finance-review-action-history', rows: value.logs, empty: '暂无操作记录', columns: financeColumns([['action', '操作'], ['fromStatus', '原状态'], ['toStatus', '新状态'], ['actorName', '操作者'], ['note', '复核说明'], ['createdAt', '时间']]) }) : null,
    h('details', null, h('summary', null, '查看原始业务证据与追溯编号'), h(FinanceEvidence, { value })))
}
