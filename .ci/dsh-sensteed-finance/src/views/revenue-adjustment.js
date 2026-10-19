// 收入计划调整独立审批链；金额生效只由服务端过账执行。
function validRevenueAdjustment(plan, value, reason) {
  const text = String(value ?? '').trim(), before = finite(plan.plannedAmount), after = finite(text), actual = finite(plan.actualAmount)
  return /^\d+(\.\d{1,2})?$/.test(text)
    && before !== null && after !== null && after <= 99999999999999.99 && after !== before
    && (actual === null ? after > before : after >= actual)
    && Boolean(reason.trim()) && reason.trim().length <= 500
}

function RevenueAdjustmentDialog({ plan, t, onClose, act }) {
  const [newAmount, setNewAmount] = useState(''), [reason, setReason] = useState('')
  const [draftId, setDraftId] = useState(null), [pending, setPending] = useState(false), [error, setError] = useState(null)
  const lock = useRef(false), draftRef = useRef(null)
  const invalid = !draftId && !validRevenueAdjustment(plan, newAmount, reason)
  const close = () => { if (!lock.current) onClose() }
  const submit = async () => {
    if (invalid || lock.current) return
    lock.current = true; setPending(true); setError(null)
    try {
      if (!draftRef.current) {
        const result = await post(`/rest/finance/revenue-plans/${encodeURIComponent(plan.id)}/adjustments`, { newAmount: Number(newAmount), reason: reason.trim() })
        const id = result.data?.id
        if (!id) throw new Error('未取得收入调整草稿编号，请核对后重试')
        draftRef.current = id; setDraftId(id)
      }
      const saved = await act(`/rest/finance/revenue-plan-adjustments/${encodeURIComponent(draftRef.current)}/submit`, {})
      if (saved === false || saved === null) { setError('草稿已保存，提交未成功。重试只提交此草稿。'); return }
      onClose()
    } catch (failure) { setError(failure.message) }
    finally { lock.current = false; setPending(false) }
  }
  return h(Dialog, { title: `收入计划调增/调减 · ${plan.description || plan.incomeTypeName || ''}`, onClose: close, dismissDisabled: pending, footer: [
    h(GhostButton, { key: 'cancel', disabled: pending, onClick: close }, t('cancel')),
    h(PrimaryButton, { key: 'ok', disabled: invalid || pending, onClick: submit }, draftId ? '重试提交此草稿' : '创建并提交审批'),
  ] }, h('div', { className: 'sf-stack' },
    h('p', { className: 'sf-note' }, `当前计划金额 ${formatNumber(plan.plannedAmount) ?? '—'} 元。审批通过后仍须过账，过账前计划金额不变。调减不得低于已知实收；实收未知时请先核对。`),
    draftId ? h('p', { role: 'status', className: 'sf-note' }, `已保存草稿 ${draftId}。金额和原因已锁定；提交失败重试不会重复建单。`) : null,
    error ? h('p', { role: 'alert', className: 'sf-neg' }, error) : null,
    h(FormRow, { label: '调整后收入计划金额（元）' }, h(Field, { inputMode: 'decimal', value: newAmount, disabled: pending || Boolean(draftId), onChange: setNewAmount })),
    h(FormRow, { label: '调增/调减原因', wide: true }, h(Textarea, { value: reason, maxLength: 500, disabled: pending || Boolean(draftId), onChange: setReason }))))
}

function revenueAdjustmentActions(ctx, status) {
  if (!ctx.financeWriter) return []
  const permissions = ctx.permissions || [], actions = []
  const canWrite = permissions.includes('cash.plan.write'), canVerify = permissions.includes('cash.plan.verify')
  if (status === 'DRAFT' && canWrite) actions.push(['submit', '提交审批'])
  if (status === 'SUBMITTED' && canVerify && permissions.includes('cash.plan.adjustment.approve')) actions.push(['approve', '审批通过'], ['reject', '驳回'])
  if (status === 'APPROVED' && canVerify) actions.push(['post', '过账'])
  if (['DRAFT', 'SUBMITTED', 'APPROVED'].includes(status) && canWrite) actions.push(['cancel', '撤销'])
  return actions
}

function RevenueAdjustmentActionDialog({ row, kind, label, onClose, act }) {
  const [note, setNote] = useState(''), [pending, setPending] = useState(false), [error, setError] = useState(null)
  const lock = useRef(false)
  const required = ['reject', 'cancel'].includes(kind)
  const close = () => { if (!lock.current) onClose() }
  const submit = async () => {
    if (lock.current || required && !note.trim() || note.trim().length > 500) return
    lock.current = true; setPending(true); setError(null)
    try {
      const saved = await act(`/finance/revenue-plan-adjustments/${encodeURIComponent(row.id)}/${kind}`, ['submit', 'post'].includes(kind) ? {} : { note: note.trim() })
      if (saved === false || saved === null) { setError('操作未完成，请核对后重试'); return }
      onClose()
    } catch (failure) { setError(failure.message) }
    finally { lock.current = false; setPending(false) }
  }
  return h(Dialog, { title: `${label}收入调整 · ${row.code || row.id}`, onClose: close, dismissDisabled: pending, footer: [
    h(GhostButton, { key: 'cancel', disabled: pending, onClick: close }, '返回'),
    h(PrimaryButton, { key: 'ok', disabled: pending || required && !note.trim() || note.trim().length > 500, onClick: submit }, `确认${label}`),
  ] }, h('div', { className: 'sf-stack' },
    h('p', null, `计划金额 ${formatNumber(row.oldAmount) ?? '—'} → ${formatNumber(row.newAmount) ?? '—'} 元。原因：${row.reason || '未提供'}`),
    h('p', { className: 'sf-note' }, kind === 'post' ? '过账将按服务端校验更新收入计划并追加审计流水；重复过账由服务端幂等保护。' : kind === 'approve' ? '批准后仍待过账，此操作不会直接修改收入计划金额。' : kind === 'cancel' ? '撤销此调整单后不可继续审批或过账；收入计划金额保留原值。' : '请核对调整详情、实收底线及当前状态。'),
    !['submit', 'post'].includes(kind) ? h(FormRow, { label: `${label}说明${required ? '（必填）' : '（可选）'}` }, h(Textarea, { value: note, maxLength: 500, disabled: pending, onChange: setNote })) : null,
    error ? h('p', { role: 'alert', className: 'sf-neg' }, error) : null))
}

function RevenueAdjustmentsQueue({ ctx, t }) {
  const [status, setStatus] = useState('SUBMITTED'), [page, setPage] = useState(1), [dialog, setDialog] = useState(null)
  const action = useFinanceAction()
  const params = new URLSearchParams({ page: String(page), limit: '20' })
  if (ctx.year) params.set('year', String(ctx.year))
  if (ctx.orgId) params.set('orgId', ctx.orgId)
  if (status) params.set('status', status)
  const revision = `${ctx.revision}-${action.revision}`
  const list = useFinanceResource(`/finance/revenue-plan-adjustments?${params}`, revision)
  const detail = useFinanceResource(dialog?.kind === 'detail' ? `/finance/revenue-plan-adjustments/${encodeURIComponent(dialog.row.id)}` : null, revision)
  const scopeKey = `${ctx.year}-${ctx.orgId || ''}`
  useEffect(() => { setPage(1); setDialog(null) }, [scopeKey])
  const rows = financeRows(list.data)
  return h('div', { className: 'sf-stack' },
    h('p', { className: 'sf-note' }, '收入调整独立审批：提交后由有专用审批资格的资金负责人审批，批准后仍须过账才更新计划。数据范围由服务端校验。'),
    h(Select, { 'aria-label': '收入调整状态', value: status, options: [['', '全部状态'], ['DRAFT', '草稿'], ['SUBMITTED', '待审批'], ['APPROVED', '已批准待过账'], ['POSTED', '已过账'], ['REJECTED', '已驳回'], ['CANCELLED', '已撤销']], onChange: value => { setStatus(value); setPage(1); setDialog(null) } }),
    h(Notice, null, action.notice),
    h(FinanceResource, { resource: list }, h(Table, { tableId: 'finance-revenue-adjustments', rows, empty: '暂无收入调整单', columns: [
      { key: 'kind', label: '事项类型', render: () => '收入计划调整' },
      ...financeColumns([['code', '调整单号'], ['oldAmount', '调整前金额（元）'], ['newAmount', '调整后金额（元）'], ['reason', '原因']]),
      { key: 'status', label: '状态', render: row => ({ DRAFT: '草稿', SUBMITTED: '待审批', APPROVED: '已批准待过账', POSTED: '已过账', REJECTED: '已驳回', CANCELLED: '已撤销' })[row.status] || row.status },
      ...financeColumns([['submittedAt', '提交时间']]),
      { key: 'actions', label: '操作', sortable: false, render: row => h('div', { className: 'sf-row' },
        h(GhostButton, { onClick: () => setDialog({ kind: 'detail', row }) }, '查看明细'),
        ...revenueAdjustmentActions(ctx, row.status).map(([kind, label]) => h(GhostButton, { key: kind, disabled: action.busy, onClick: () => setDialog({ kind, label, row }) }, label))) },
    ] })),
    h(Pager, { page, total: list.data?.total, limit: 20, onPage: setPage }),
    dialog?.kind === 'detail' ? h(Dialog, { title: '收入调整详情与审计流水', onClose: () => setDialog(null) }, h(FinanceResource, { resource: detail }, detail.data ? h('div', { className: 'sf-stack' },
      h('p', null, `${detail.data.code || dialog.row.id} · ${detail.data.status === 'APPROVED' ? '已批准待过账' : financeDisplayValue(detail.data.status, 'status')}`),
      h('p', null, `计划金额 ${formatNumber(detail.data.oldAmount) ?? '—'} → ${formatNumber(detail.data.newAmount) ?? '—'} 元。原因：${detail.data.reason || '未提供'}`),
      h(Table, { tableId: 'finance-revenue-adjustment-history', rows: detail.data.logs || [], empty: '暂无操作流水', columns: financeColumns([['action', '操作'], ['fromStatus', '原状态'], ['toStatus', '新状态'], ['actorName', '操作者'], ['note', '说明'], ['createdAt', '时间']]) }),
      h('details', null, h('summary', null, '查看原始业务证据与追溯编号'), h(FinanceEvidence, { value: detail.data }))) : null)) : null,
    dialog && dialog.kind !== 'detail' ? h(RevenueAdjustmentActionDialog, { key: `${dialog.row.id}-${dialog.kind}`, ...dialog, act: action.run, onClose: () => setDialog(null) }) : null)
}
