// 与网页 /filing/budget 共用逐条审核契约；动作完全来自服务端，不根据本地角色推断审批权。
const BUDGET_FILING_STAGES = {
  DRAFT: '草稿', INITIAL_REVIEW: '待对接人初审', FINAL_REVIEW: '待负责人终审', APPROVED: '终审通过',
  REJECTED: '退回修改', PENDING: '尚未开始', SUBMITTED: '待财务确认', CONFIRMED: '财务已确认', LOCKED: '已锁定', VOIDED: '已作废',
}
const BUDGET_FILING_ACTIONS = { SUBMIT: '提交初审', INITIAL_APPROVE: '初审通过', FINAL_APPROVE: '终审通过', REJECT: '退回', DELETE: '删除草稿' }
const budgetFilingMoney = value => Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function financeBudgetRowBody(value, costItems, card) {
  let mapping
  if (card?.configurationRequired) {
    mapping = card.configurationImported && (card.expenseMappings || []).find(item => item.code === value.expenseMappingCode && item.costItemId === value.costItemId)
    if (!mapping) throw new Error('请选择本部门可用的年度费用科目与分类')
  }
  if (!mapping && !(costItems || []).some(item => item.id === value.costItemId)) throw new Error('请选择可用的费用类别')
  const month = Number(value.month), plannedAmount = Number(value.plannedAmount), description = String(value.description || '').trim()
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('请选择 1 至 12 月的预算月份')
  if (!String(value.plannedAmount ?? '').trim() || !Number.isFinite(plannedAmount) || plannedAmount <= 0 || plannedAmount > 999999999999.99) throw new Error('请填写大于 0 且不超过 999999999999.99 元的金额')
  if (plannedAmount !== Number(plannedAmount.toFixed(2))) throw new Error('金额最多两位小数')
  if (!description || description.length > 500) throw new Error('请填写 1 至 500 字的编制说明')
  return { costItemId: value.costItemId, ...(mapping ? { expenseMappingCode: mapping.code } : {}), month, plannedAmount, description }
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
    dialog?.kind === 'decision' ? h(BudgetFilingDecisionDialog, { decision: dialog, onClose: () => setDialog(null), onSave: reason => run(`/finance/budget-filing/${card.id}/${dialog.row ? 'rows' : 'department'}`, {
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
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const update = patch => { setValue(current => ({ ...current, ...patch })); setError('') }
  const save = async event => {
    event.preventDefault()
    if (lock.current) return
    let body
    try { body = financeBudgetRowBody(value, costItems, card) } catch (e) { setError(e.message); return }
    lock.current = true; setBusy(true); setError('')
    try { await onSave({ action: 'SAVE', ...(row ? { rowId: row.id, revision: row.revision } : {}), row: body }) }
    catch (e) { setError(e.message || '保存失败，填写内容已保留，请重试') }
    finally { lock.current = false; setBusy(false) }
  }
  return h(Dialog, { title: row ? '修改本人预算' : '新增本人预算', onClose, dismissDisabled: busy },
    h('form', { onSubmit: save, className: 'sf-stack' },
      h('p', { className: 'sf-note' }, `${card.year} 年 · ${card.departmentName} · ${card.title}`),
      h('fieldset', { disabled: busy, className: 'sf-fieldset sf-form sf-budget-filing-form' },
        card.configurationRequired ? h('div', { className: 'sf-stack' },
          !ready ? h('p', { role: 'status' }, !card.configurationImported ? `${card.year} 年度配置尚未导入，请联系财务负责人。` : '本部门暂无可用年度费用映射，请联系财务负责人。') : null,
          h(FormRow, { label: '一级费用类别' }, h(SearchSelect, { buttonTrigger: true, 'aria-label': '一级费用类别', value: level1, disabled: !ready, options: [...new Set(mappings.map(item => item.level1Name))].map(name => [name, name]), placeholder: '选择一级费用类别', onChange: name => { setLevel1(name); update({ costItemId: '', expenseMappingCode: '' }) } })),
          h(FormRow, { label: '费用科目与分类' }, h(SearchSelect, { buttonTrigger: true, 'aria-label': '费用科目与分类', value: value.expenseMappingCode, disabled: !ready || !level1, options: mappings.filter(item => item.level1Name === level1).map(item => [item.code, `${item.level2Name} · ${financeLabel(item.expenseType)} · ${item.sourceCode}`]), placeholder: '选择费用科目与分类', onChange: code => { const item = mappings.find(item => item.code === code && item.level1Name === level1); if (item) update({ costItemId: item.costItemId, expenseMappingCode: item.code }) } })),
          selectedMapping ? h('p', { role: 'status' }, '费用分类：' + financeLabel(selectedMapping.expenseType)) : null)
          : h('div', { className: 'sf-stack' },
            h(FormRow, { label: '费用类别' }, h(SearchSelect, { buttonTrigger: true, value: value.costItemId, onChange: costItemId => update({ costItemId }), options: costItems.map(item => [item.id, item.name]), placeholder: '选择费用类别', disabled: !ready, required: true })),
            !ready ? h('p', { role: 'status', className: 'sf-note' }, '暂无可用费用类别，请联系财务维护。') : null),
        h('div', { className: 'sf-form-grid' },
          h(FormRow, { label: '预算月份' }, h(Select, { 'aria-label': '预算月份', value: value.month, onChange: month => update({ month }), options: Array.from({ length: 12 }, (_, i) => [String(i + 1), `${i + 1} 月`]), required: true })),
          h(FormRow, { label: '金额（元）' }, h(Field, { 'aria-label': '金额（元）', type: 'number', min: '0.01', max: '999999999999.99', step: '0.01', value: value.plannedAmount, onChange: plannedAmount => update({ plannedAmount }), required: true }))),
        h(FormRow, { label: '编制说明' }, h(Textarea, { 'aria-label': '编制说明', value: value.description, onChange: description => update({ description }), maxLength: 500, required: true }))),
      error ? h('p', { role: 'alert', className: 'sf-neg' }, error) : null,
      h('div', { className: 'sf-row' }, h(GhostButton, { disabled: busy, onClick: onClose }, '取消'), h(PrimaryButton, { type: 'submit', busy, disabled: !ready }, busy ? '保存中…' : '保存草稿'))))
}

function BudgetFilingDecisionDialog({ decision, onClose, onSave }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const rejecting = decision.action === 'REJECT', deleting = decision.action === 'DELETE'
  const title = rejecting ? decision.row ? '退回预算条目' : '退回部门预算' : deleting ? '删除本人草稿' : decision.action === 'SUBMIT' ? '提交部门预算' : '确认部门预算'
  const save = async () => {
    if (lock.current) return
    if (rejecting && !reason.trim()) { setError('请填写退回原因'); return }
    lock.current = true; setBusy(true); setError('')
    try { await onSave(reason.trim()) } catch (e) { setError(e.message || '操作失败，填写内容已保留，请重试') }
    finally { lock.current = false; setBusy(false) }
  }
  return h(Dialog, { title, onClose, dismissDisabled: busy, footer: [h(GhostButton, { key: 'cancel', disabled: busy, onClick: onClose }, '取消'), h(PrimaryButton, { key: 'confirm', busy, disabled: rejecting && !reason.trim(), onClick: save }, rejecting ? '确认退回' : deleting ? '删除草稿' : decision.action === 'SUBMIT' ? '提交预算' : '确认纳入版本')] },
    h('div', { className: 'sf-stack' },
      h('p', null, rejecting ? '退回后填报人可按原因修改并重新提交审核。' : deleting ? '这条本人草稿将从当前填报中移除，历史审计记录仍会保留。' : decision.action === 'SUBMIT' ? '提交后本部门条目将冻结，等待财务确认。' : '确认后，终审通过的条目将纳入当前草稿预算版本。'),
      rejecting ? h(FormRow, { label: '退回原因（必填）' }, h(Textarea, { 'aria-label': '退回原因（必填）', value: reason, onChange: setReason, maxLength: 500, disabled: busy })) : null,
      error ? h('p', { role: 'alert', className: 'sf-neg' }, error) : null))
}

function BudgetFilingRoundDialog({ card, row, kind, onClose, onSave }) {
  const ownerOnly = kind === 'owner'
  const directory = useFinanceResource('/finance/feishu/organization-directory', 0)
  const departmentNames = new Map((directory.data?.departments || []).map(item => [item.id, item.name]))
  const people = (directory.data?.members || []).filter(member => member.userId && member.enabled && member.source !== 'LOCAL_MIRROR')
    .map(member => [member.userId, `${member.name || member.userId} · ${(member.departmentIds || []).map(id => departmentNames.get(id)).filter(Boolean).join('、') || '未分配部门'}`])
  const [owners, setOwners] = useState({})
  const [title, setTitle] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const historical = ownerOnly ? [row] : card.unassignedRows || []
  const save = async event => {
    event.preventDefault()
    if (lock.current) return
    if (historical.some(item => !people.some(([id]) => id === owners[item.id]))) { setError('请从组织架构选择每条历史预算的实际填报人'); return }
    const date = new Date(dueAt)
    if (!ownerOnly && (!title.trim() || !reason.trim() || !Number.isFinite(date.getTime()))) { setError('请填写新轮次名称、有效截止时间和调整原因'); return }
    lock.current = true; setBusy(true); setError('')
    try { await onSave(ownerOnly ? { action: 'ASSIGN_OWNER', rowId: row.id, revision: row.revision, ownerUserId: owners[row.id] } : {
      title: title.trim(), dueAt: date.toISOString(), reason: reason.trim(), owners: historical.map(item => ({ rowId: item.id, userId: owners[item.id] })),
    }) } catch (e) { setError(e.message || '操作失败，填写内容已保留，请重试') }
    finally { lock.current = false; setBusy(false) }
  }
  return h(Dialog, { title: ownerOnly ? '明确历史预算填报人' : '复制下一轮预算', onClose, dismissDisabled: busy },
    h('form', { onSubmit: save, className: 'sf-stack' },
      h('p', { className: 'sf-note' }, ownerOnly ? '请选择本部门实际填报人。指定后条目恢复草稿，须重新完成两级审批。' : '保留原活动与预算，复制本人条目到新的草稿活动。新一轮须重新审批，发布后部门才能修改。'),
      historical.length ? h(FinanceResource, { resource: directory }, !people.length ? h('p', { role: 'status' }, '暂无可选组织人员，请联系财务同步通讯录。') : null) : null,
      h('fieldset', { disabled: busy, className: 'sf-fieldset sf-form sf-budget-filing-form' },
        ...historical.map(item => h(FormRow, { key: item.id, label: '明确历史条目填报人：' + item.description }, h(SearchSelect, { buttonTrigger: true, value: owners[item.id] || '', onChange: userId => setOwners(current => ({ ...current, [item.id]: userId })), options: people, placeholder: '从组织架构选择人员', disabled: directory.loading || Boolean(directory.error) || !people.length }))),
        !ownerOnly ? h(React.Fragment, null,
          h(FormRow, { label: '新轮次名称' }, h(Field, { value: title, onChange: setTitle, maxLength: 150, required: true })),
          h(FormRow, { label: '填报截止时间' }, h(Field, { type: 'datetime-local', value: dueAt, onChange: setDueAt, required: true })),
          h(FormRow, { label: '调整原因' }, h(Textarea, { value: reason, onChange: setReason, maxLength: 500, required: true }))) : null),
      error ? h('p', { role: 'alert', className: 'sf-neg' }, error) : null,
      h('div', { className: 'sf-row' }, h(GhostButton, { disabled: busy, onClick: onClose }, '取消'), h(PrimaryButton, { type: 'submit', busy, disabled: historical.length > 0 && (directory.loading || Boolean(directory.error) || historical.some(item => !owners[item.id])) }, ownerOnly ? '确认填报人' : '创建下一轮草稿'))))
}
