// 与网页 /filing/budget 共用逐条审核契约；动作完全来自服务端，不根据本地角色推断审批权。
const BUDGET_FILING_STAGES = {
  DRAFT: '草稿', INITIAL_REVIEW: '待对接人初审', FINAL_REVIEW: '待负责人终审', APPROVED: '终审通过',
  REJECTED: '退回修改', PENDING: '尚未开始', SUBMITTED: '待财务确认', CONFIRMED: '财务已确认', LOCKED: '已锁定', VOIDED: '已作废',
}
const BUDGET_FILING_ACTIONS = { SUBMIT: '提交初审', INITIAL_APPROVE: '初审通过', FINAL_APPROVE: '终审通过', REJECT: '退回', DELETE: '删除草稿' }
const budgetFilingMoney = value => Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function financeBudgetRowErrors(value, costItems, card, level1) {
  const errors = {};
  if (card?.configurationRequired) {
    const mappings = card.expenseMappings ?? [];
    if (level1 !== undefined && !mappings.some((item) => item.level1Name === level1)) {
      errors.level1 = '请选择可用的一级费用类别';
    }
    if (!card.configurationImported || !mappings.some((item) =>
      item.code === value.expenseMappingCode && item.costItemId === value.costItemId &&
      (level1 === undefined || item.level1Name === level1))) {
      errors.expenseMappingCode = '请选择本部门可用的年度费用科目与分类';
    }
  } else if (!costItems.some((item) => item.id === value.costItemId)) {
    errors.costItemId = '请选择可用的费用类别';
  }
  const month = Number(value.month), amount = Number(value.plannedAmount);
  if (!Number.isInteger(month) || month < 1 || month > 12) errors.month = '请选择 1 至 12 月的预算月份';
  if (!String(value.plannedAmount ?? '').trim() || !Number.isFinite(amount) || amount <= 0 || amount > 999999999999.99) {
    errors.plannedAmount = '请填写大于 0 且不超过 999999999999.99 元的金额';
  } else if (amount !== Number(amount.toFixed(2))) errors.plannedAmount = '金额最多两位小数';
  const description = String(value.description || '').trim();
  if (!description || description.length > 500) errors.description = '请填写 1 至 500 字的编制说明';
  return errors;
}

function financeBudgetRowBody(value, costItems, card) {
  const errors = financeBudgetRowErrors(value, costItems, card)
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0])
  const mapping = card?.configurationRequired && (card.expenseMappings || []).find(item => item.code === value.expenseMappingCode && item.costItemId === value.costItemId)
  return { costItemId: value.costItemId, ...(mapping ? { expenseMappingCode: mapping.code } : {}), month: Number(value.month), plannedAmount: Number(value.plannedAmount), description: String(value.description || '').trim() }
}

function BudgetFilingView({ ctx }) {
  const [page, setPage] = useState(1)
  const [notice, setNotice] = useState('')
  const taskId = ctx.drillParams?.taskId, versionId = ctx.drillParams?.versionId
  const [versionPage, setVersionPage] = useState(1)
  const query = new URLSearchParams({ page: String(page), limit: '10' })
  const linkedWithoutYear = (taskId || versionId) && !ctx.drillParams?.year
  if (!linkedWithoutYear) query.set('year', ctx.year)
  if (taskId) query.set('taskId', taskId)
  if (versionId) query.set('versionId', versionId)
  const resource = useFinanceResource(`/finance/budget-filing?${query}`, ctx.revision)
  const versions = useFinanceResource(`/finance/budget-filing/versions?page=${versionPage}&limit=100${linkedWithoutYear ? '' : `&year=${ctx.year}`}`, ctx.revision)
  const versionOptions = financeRows(versions.data).map(item => [item.id, `${item.name} · ${financeLabel(item.status)} · ${item.id.slice(0, 8)}`])
  if (versionId && !versionOptions.some(([id]) => id === versionId)) versionOptions.unshift([versionId, '当前链接版本'])
  useEffect(() => {
    const year = resource.data?.list?.[0]?.year
    if (linkedWithoutYear && year) ctx.onNavigate?.('budget-filing', { ...(taskId ? { taskId } : {}), ...(versionId ? { versionId } : {}), year: String(year) })
  }, [taskId, versionId, ctx.drillParams?.year, resource.data])
  return h('div', { className: 'sf-stack' },
    h('p', { className: 'sf-note' }, '本人填报 → 对接人初审 → 负责人终审 → 部门整体提交 → 财务确认'),
    h('div', { className: 'sf-row' },
      h(FormRow, { label: '预算版本' }, h(SearchSelect, { buttonTrigger: true, 'aria-label': '预算版本', value: versionId || '', disabled: versions.loading || Boolean(versions.error), options: [['', '全部可访问版本'], ...versionOptions], placeholder: '全部可访问版本', onChange: value => ctx.onNavigate?.('budget-filing', { year: ctx.year, ...(value ? { versionId: value } : {}) }) })),
      versions.error ? h('span', { role: 'alert' }, '版本列表加载失败', h(GhostButton, { onClick: versions.retry }, '重试版本列表')) : null,
      versions.data?.total > 100 ? h('div', { className: 'sf-row' }, h(GhostButton, { disabled: versionPage === 1 || versions.loading, onClick: () => setVersionPage(n => n - 1) }, '上一组版本'), h(GhostButton, { disabled: versionPage * 100 >= versions.data.total || versions.loading, onClick: () => setVersionPage(n => n + 1) }, '下一组版本')) : null,
      h(GhostButton, { disabled: resource.loading, onClick: resource.retry }, '刷新进度'),
      h(GhostButton, { onClick: () => ctx.onNavigate?.('filing', { section: 'assignments', year: ctx.year }) }, '其他填报任务'),
      taskId ? h(GhostButton, { onClick: () => ctx.onNavigate?.('budget-filing', { year: ctx.year }) }, '全部预算活动') : null),
    h('p', { className: 'sf-note' }, '普通员工仅查看和修改本人条目。提交后须完成两级审核；负责人整体提交后，由财务确认纳入本轮预算。'),
    h('div', { role: 'status' }, h(Notice, null, notice)),
    h(FinanceResource, { resource }, resource.data?.list?.length ? h('div', { className: 'sf-stack' },
      ...resource.data.list.map(card => h(BudgetFilingCard, { key: card.id, card, costItems: resource.data.costItems || [], onRefresh: message => { setNotice(message); resource.retry() } })))
      : h(EmptyState, null, taskId ? '未找到可访问的预算活动，请核对链接或联系财务负责人。' : '当前年度暂无可访问的预算活动，请确认年度、活动是否发布及部门归属。')),
    h(Pager, { page, limit: 10, total: resource.data?.total, onPage: setPage }))
}

function BudgetFilingCard({ card, costItems, onRefresh }) {
  const action = useFinanceAction()
  const [dialog, setDialog] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const run = async (path, body, message) => {
    const result = await action.run(path, body)
    if (!result) return false
    action.report(message); setDialog(null); onRefresh(message); return true
  }
  const rowAction = async (row, kind) => {
    if (['REJECT', 'DELETE'].includes(kind)) { setDialog({ kind: 'decision', row, action: kind }); return }
    try { await run(`/finance/budget-filing/${card.id}/rows`, { action: kind, rowId: row.id, revision: row.revision }, '条目进度已更新') } catch { /* action.notice 保留错误 */ }
  }
  return h(Card, { title: card.title, actions: [h(GhostButton, { key: 'history', onClick: () => setHistoryOpen(true) }, '预算变动历史')] }, h('div', { className: 'sf-stack' },
    h('p', { className: 'sf-note' }, `${card.year} 年 · ${card.departmentName}${card.orgName ? ' · ' + card.orgName : ''} · ${card.versionName || '未绑定预算版本'}`),
    h('p', { className: 'sf-note' }, `截止 ${new Date(card.dueAt).toLocaleString('zh-CN')} · ${card.taskStatus === 'CLOSED' ? '活动已关闭' : BUDGET_FILING_STAGES[card.status] || card.status}`),
    h('strong', null, `${card.canViewDepartment ? '部门填报合计' : '本人填报合计'}：¥ ${budgetFilingMoney(card.totalAmount)}`),
    card.previousTotalAmount != null ? h('p', { className: 'sf-note' }, `原版 ¥ ${budgetFilingMoney(card.previousTotalAmount)} · 变化 ¥ ${budgetFilingMoney(card.totalAmount - card.previousTotalAmount)}`) : null,
    card.rejectReason ? h('p', { role: 'alert' }, '财务退回：' + card.rejectReason) : null,
    card.legacyRowCount > 0 ? h('p', { role: 'alert' }, `有 ${card.legacyRowCount} 条历史数据尚未明确填报人，请联系财务整理归属。`) : null,
    h('div', { role: 'status' }, h(Notice, null, action.notice)),
    !card.rows.length ? h(EmptyState, null, '尚无预算条目，可在开放期间新增本人预算。') : h('ul', { className: 'sf-stack sf-budget-filing-rows' }, ...card.rows.map(row => h('li', { key: row.id, className: 'sf-inline-form sf-stack' },
      h('strong', null, `${row.costItemName} · ${row.month} 月 · ¥ ${budgetFilingMoney(row.plannedAmount)}`),
      h('p', null, row.description),
      row.expenseType ? h('p', { className: 'sf-note' }, `${financeLabel(row.expenseType)}${row.expenseMappingCode ? ' · ' + row.expenseMappingCode : ''}`) : null, h('p', { className: 'sf-note' }, `${row.ownerName ? row.ownerName + ' · ' : ''}${BUDGET_FILING_STAGES[row.reviewStatus] || row.reviewStatus}${row.sourceAmount != null ? ' · 原版 ¥ ' + budgetFilingMoney(row.sourceAmount) : ''}`),
      row.reviewReason ? h('p', null, '退回原因：' + row.reviewReason) : null,
      h('div', { className: 'sf-row' }, ...(row.actions || []).map(kind => kind === 'SAVE' ? h(GhostButton, { key: kind, disabled: action.busy, onClick: () => setDialog({ kind: 'edit', row }) }, '修改')
        : kind === 'ASSIGN_OWNER' ? h(GhostButton, { key: kind, disabled: action.busy, onClick: () => setDialog({ kind: 'owner', row }) }, '指定历史填报人')
          : BUDGET_FILING_ACTIONS[kind] ? h(GhostButton, { key: kind, disabled: action.busy, onClick: () => rowAction(row, kind) }, BUDGET_FILING_ACTIONS[kind]) : null))))),
    card.canCreate ? h(BudgetFilingExcel, { card, costItems, onRefresh }) : null,
    historyOpen ? h(BudgetFilingHistory, { id: card.id, onClose: () => setHistoryOpen(false) }) : null,
    h('div', { className: 'sf-row' },
      card.canCreate ? h(GhostButton, { disabled: action.busy, onClick: () => setDialog({ kind: 'edit' }) }, '新增本人预算') : null,
      ...(card.departmentActions || []).map(kind => h(PrimaryButton, { key: kind, busy: action.busy, onClick: () => setDialog({ kind: 'decision', action: kind }) }, kind === 'SUBMIT' ? '提交部门预算' : kind === 'CONFIRM' ? '确认部门预算' : '退回部门预算')),
      card.canCopy ? h(GhostButton, { disabled: action.busy, onClick: () => setDialog({ kind: 'copy' }) }, '复制下一轮预算') : null),
    dialog?.kind === 'edit' ? h(BudgetFilingRowDialog, { card, row: dialog.row, costItems, onClose: () => setDialog(null), onSave: body => run(`/finance/budget-filing/${card.id}/rows`, body, '草稿已保存，提交后进入初审') }) : null,
    dialog?.kind === 'decision' ? h(BudgetFilingDecisionDialog, { decision: dialog, card, onClose: () => setDialog(null), onSave: reason => run(`/finance/budget-filing/${card.id}/${dialog.row ? 'rows' : 'department'}`, {
      action: dialog.action, ...(dialog.row ? { rowId: dialog.row.id, revision: dialog.row.revision } : {}), ...(reason ? { reason } : {}),
    }, dialog.row ? '条目进度已更新' : '部门预算进度已更新') }) : null,
    dialog?.kind === 'owner' || dialog?.kind === 'copy' ? h(BudgetFilingRoundDialog, { card, row: dialog.row, kind: dialog.kind, onClose: () => setDialog(null), onSave: body => run(dialog.kind === 'owner' ? `/finance/budget-filing/${card.id}/rows` : `/finance/budget-filing/tasks/${card.taskId}/copy`, body,
      dialog.kind === 'owner' ? '已指定填报人，等待本人提交' : '新轮次已保存为草稿，请到填报活动发布') }) : null))
}

function BudgetFilingRowDialog({ card, row, costItems, onClose, onSave }) {
  const [value, setValue] = useState(() => ({ costItemId: row?.costItemId || '', month: String(row?.month || 1), plannedAmount: String(row?.plannedAmount ?? ''), description: row?.description || '', expenseMappingCode: row?.expenseMappingCode || '' }))
  const mappings = card.expenseMappings || []
  const [level1, setLevel1] = useState(() => mappings.find(item => item.code === row?.expenseMappingCode)?.level1Name || '')
  const ready = card.configurationRequired ? card.configurationImported && mappings.length > 0 : costItems.length > 0
  const selectedMapping = mappings.find(item => item.code === value.expenseMappingCode && item.level1Name === level1 && item.costItemId === value.costItemId)
  const [error, setError] = useState(''), [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false), formRef = useRef(null), prefix = useId()
  const initial = useRef({ ...value, level1 })
  const exit = useFinanceFormExit(initial.current, { ...value, level1 }, busy, onClose)
  const close = () => { if (!lock.current) exit.close() }
  const errors = financeBudgetRowErrors(value, costItems, card, level1)
  const update = patch => { setValue(current => ({ ...current, ...patch })); setError('') }
  const fields = [
    ...(card.configurationRequired ? [
      { key: 'level1', label: '一级费用类别', required: true, searchable: true, options: [...new Set(mappings.map(item => item.level1Name))].map(name => [name, name]), disabled: !ready },
      { key: 'expenseMappingCode', label: '费用科目与分类', required: true, searchable: true, options: mappings.filter(item => item.level1Name === level1).map(item => [item.code, `${item.level2Name} · ${financeLabel(item.expenseType)} · ${item.sourceCode}`]), disabled: !ready || !level1 },
    ] : [{ key: 'costItemId', label: '费用类别', required: true, searchable: true, options: costItems.map(item => [item.id, item.name]), disabled: !ready }]),
    { key: 'month', label: '预算月份', required: true, options: Array.from({ length: 12 }, (_, i) => [String(i + 1), `${i + 1} 月`]) },
    { key: 'plannedAmount', label: '金额（元）', required: true, type: 'number', min: 0.01, max: 999999999999.99 },
    { key: 'description', label: '编制说明', required: true, type: 'textarea', maxLength: 500 },
  ]
  const change = (key, next) => {
    if (key === 'level1') { setLevel1(next); update({ costItemId: '', expenseMappingCode: '' }) }
    else if (key === 'expenseMappingCode') {
      const item = mappings.find(item => item.code === next && item.level1Name === level1)
      if (item) update({ costItemId: item.costItemId, expenseMappingCode: item.code })
    } else update({ [key]: next })
  }
  const save = async event => {
    event.preventDefault()
    if (lock.current || busy || !ready) return
    setAttempted(true); setError('')
    if (Object.keys(errors).length) { financeFocusFormError(formRef.current); return }
    const body = financeBudgetRowBody(value, costItems, card)
    lock.current = true; setBusy(true)
    try {
      const result = await onSave({ action: 'SAVE', ...(row ? { rowId: row.id, revision: row.revision } : {}), row: body })
      if (result === false) setError('保存失败，填写内容已保留，请重试')
    } catch (e) { setError(e.message || '保存失败，填写内容已保留，请重试') }
    finally { lock.current = false; setBusy(false) }
  }
  const category = card.configurationRequired ? selectedMapping ? `${selectedMapping.level2Name} · ${financeLabel(selectedMapping.expenseType)} · ${selectedMapping.sourceCode}` : '待选择费用科目与分类' : costItems.find(item => item.id === value.costItemId)?.name || '待选择费用类别'
  return h(Dialog, { title: row ? '修改本人预算' : '新增本人预算', onClose: close, dismissDisabled: busy },
    h('form', { ref: formRef, noValidate: true, onSubmit: save, className: 'sf-stack' },
      h('p', { className: 'sf-note' }, `${card.year} 年 · ${card.departmentName} · ${card.title}`),
      !ready ? h('p', { role: 'status' }, card.configurationRequired ? !card.configurationImported ? `${card.year} 年度配置尚未导入，请联系财务负责人。` : '本部门暂无可用年度费用映射，请联系财务负责人。' : '暂无可用费用类别，请联系财务维护。') : null,
      h('fieldset', { disabled: busy, className: 'sf-fieldset sf-form sf-budget-filing-form' }, ...financeFormFields(fields, { ...value, level1 }, change, attempted ? errors : {}, busy, prefix)),
      h('p', { className: 'sf-note' }, '金额须大于 0 元，最多两位小数；编制说明 1 至 500 字。'),
      h('p', { className: 'sf-note', 'aria-label': '草稿摘要' }, `${card.year} 年 · ${card.departmentName} · ${card.versionName || '未绑定预算版本'}；${category}；${value.month} 月；${errors.plannedAmount ? '待填写有效金额' : '¥ ' + budgetFilingMoney(value.plannedAmount)}。保存后仍为草稿，提交后进入初审。`),
      attempted && Object.keys(errors).length ? h('p', { role: 'alert', className: 'sf-neg' }, '请检查输入，已定位到首个错误。') : null,
      error ? h('p', { role: 'alert', className: 'sf-neg' }, error) : null,
      exit.prompt,
      h('div', { className: 'sf-row' }, h(GhostButton, { disabled: busy, onClick: close }, '取消'), h(PrimaryButton, { type: 'submit', busy, disabled: !ready }, busy ? '保存中…' : '保存草稿'))))
}

function financeBudgetReasonError(reason) {
  return !reason.trim() || reason.trim().length > 500 ? '请填写 1 至 500 字的退回原因' : undefined
}

function BudgetFilingDecisionDialog({ decision, card = {}, onClose, onSave }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false), [attempted, setAttempted] = useState(false)
  const lock = useRef(false), reasonRef = useRef(null), prefix = useId()
  const rejecting = decision.action === 'REJECT', deleting = decision.action === 'DELETE'
  const reasonError = attempted && rejecting ? financeBudgetReasonError(reason) : undefined
  const exit = useFinanceFormExit('', reason, busy, onClose)
  const close = () => { if (!lock.current) exit.close() }
  const title = rejecting ? decision.row ? '退回预算条目' : '退回部门预算' : deleting ? '删除本人草稿' : decision.action === 'SUBMIT' ? '提交部门预算' : '确认部门预算'
  const save = async () => {
    if (lock.current) return
    setAttempted(true); setError('')
    if (rejecting && financeBudgetReasonError(reason)) { reasonRef.current?.querySelector('textarea')?.focus(); return }
    lock.current = true; setBusy(true); setError('')
    try { if (await onSave(reason.trim()) === false) setError('操作失败，填写内容已保留，请核对后重试') } catch (e) { setError(e.message || '操作失败，填写内容已保留，请重试') }
    finally { lock.current = false; setBusy(false) }
  }
  return h(Dialog, { title, onClose: close, dismissDisabled: busy, footer: [h(GhostButton, { key: 'cancel', disabled: busy, onClick: close }, '取消'), h(PrimaryButton, { key: 'confirm', busy, onClick: save }, busy ? '处理中…' : rejecting ? '确认退回' : deleting ? '删除草稿' : decision.action === 'SUBMIT' ? '提交预算' : '确认纳入版本')] },
    h('div', { className: 'sf-stack' },
      h('p', null, rejecting ? '退回后填报人可按原因修改并重新提交审核。' : deleting ? '这条本人草稿将从当前填报中移除，历史审计记录仍会保留。' : decision.action === 'SUBMIT' ? '提交后本部门条目将冻结，等待财务确认。' : '确认后，终审通过的条目将纳入当前草稿预算版本。'),
      h('p', { className: 'sf-note', 'aria-label': '操作范围' }, `${card.year} 年 · ${card.departmentName} · ${card.versionName || '未绑定预算版本'}；${decision.row ? `${decision.row.costItemName} · ${decision.row.month} 月 · ¥ ${budgetFilingMoney(decision.row.plannedAmount)}；${decision.row.description}` : `部门预算合计 ¥ ${budgetFilingMoney(card.totalAmount)}`}`),
      rejecting ? h(FormRow, { label: '退回原因（必填）' }, h('div', { className: 'sf-field-control', ref: reasonRef }, h(Textarea, { 'aria-label': '退回原因（必填）', 'aria-invalid': reasonError ? true : undefined, 'aria-describedby': reasonError ? `${prefix}-reason-error` : undefined, value: reason, onChange: next => { setReason(next); setError('') }, maxLength: 500, disabled: busy }), reasonError ? h('span', { id: `${prefix}-reason-error`, className: 'sf-neg sf-field-error' }, reasonError) : null)) : null,
      error ? h('p', { role: 'alert', className: 'sf-neg' }, error) : null,
      exit.prompt))
}

// 按设备当地时间填写；拒绝日期进位和夏令时缺失时刻。
function financeBudgetDeadline(value) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!parts) return null
  const [, y, m, d, h, min] = parts.map(Number), date = new Date(`${value}:00`)
  if (!y || !Number.isFinite(date.getTime()) || date.getFullYear() !== y || date.getMonth() + 1 !== m || date.getDate() !== d || date.getHours() !== h || date.getMinutes() !== min) return null
  return date.toISOString()
}

function financeBudgetRoundErrors(value, historical, availableUserIds, ownerOnly = false) {
  const errors = {}
  for (const row of historical) {
    const id = value.owners[row.id]
    if (!id || id.length > 64 || !availableUserIds.includes(id)) errors[`owner-${row.id}`] = '请从组织架构选择可用的实际填报人'
  }
  if (!ownerOnly) {
    if (!value.title.trim() || value.title.trim().length > 150) errors.title = '请填写 1 至 150 字的新轮次名称'
    if (!financeBudgetDeadline(value.dueAt)) errors.dueAt = '请填写有效的当地填报截止时间'
    if (!value.reason.trim() || value.reason.trim().length > 500) errors.reason = '请填写 1 至 500 字的调整原因'
  }
  return errors
}

function BudgetFilingRoundDialog({ card, row, kind, onClose, onSave }) {
  const ownerOnly = kind === 'owner', historical = ownerOnly ? [row] : card.unassignedRows || []
  const directory = useFinanceResource(historical.length ? '/finance/feishu/organization-directory' : null, 0)
  const departmentNames = new Map((directory.data?.departments || []).map(item => [item.id, item.name]))
  const people = (directory.data?.members || []).filter(member => member.userId && member.enabled && member.source !== 'LOCAL_MIRROR')
    .map(member => [member.userId, `${member.name || member.userId} · ${(member.departmentIds || []).map(id => departmentNames.get(id)).filter(Boolean).join('、') || '未分配部门'}`])
  const availableIds = people.map(([id]) => id)
  const directoryBlocked = historical.length > 0 && (directory.loading || Boolean(directory.error) || !directory.data || !people.length)
  const [owners, setOwners] = useState({}), [title, setTitle] = useState(''), [dueAt, setDueAt] = useState(''), [reason, setReason] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [attempted, setAttempted] = useState(false)
  const lock = useRef(false), formRef = useRef(null), prefix = useId()
  const values = { owners: Object.fromEntries(Object.entries(owners).filter(([, id]) => Boolean(id))), title, dueAt, reason }, errors = financeBudgetRoundErrors(values, historical, availableIds, ownerOnly)
  const initial = useRef(values), exit = useFinanceFormExit(initial.current, values, busy, onClose)
  const close = () => { if (!lock.current) exit.close() }
  const fields = [
    ...historical.map((item,index) => ({ key: `owner-${item.id}`, label: `历史条目填报人 ${index+1}`, required: true, searchable: true, options: people, disabled: directoryBlocked })),
    ...(!ownerOnly ? [{ key: 'title', label: '新轮次名称', required: true, maxLength: 150 }, { key: 'dueAt', label: '填报截止时间', type: 'datetime-local', required: true }, { key: 'reason', label: '调整原因', type: 'textarea', required: true, maxLength: 500 }] : []),
  ]
  const formValues = {title,dueAt,reason,...Object.fromEntries(historical.map(item=>[`owner-${item.id}`, owners[item.id] || '']))}
  const change = (key, next) => {
    if (key.startsWith('owner-')) setOwners(current=>({...current,[key.slice(6)]:next}))
    else if (key === 'title') setTitle(next)
    else if (key === 'dueAt') setDueAt(next)
    else setReason(next)
    setError('')
  }
  const save = async event => {
    event.preventDefault()
    if (lock.current || busy || directoryBlocked) return
    setAttempted(true); setError('')
    if (Object.keys(errors).length) { financeFocusFormError(formRef.current); return }
    lock.current = true; setBusy(true)
    try { const result = await onSave(ownerOnly ? { action: 'ASSIGN_OWNER', rowId: row.id, revision: row.revision, ownerUserId: owners[row.id] } : {
      title: title.trim(), dueAt: financeBudgetDeadline(dueAt), reason: reason.trim(), owners: historical.map(item => ({ rowId: item.id, userId: owners[item.id] })),
    }); if (result === false) setError('操作失败，填写内容已保留，请核对后重试') }
    catch (e) { setError(e.message || '操作失败，填写内容已保留，请重试') }
    finally { lock.current = false; setBusy(false) }
  }
  return h(Dialog, { title: ownerOnly ? '明确历史预算填报人' : '复制下一轮预算', onClose: close, dismissDisabled: busy },
    h('form', { ref: formRef, noValidate: true, onSubmit: save, className: 'sf-stack' },
      h('p', { className: 'sf-note' }, ownerOnly ? '请选择本部门实际填报人。指定后条目恢复草稿，须重新完成两级审批。' : '保留原活动与预算，复制本人条目到新的草稿活动。新一轮须重新审批，发布后部门才能修改。'),
      h('p', { className: 'sf-note', 'aria-label': '操作范围' }, `${card.year} 年 · ${card.departmentName} · ${card.versionName || '未绑定预算版本'} · ${card.title}`),
      historical.length ? h(FinanceResource, { resource: directory }, !people.length ? h('p', { role: 'status' }, '暂无可选组织人员，请联系财务同步通讯录。') : null) : null,
      h('fieldset', { disabled: busy, className: 'sf-fieldset sf-form sf-budget-filing-form' },
        ...historical.map((item,index)=>h('div', { key:item.id, className:'sf-stack' }, h('p', { className:'sf-note' }, `明确历史条目填报人 ${index+1}（必填）：${item.description}`), ...financeFormFields([fields[index]],formValues,change,attempted?errors:{},busy,prefix))),
        ...financeFormFields(fields.slice(historical.length),formValues,change,attempted?errors:{},busy,prefix)),
      !ownerOnly ? h('p',{className:'sf-note'},'截止时间按当前设备当地时间填写；原活动和预算保留。') : null,
      h('p',{className:'sf-note','aria-label':'操作摘要'},ownerOnly ? `${row.costItemName} · ${row.month} 月 · ¥ ${budgetFilingMoney(row.plannedAmount)}；${row.description} → ${people.find(([id])=>id===owners[row.id])?.[1] || '待选择填报人'}。指定后恢复草稿，须重新审批。` : `新轮次：${title.trim() || '待填写'}；当地截止时间：${dueAt.replace('T',' ') || '待填写'}；已明确 ${historical.filter(item=>availableIds.includes(owners[item.id])).length} / ${historical.length} 条历史预算填报人。创建后仍为草稿，须到填报活动发布。`),
      attempted && Object.keys(errors).length ? h('p',{role:'alert',className:'sf-neg'},'请检查输入，已定位到首个错误。') : null,
      error ? h('p', { role: 'alert', className: 'sf-neg' }, error) : null,
      exit.prompt,
      h('div', { className: 'sf-row' }, h(GhostButton, { disabled: busy, onClick: close }, '取消'), h(PrimaryButton, { type: 'submit', busy, disabled: directoryBlocked }, busy ? ownerOnly ? '指定中…' : '复制中…' : ownerOnly ? '确认填报人' : '创建下一轮草稿'))))
}
