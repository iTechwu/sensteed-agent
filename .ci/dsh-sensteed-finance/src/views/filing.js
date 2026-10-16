function FilingParityView({ ctx, t }) {
  const section = ctx.drillParams?.section || 'assignments'
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [taskId, setTaskId] = useState(ctx.drillParams?.taskId || '')
  const [departmentId, setDepartmentId] = useState('')
  const [dialog, setDialog] = useState(null)
  const [receipt, setReceipt] = useState(null)
  const action = useFinanceAction()
  const revision = `${ctx.revision}-${action.revision}`
  const manage = ctx.financeWriter && ctx.permissions.includes('budget.activity.manage')
  const verify = ctx.financeWriter && ctx.permissions.includes('budget.submission.verify')
  const reopen = ctx.financeWriter && ctx.permissions.includes('budget.activity.reopen')
  const taskParams = new URLSearchParams({ year: ctx.year, page: String(page), limit: '20' })
  if (status && section === 'tasks') taskParams.set('status', status)
  const tasks = useFinanceResource(section === 'tasks' ? `/finance/filing/tasks?${taskParams}` : null, revision)
  const assignmentParams = new URLSearchParams({ year: ctx.year, page: String(page), limit: '20' })
  if (taskId) assignmentParams.set('taskId', taskId)
  if (departmentId) assignmentParams.set('departmentId', departmentId)
  if (status && section !== 'tasks') assignmentParams.set('status', status)
  if (section === 'mine') assignmentParams.set('submittedByMe', 'true')
  const assignments = useFinanceResource(section !== 'tasks' ? `/finance/filing/assignments?${assignmentParams}` : null, revision)
  const members = useFinanceResource(ctx.role === 'FINANCE_OWNER' ? '/finance/members' : null, revision)
  const summary = useFinanceResource(`/finance/filing/assignments/summary?year=${ctx.year}`, revision)
  const history = useFinanceResource(dialog?.kind === 'history' ? `/finance/filing/assignments/${dialog.id}/submissions` : null, revision)
  const detail = useFinanceResource(dialog?.kind === 'assignment' ? `/finance/filing/assignments/${dialog.id}` : null, revision)
  const act = async (path, payload, message) => {
    try { await post(path, payload); action.invalidate(); return true }
    catch (error) { action.report(error.message); return false }
  }
  const run = async (path, body) => { const result = await action.run(path, body); if (result?.results) setReceipt(result); return result }
  const resource = section === 'tasks' ? tasks : assignments
  const rows = financeRows(resource.data)
  return h('div', { className: 'sf-stack' },
    h(GhostButton, { onClick: () => ctx.onNavigate?.('budget-filing', { year: ctx.year, ...(taskId ? { taskId } : {}) }) }, '预算填报与审核'),
    h(FinanceResource, { resource: summary }, h('div', { className: 'sf-kpis' }, ...[['fillablePending', '待填写'], ['fillableDraft', '草稿'], ['fillableRejected', '退回待改'], ['submitted', '待复核']].map(([key, label]) => h(KpiCard, { key, label, value: summary.data?.[key] })))),
    h('div', { className: 'sf-row' },
      h(Select, { 'aria-label': '填报状态', value: status, placeholder: '全部状态', options: section === 'tasks' ? [['DRAFT', '草稿活动'], ['OPEN', '开放活动'], ['CLOSED', '已关闭活动']] : [['PENDING', '待填写'], ['DRAFT', '草稿'], ['SUBMITTED', '已提交'], ['REJECTED', '已退回'], ['CONFIRMED', '已确认'], ['LOCKED', '已锁定'], ['VOIDED', '已作废']], onChange: value => { setStatus(value); setPage(1) } }),
      section === 'department' ? h(Select, { 'aria-label': '填报部门', value: departmentId, options: ctx.departments.map(row => [row.id, row.name]), placeholder: '全部可见部门', onChange: value => { setDepartmentId(value); setPage(1) } }) : null,
      manage && section === 'tasks' ? h(GhostButton, { onClick: () => setDialog({ kind: 'create' }) }, '发起填报活动') : null),
    taskId ? h('p', null, `正在查看活动 ${taskId}`, h(GhostButton, { onClick: () => { setTaskId(''); setPage(1) } }, '清除活动筛选')) : null,
    h(Notice, null, action.notice),
    h(Card, { title: section === 'tasks' ? '填报活动' : section === 'mine' ? '我的记录' : section === 'department' ? '部门填报' : '待填报任务' }, h(FinanceResource, { resource }, h(Table, { tableId: `finance-filing-${section}`, rows, empty: '暂无记录', columns: [
      ...financeColumns(section === 'tasks' ? [['title', '活动'], ['year', '年度'], ['type', '类型'], ['status', '状态'], ['dueAt', '截止时间']] : [['taskTitle', '活动'], ['departmentName', '部门'], ['assigneeName', '填报人'], ['status', '状态'], ['submittedAt', '提交时间']]),
      { key: 'actions', label: '操作', sortable: false, render: row => h('div', { className: 'sf-row' },
        section === 'tasks' ? h(React.Fragment, null,
          h(GhostButton, { onClick: () => ctx.onNavigate?.('filing', { section: 'department', taskId: row.id }) }, '查看部门进度'),
          manage && row.status === 'DRAFT' ? h(GhostButton, { onClick: () => setDialog({ kind: 'publish', title: '发布填报活动', row }) }, '发布活动') : null,
          manage && row.status === 'OPEN' ? h(GhostButton, { onClick: () => setDialog({ kind: 'close', title: '关闭填报活动', row }) }, '关闭活动') : null,
          reopen && row.status === 'CLOSED' ? h(GhostButton, { onClick: () => setDialog({ kind: 'reopenTask', title: '重开填报活动', row }) }, '重开活动') : null,
          verify && row.status === 'OPEN' ? h(GhostButton, { onClick: () => setDialog({ kind: 'confirmAll', title: '确认活动内全部已提交填报', row }) }, '全部定稿') : null)
          : h(React.Fragment, null,
            h(GhostButton, { onClick: () => setDialog({ kind: 'assignment', id: row.id }) }, '查看 / 填写'),
            h(GhostButton, { onClick: () => setDialog({ kind: 'history', id: row.id, title: '提交版本历史' }) }, '提交历史'),
            manage ? h(GhostButton, { onClick: () => setDialog({ kind: 'assignee', title: '指定填报人', row }) }, '指定填报人') : null,
            verify && row.status === 'SUBMITTED' ? h(GhostButton, { onClick: () => setDialog({ kind: 'reopenAssignment', title: '重开已提交填报', row }) }, '重开填报') : null,
            verify && row.status === 'CONFIRMED' ? h(GhostButton, { onClick: () => setDialog({ kind: 'lock', title: '锁定已确认填报', row }) }, '锁定填报') : null,
            verify && ['PENDING', 'DRAFT', 'SUBMITTED', 'REJECTED'].includes(row.status) ? h(GhostButton, { onClick: () => setDialog({ kind: 'void', title: '作废未确认填报', row }) }, '作废填报') : null)) },
    ] })), h(Pager, { page, total: resource.data?.total, limit: 20, onPage: setPage })),
    dialog?.kind === 'create' ? h(CreateTaskDialog, { year: ctx.year, departments: ctx.departments, members: members.data, busy: action.busy, t, act, onClose: () => { setDialog(null); tasks.retry() } }) : null,
    dialog?.kind === 'assignment' ? detail.error || detail.loading ? h(Dialog, { title: '填报详情', onClose: () => setDialog(null) }, h(FinanceResource, { resource: detail })) : detail.data ? detail.data.task?.type === 'BUDGET' ? h(Dialog, { title: '预算填报与审核', onClose: () => setDialog(null) }, h('p', null, '预算按条目填报，经对接人初审和负责人终审后整体提交。'), h(PrimaryButton, { onClick: () => ctx.onNavigate?.('budget-filing', { year: String(detail.data.task.year), taskId: detail.data.taskId || detail.data.task.id }) }, '进入预算填报与审核')) : h(AssignmentDialog, { key: detail.data.id, assignment: detail.data, canEdit: ctx.permissions.includes('budget.submission.edit'), canVerify: verify, busy: action.busy, t, act, onClose: () => { setDialog(null); assignments.retry() } }) : null : null,
    dialog?.kind === 'history' ? h(Dialog, { title: dialog.title, onClose: () => setDialog(null) }, h(FinanceResource, { resource: history }, h(FinanceEvidence, { value: history.data }))) : null,
    dialog && !['create', 'assignment', 'history'].includes(dialog.kind) ? h(FinanceFormDialog, { title: dialog.title, onClose: () => setDialog(null), fields: dialog.kind === 'assignee' ? [{ key: 'assigneeUserId', label: '填报人（留空清除指定）', options: financeRows(members.data).map(row => [row.userId, row.name || row.userId]) }] : dialog.kind === 'publish' || dialog.kind === 'confirmAll' || dialog.kind === 'lock' ? [] : [{ key: 'reason', label: '原因', required: ['reopenTask', 'reopenAssignment', 'void'].includes(dialog.kind), type: 'textarea' }, ...(dialog.kind === 'reopenTask' ? [{ key: 'newDueAt', label: '新的截止时间', type: 'datetime-local' }] : [])], onSubmit: body => {
      const id = dialog.row.id
      if (dialog.kind === 'assignee') return run(`/finance/filing/assignments/${id}/assignee`, { assigneeUserId: body.assigneeUserId || null, assigneeName: financeRows(members.data).find(row => row.userId === body.assigneeUserId)?.name || null })
      if (dialog.kind === 'reopenAssignment' || dialog.kind === 'lock' || dialog.kind === 'void') return run(`/finance/filing/assignments/${id}/${dialog.kind === 'reopenAssignment' ? 'reopen' : dialog.kind}`, body)
      return run(`/finance/filing/tasks/${id}/${dialog.kind === 'reopenTask' ? 'reopen' : dialog.kind === 'confirmAll' ? 'confirm-all' : dialog.kind}`, body)
    } }) : null,
    receipt ? h(Card, { title: '批量定稿回执' }, h(FinanceEvidence, { value: receipt })) : null)
}
