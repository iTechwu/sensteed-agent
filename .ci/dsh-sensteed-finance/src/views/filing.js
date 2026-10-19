function FilingParityView({ ctx, t }) {
  const section = ctx.drillParams?.section || 'assignments'
  const [page, setPage] = useFinanceViewState(ctx, 'page', 1)
  const [status, setStatus] = useFinanceViewState(ctx, 'status', '')
  const [stage, setStage] = useFinanceViewState(ctx, 'stage', 'all')
  const [historyPage, setHistoryPage] = useState(1)
  const [taskId, setTaskId] = useFinanceViewState(ctx, 'taskId', ctx.drillParams?.taskId || '')
  const [departmentId, setDepartmentId] = useFinanceViewState(ctx, 'departmentId', '')
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
  if (section === 'assignments') assignmentParams.set('statuses', JSON.stringify(FINANCE_FILING_STAGES.find(item => item.id === stage).statuses))
  else if (status && section !== 'tasks') assignmentParams.set('status', status)
  if (section === 'mine') assignmentParams.set('submittedByMe', 'true')
  const assignments = useFinanceResource(section !== 'tasks' ? `/finance/filing/assignments?${assignmentParams}` : null, revision)
  const members = useFinanceResource(ctx.role === 'FINANCE_OWNER' ? '/finance/members' : null, revision)
  const summary = useFinanceResource(`/finance/filing/assignments/summary?year=${ctx.year}`, revision)
  const history = useFinanceResource(dialog?.kind === 'history' ? `/finance/filing/assignments/${dialog.id}/submissions?page=${historyPage}&limit=20` : null, revision)
  const detail = useFinanceResource(dialog?.kind === 'assignment' ? `/finance/filing/assignments/${dialog.id}` : null, revision)
  const act = async (path, payload, message) => {
    try { await post(path, payload); action.invalidate(); return true }
    catch (error) { action.report(error.message); return false }
  }
  const run = async (path, body) => { const result = await action.run(path, body); if (result?.results) setReceipt(result); return result }
  const resource = section === 'tasks' ? tasks : assignments
  const rows = financeRows(resource.data)
  const departments = ctx.departments || []
  const departmentName = row => row.departmentName || departments.find(department => department.id === row.departmentId)?.name || '部门待核对'
  return h('div', { className: 'sf-stack' },
    h(GhostButton, { onClick: () => ctx.onNavigate?.('budget-filing', { year: ctx.year, ...(taskId ? { taskId } : {}) }) }, '预算填报与审核'),
    h('p', { className: 'sf-note' }, '以下待办计数为当前年度全部可见活动；可填写计数仅含开放且未截止窗口，列表保留可查历史。'),
    h(FinanceResource, { resource: summary }, h('div', { className: 'sf-kpis' }, ...[['fillablePending', '窗口内待填写'], ['fillableDraft', '窗口内草稿'], ['fillableRejected', '窗口内退回待改'], ['submitted', '待复核']].map(([key, label]) => h(KpiCard, { key, label, value: summary.data?.[key] })))),
    h('div', { className: 'sf-row' },
      section === 'assignments' ? h('div', { className: 'sf-row', 'aria-label': '填报任务阶段' }, ...FINANCE_FILING_STAGES.map(item => h(GhostButton, { key: item.id, 'aria-pressed': stage === item.id, onClick: () => { setStage(item.id); setPage(1) } }, item.label))) : h(Select, { 'aria-label': '填报状态', value: status, placeholder: '全部状态', options: section === 'tasks' ? [['DRAFT', '草稿活动'], ['OPEN', '开放活动'], ['CLOSED', '已关闭活动']] : [['PENDING', '待填写'], ['DRAFT', '草稿'], ['SUBMITTED', '已提交'], ['REJECTED', '已退回'], ['CONFIRMED', '已确认'], ['LOCKED', '已锁定'], ['VOIDED', '已作废']], onChange: value => { setStatus(value); setPage(1) } }),
      section === 'department' ? h(Select, { 'aria-label': '填报部门', value: departmentId, options: ctx.departments.map(row => [row.id, row.name]), placeholder: '全部可见部门', onChange: value => { setDepartmentId(value); setPage(1) } }) : null,
      manage && section === 'tasks' ? h(GhostButton, { onClick: () => setDialog({ kind: 'create' }) }, t('createTask')) : null),
    section === 'assignments' ? h('p', { className: 'sf-note' }, `当前阶段共 ${resource.data?.total ?? '—'} 项，每页20项；作废记录可在部门填报按状态查阅。提交后须财务确认才计入正式数据。`) : null,
    taskId ? h('p', null, `正在查看活动 ${taskId}`, h(GhostButton, { onClick: () => { setTaskId(''); setPage(1); ctx.onNavigate?.('filing', { section, year: ctx.year }) } }, '清除活动筛选')) : null,
    h(Notice, null, action.notice),
    h(Card, { title: section === 'tasks' ? '填报活动' : section === 'mine' ? '我的记录' : section === 'department' ? '部门填报' : '待填报任务' }, h(FinanceResource, { resource }, h(Table, { tableId: `finance-filing-${section}`, rows, empty: '暂无记录', columns: [
      ...financeColumns(section === 'tasks' ? [['title', '活动'], ['year', '年度'], ['type', '类型'], ['status', '状态'], ['dueAt', '截止时间']] : [['taskTitle', '活动'], ['assigneeName', '填报人'], ['status', '状态'], ['submissionNo', '当前提交版本'], ['submittedAt', '提交时间']]),
      ...(section === 'tasks' ? [{ key: 'allowModify', label: '窗口内修改', render: row => row.allowModify ? '允许（确认前）' : '不允许' }] : [{ key: 'departmentName', label: '部门', render: departmentName }, { key: 'dueAt', label: '截止时间', render: row => row.task?.dueAt ? new Date(row.task.dueAt).toLocaleString('zh-CN', { hour12: false }) : '—' }, { key: 'editability', label: '填写窗口', render: row => financeFilingWindow(row) }, { key: 'rejectReason', label: '退回 / 作废原因', render: row => row.rejectReason || row.voidReason || '—' }]),
      { key: 'actions', label: '操作', sortable: false, render: row => h('div', { className: 'sf-row' },
        section === 'tasks' ? h(React.Fragment, null,
          h(GhostButton, { onClick: () => ctx.onNavigate?.('filing', { section: 'department', taskId: row.id, year: row.year ?? ctx.year }) }, '查看部门进度'),
          manage && row.status === 'DRAFT' ? h(GhostButton, { onClick: () => setDialog({ kind: 'publish', title: '发布填报活动', row }) }, '发布活动') : null,
          manage && row.status === 'OPEN' ? h(GhostButton, { onClick: () => setDialog({ kind: 'close', title: '关闭填报活动', row }) }, '关闭活动') : null,
          reopen && row.status === 'CLOSED' ? h(GhostButton, { onClick: () => setDialog({ kind: 'reopenTask', title: '重开填报活动', row }) }, '重开活动') : null,
          verify && row.status === 'OPEN' ? h(GhostButton, { onClick: () => setDialog({ kind: 'confirmAll', title: '确认活动内全部已提交填报', row }) }, '全部定稿') : null)
          : h(React.Fragment, null,
            h(GhostButton, { onClick: () => setDialog({ kind: 'assignment', id: row.id }) }, '查看 / 填写'),
            h(GhostButton, { onClick: () => { setHistoryPage(1); setDialog({ kind: 'history', id: row.id, row, title: '提交版本历史' }) } }, '提交历史'),
            manage ? h(GhostButton, { onClick: () => setDialog({ kind: 'assignee', title: '指定填报人', row }) }, '指定填报人') : null,
            verify && row.status === 'SUBMITTED' ? h(GhostButton, { onClick: () => setDialog({ kind: 'reopenAssignment', title: '重开已提交填报', row }) }, '重开填报') : null,
            verify && row.status === 'CONFIRMED' ? h(GhostButton, { onClick: () => setDialog({ kind: 'lock', title: '锁定已确认填报', row }) }, '锁定填报') : null,
            verify && ['PENDING', 'DRAFT', 'SUBMITTED', 'REJECTED'].includes(row.status) ? h(GhostButton, { onClick: () => setDialog({ kind: 'void', title: '作废未确认填报', row }) }, '作废填报') : null)) },
    ] })), h(Pager, { page, total: resource.data?.total, limit: 20, onPage: setPage })),
    dialog?.kind === 'create' ? h(CreateTaskDialog, { year: ctx.year, orgs: ctx.orgs, departments: ctx.departments, members: members.error ? { error: true } : members.data, busy: action.busy, t, act, onClose: () => { setDialog(null); tasks.retry() } }) : null,
    dialog?.kind === 'assignment' ? detail.error || detail.loading ? h(Dialog, { title: '填报详情', onClose: () => setDialog(null) }, h(FinanceResource, { resource: detail })) : detail.data ? detail.data.task?.type === 'BUDGET' ? h(Dialog, { title: '预算填报与审核', onClose: () => setDialog(null) }, h('p', null, '预算按条目填报，经对接人初审和负责人终审后整体提交。'), h(PrimaryButton, { onClick: () => ctx.onNavigate?.('budget-filing', { year: String(detail.data.task.year), taskId: detail.data.taskId || detail.data.task.id }) }, '进入预算填报与审核')) : h(AssignmentDialog, { key: detail.data.id, assignment: detail.data, canEdit: ctx.permissions.includes('budget.submission.edit'), canVerify: verify, busy: action.busy, t, act, onClose: () => { setDialog(null); assignments.retry() } }) : null : null,
    dialog?.kind === 'history' ? h(Dialog, { title: dialog.title, onClose: () => setDialog(null) }, h(FinanceFilingHistory, { resource: history, assignment: dialog.row, page: historyPage, onPage: setHistoryPage })) : null,
    dialog && !['create', 'assignment', 'history'].includes(dialog.kind) ? h(FinanceFormDialog, { title: dialog.title, description: `${dialog.row.title || dialog.row.taskTitle || dialog.row.task?.title || '当前填报'} · ${dialog.row.year || dialog.row.task?.year || ctx.year}年 · ${financeDisplayValue(dialog.row.type || dialog.row.task?.type, 'type')} · ${departmentName(dialog.row)} · ${financeDisplayValue(dialog.row.status, 'status')} · 截止 ${dialog.row.dueAt || dialog.row.task?.dueAt || '待核对'} · 窗口内修改${(dialog.row.allowModify ?? dialog.row.task?.allowModify) ? '允许（确认前）' : '不允许'}。请核对后确认。`, onClose: () => setDialog(null), fields: dialog.kind === 'assignee' ? [{ key: 'assigneeUserId', label: '填报人（留空清除指定）', options: financeRows(members.data).map(row => [row.userId, row.name || row.userId]) }] : dialog.kind === 'publish' || dialog.kind === 'confirmAll' || dialog.kind === 'lock' ? [] : [{ key: 'reason', label: '原因', required: ['reopenTask', 'reopenAssignment', 'void'].includes(dialog.kind), type: 'textarea' }, ...(dialog.kind === 'reopenTask' ? [{ key: 'newDueAt', label: '新的截止时间', type: 'datetime-local' }] : [])], onSubmit: body => {
      const id = dialog.row.id
      if (dialog.kind === 'assignee') return run(`/finance/filing/assignments/${id}/assignee`, { assigneeUserId: body.assigneeUserId || null, assigneeName: financeRows(members.data).find(row => row.userId === body.assigneeUserId)?.name || null })
      if (dialog.kind === 'reopenAssignment' || dialog.kind === 'lock' || dialog.kind === 'void') return run(`/finance/filing/assignments/${id}/${dialog.kind === 'reopenAssignment' ? 'reopen' : dialog.kind}`, body)
      return run(`/finance/filing/tasks/${id}/${dialog.kind === 'reopenTask' ? 'reopen' : dialog.kind === 'confirmAll' ? 'confirm-all' : dialog.kind}`, body)
    } }) : null,
    receipt ? h(Card, { title: '批量定稿回执' }, h(FinanceEvidence, { value: receipt })) : null)
}

const FINANCE_FILING_STAGES = [
  { id: 'all', label: '全部有效任务', statuses: ['PENDING', 'DRAFT', 'REJECTED', 'SUBMITTED', 'CONFIRMED', 'LOCKED'] },
  { id: 'todo', label: '待填写', statuses: ['PENDING', 'DRAFT'] },
  { id: 'rejected', label: '待修改', statuses: ['REJECTED'] },
  { id: 'submitted', label: '待财务验证', statuses: ['SUBMITTED'] },
  { id: 'done', label: '已确认', statuses: ['CONFIRMED', 'LOCKED'] },
]
function financeFilingWindow(row, now = Date.now()) {
  if (['CONFIRMED', 'LOCKED', 'VOIDED'].includes(row.status)) return '已收口，不可编辑'
  if (row.task?.status !== 'OPEN') return '活动未开放 / 已关闭'
  if (!row.task?.dueAt || !Number.isFinite(Date.parse(row.task.dueAt))) return '截止待核对，以详情校验为准'
  if (Date.parse(row.task.dueAt) < now) return '已截止，不可编辑'
  return row.status === 'SUBMITTED' ? row.task.allowModify ? '确认前可修改并重新提交' : '等待财务验证，不可修改' : '窗口开放，按本人归属填写'
}
function FinanceFilingHistory({ resource, assignment, page, onPage }) {
  const rows = financeRows(resource.data), current = assignment?.submissionNo
  return h('div', { className: 'sf-stack' }, h('p', { className: 'sf-note' }, '每次重新提交保留独立版本。当前提交版本只有经财务确认后才进入正式数据，历史版本不重复计入。'),
    h(FinanceResource, { resource }, h(Table, { tableId: 'finance-filing-submission-history', rows, empty: '暂无提交版本', columns: [
      { key: 'submissionNo', label: '提交版本', render: row => `第${row.submissionNo}版` },
      { key: 'validity', label: '版本状态', render: row => current == null ? '已提交版本，当前版本待核对' : row.submissionNo < current ? '已被新版本替代，不进入统计' : row.submissionNo === current ? '当前提交版本（入库以确认状态为准）' : '版本已变化，请刷新核对' },
      ...financeColumns([['rowCount', '行数'], ['totalAmount', '合计（元）'], ['submittedByName', '提交人'], ['submittedAt', '提交时间']]),
      { key: 'changeSummary', label: '变更说明', render: row => row.changeSummary ? h(FinanceEvidence, { value: row.changeSummary }) : '未提供差异摘要' },
    ] }), h(Pager, { page, total: resource.data?.total, limit: 20, onPage })))
}
