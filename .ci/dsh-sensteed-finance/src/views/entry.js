// 片段 5/7 视图：录入（填报控制台：任务管理/我的填报 + 通讯录 + 归属记录 + 成员角色 + 录入面板 4 类型）

const FINANCE_ROLES = ['DEPT_FILLER', 'DEPT_LEADER', 'DEPT_COLLABORATOR', 'BOSS', 'FINANCE_STAFF', 'FINANCE_OWNER', 'MANAGEMENT']

function EntryView({ ctx, t }) {
  const { year, orgs, departments, revision } = ctx
  const [section, setSection] = useState('filing')
  const [tasks, setTasks] = useState(null)
  const [assignments, setAssignments] = useState(null)
  const [contacts, setContacts] = useState(null)
  const [employmentContacts, setEmploymentContacts] = useState(null)
  const [employments, setEmployments] = useState(null)
  const [members, setMembers] = useState(null)
  const [quality, setQuality] = useState(null)
  const [keyword, setKeyword] = useState('')
  const [onlyUnmapped, setOnlyUnmapped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [reloadTick, setReloadTick] = useState(0)
  const retryLists = () => setReloadTick(value => value + 1)

  const act = async (path, payload, doneMessage) => {
    setBusy(true); setNotice(null)
    try {
      const result = await post(path, payload)
      setNotice(typeof doneMessage === 'function' ? doneMessage(result?.data ?? result) : doneMessage ?? t('submitted'))
      setReloadTick(value => value + 1)
      return true
    } catch (error) { setNotice(`${t('opFailed')}: ${error.message}`); return false } finally { setBusy(false) }
  }

  useEffect(() => { setNotice(null) }, [revision])
  useEffect(() => {
    let cancelled = false
    setTasks(null); setAssignments(null); setMembers(null)
    api('/filing-tasks').then(value => { if (!cancelled) setTasks(value.data ?? { list: [] }) }).catch(() => { if (!cancelled) setTasks({ list: [], error: true }) })
    api('/filing-assignments').then(value => { if (!cancelled) setAssignments(value.data ?? { list: [] }) }).catch(() => { if (!cancelled) setAssignments({ list: [], error: true }) })
    setEmployments(null)
    api('/employment-records?limit=50').then(value => { if (!cancelled) setEmployments(value.data ?? { list: [] }) }).catch(() => { if (!cancelled) setEmployments({ list: [], error: true }) })
    api('/members').then(value => { if (!cancelled) setMembers(value.data ?? { list: [] }) }).catch(error => { if (!cancelled) setMembers(error?.status === 403 ? { list: [], forbidden: true } : { list: [], error: true }) })
    api('/quality').then(value => { if (!cancelled) setQuality(value) }).catch(() => {})
    return () => { cancelled = true }
  }, [revision, reloadTick])
  useEffect(() => {
    let cancelled = false
    setContacts(null)
    api(`/contacts?limit=100&${onlyUnmapped ? 'onlyUnmapped=1&' : ''}${keyword.trim() ? `keyword=${encodeURIComponent(keyword.trim())}` : ''}`)
      .then(value => { if (!cancelled) setContacts(value.data ?? { list: [] }) })
      .catch(() => { if (!cancelled) setContacts({ list: [], error: true }) })
    return () => { cancelled = true }
  }, [revision, reloadTick, keyword, onlyUnmapped])
  const employmentOpen = dialog?.kind === 'employment'
  useEffect(() => {
    if (!employmentOpen) return
    let cancelled = false
    setEmploymentContacts(null)
    api('/contacts?limit=100')
      .then(value => { if (!cancelled) setEmploymentContacts(value.data ?? { list: [] }) })
      .catch(() => { if (!cancelled) setEmploymentContacts({ list: [], error: true }) })
    return () => { cancelled = true }
  }, [employmentOpen, revision, reloadTick])

  const unassignedCount = (quality?.quality?.issues || []).find(issue => /unassigned|未分配/i.test(issue.label ?? issue.dataset ?? ''))?.count ?? 0

  return h('div', { className: 'sf-view' },
    h('div', { className: 'sf-row-between' },
      h(PillTabs, { tabs: [['filing', 'filingTasks'], ['my', 'myFiling'], ['org', 'directory']], value: section, onChange: setSection, t }),
      notice ? h(Notice, null, notice) : null),

    // 录入前检查（对齐前端录入前检查卡：未分配>0 时告警）
    quality ? h('div', { className: `sf-banner ${unassignedCount > 0 ? 'sf-banner-amber' : 'sf-banner-green'}` },
      h(Glyph, { name: unassignedCount > 0 ? 'warning' : 'check', size: 14 }),
      unassignedCount > 0 ? t('preCheckBad').replace('{n}', String(unassignedCount)) : t('preCheckOk')) : null,

    section === 'filing' ? h(FilingSection, { tasks, busy, t, act, onDialog: setDialog, onRetry: retryLists }) : null,
    section === 'my' ? h(MyFilingSection, { assignments, busy, t, act, onDialog: setDialog, onRetry: retryLists, onReopen: assignment => { setDialog({ kind: 'reason', title: t('reopenFiling'), required: true, run: reason => act(`/filing-assignments/${assignment.id}/reopen`, { reason }) }) } }) : null,
    section === 'org' ? h('div', { className: 'sf-stack' },
      h(DirectoryCard, { contacts, keyword, setKeyword, onlyUnmapped, setOnlyUnmapped, busy, t, act, onDialog: setDialog, onRetry: () => setReloadTick(value => value + 1) }),
      h(EmploymentCard, { employments, busy, t, onDialog: setDialog, onRetry: () => setReloadTick(value => value + 1) }),
      h(MembersCard, { members, busy, t, act, onDialog: setDialog, onRetry: retryLists })) : null,

    // 录入面板常开内嵌（对齐前端 FinanceEntryPanel）
    h(EntryPanel, { year, orgs, departments, t, act }),

    dialog?.kind === 'createTask' ? h(CreateTaskDialog, { year, departments, members, busy, t, onClose: () => setDialog(null), act }) : null,
    dialog?.kind === 'assignment' ? h(AssignmentDialog, { assignment: dialog.assignment, busy, t, onClose: () => setDialog(null), act }) : null,
    dialog?.kind === 'reason' ? h(ReasonDialog, { title: dialog.title, required: dialog.required, t, onClose: () => setDialog(null), onSubmit: reason => { setDialog(null); return dialog.run(reason) } }) : null,
    dialog?.kind === 'mapUser' ? h(MapUserDialog, { contact: dialog.contact, t, onClose: () => setDialog(null), act }) : null,
    employmentOpen ? h(EmploymentDialog, { contacts: employmentContacts?.list ?? [], contactsLoading: !employmentContacts, contactsError: employmentContacts?.error, departments, busy, t, onRetry: () => setReloadTick(value => value + 1), onClose: () => setDialog(null), act }) : null,
  )
}

// ---- 任务管理（财务） ----

function ListLoadError({ label, onRetry }) {
  return h('div', { className: 'sf-stack', role: 'alert' },
    h('p', { className: 'sf-neg' }, `${label}加载失败，请重试。`),
    h(LinkButton, { onClick: onRetry }, '重试加载'))
}

function FilingSection({ tasks, busy, t, act, onDialog, onRetry }) {
  const rows = tasks?.list || []
  return h(Card, { title: t('filingTasks'), actions: [h(PrimaryButton, { key: 'add', busy, onClick: () => onDialog({ kind: 'createTask' }) }, h(Glyph, { name: 'plus', size: 12 }), t('createTask'))] }, h(Table, {
    columns: [
      { label: t('taskTitle'), key: 'title', stickyLeft: true },
      { label: t('taskType'), key: 'type', sortValue: row => row.type === 'BUDGET' ? t('typeBudget') : t('typePlan'), render: row => row.type === 'BUDGET' ? t('typeBudget') : t('typePlan') },
      { label: t('taskYear'), key: 'year', num: true },
      { label: t('dueCol'), key: 'dueAt', sortValue: row => row.dueAt ?? row.task?.dueAt ?? null, render: row => h('span', { className: isOverdue(row) ? 'sf-neg' : '' }, `${shortDate(row.dueAt) ?? '—'}${isOverdue(row) ? ` · ${t('overdue')}` : ''}`), num: true },
      { label: t('statusCol'), key: 'status', render: row => h(Pill, { tone: row.status === 'CLOSED' ? 'muted' : 'green' }, row.status === 'CLOSED' ? t('taskClosed') : t('stPending')) },
      {
        label: t('actions'), key: 'actions', sortable: false,
        render: row => h('div', { className: 'sf-row', style: { flexWrap: 'nowrap', justifyContent: 'flex-end' } },
          row.status !== 'CLOSED' ? h(LinkButton, { onClick: () => act(`/filing-tasks/${row.id}/close`, {}) }, t('closeTask')) : null),
      },
    ],
    rows: tasks?.error ? [] : rows,
    empty: !tasks ? t('loading') : tasks.error ? h(ListLoadError, { label: '填报任务', onRetry }) : t('empty'),
    rowKey: 'id', tableId: 'finance-filing-tasks',
  }))
}

const isOverdue = task => task.status !== 'CLOSED' && task.dueAt && new Date(task.dueAt) < new Date()

function CreateTaskDialog({ year, departments, members, busy, t, onClose, act }) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState('PAYMENT_PLAN')
  const [month, setMonth] = useState(String(Math.min(12, new Date().getMonth() + 2)))
  const [versionId, setVersionId] = useState('')
  const [versions, setVersions] = useState(null)
  const [selectedDepartmentIds, setSelectedDepartmentIds] = useState((departments || []).map(department => department.id))
  const [dueAt, setDueAt] = useState('')
  const [instructions, setInstructions] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [reviewerName, setReviewerName] = useState('')
  const [allowModify, setAllowModify] = useState(true)
  const [freezeCurrentMonth, setFreezeCurrentMonth] = useState(true)
  const [startAsDraft, setStartAsDraft] = useState(false)
  const [departmentSelectionReady, setDepartmentSelectionReady] = useState(Boolean(departments?.length))
  const [versionError, setVersionError] = useState(false)
  const [versionRetry, setVersionRetry] = useState(0)
  const personOptions = [...new Set((members?.list || []).filter(member => member.enabled !== false).map(member => member.name?.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN')).map(name => [name, name])
  const validDepartmentIds = selectedDepartmentIds.filter(id => (departments || []).some(department => department.id === id))
  useEffect(() => {
    if (!departmentSelectionReady && departments?.length) {
      setSelectedDepartmentIds(departments.map(department => department.id))
      setDepartmentSelectionReady(true)
    }
  }, [departmentSelectionReady, departments])
  useEffect(() => {
    let cancelled = false
    setVersions(null)
    setVersionError(false)
    setVersionId('')
    api(`/budget-versions?year=${year}`).then(value => {
      if (!cancelled) setVersions((value.data?.list || []).filter(version => version.status !== 'LOCKED'))
    }).catch(() => { if (!cancelled) { setVersions([]); setVersionError(true) } })
    return () => { cancelled = true }
  }, [year, versionRetry])
  const months = Array.from({ length: 12 }, (_, index) => [String(index + 1), `${index + 1}月`])
  const canSubmit = !busy && title.trim() && dueAt && Number.isFinite(new Date(dueAt).getTime()) && validDepartmentIds.length &&
    (type !== 'BUDGET' || (!versionError && versions?.some(version => version.id === versionId))) &&
    (type !== 'PAYMENT_PLAN' || (Number(month) >= 1 && Number(month) <= 12))
  const submit = async () => {
    if (!canSubmit) return
    const created = await act('/filing-tasks', {
      title: title.trim(), type, year: Number(year), dueAt: new Date(dueAt).toISOString(),
      ...(type === 'PAYMENT_PLAN' ? { month: Number(month) } : { versionId }),
      departments: validDepartmentIds.map(departmentId => ({ departmentId })),
      ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
      ...(ownerName.trim() ? { ownerName: ownerName.trim() } : {}),
      ...(reviewerName.trim() ? { reviewerName: reviewerName.trim() } : {}),
      allowModify, freezeCurrentMonth, startAsDraft,
    })
    if (created) onClose()
  }
  return h(Dialog, { title: t('createTask'), onClose, footer: [
    h(GhostButton, { key: 'cancel', onClick: onClose }, t('cancel')),
    h(PrimaryButton, { key: 'ok', disabled: !canSubmit, busy, onClick: submit }, t(startAsDraft ? 'taskStartDraft' : 'taskPublish')),
  ] },
    h('fieldset', { className: 'sf-stack sf-fieldset', disabled: busy, 'aria-busy': busy },
      h(FormRow, { label: t('taskTitle') }, h(Field, { value: title, onChange: setTitle, maxLength: 150 })),
      h(FormRow, { label: t('taskType') }, h(Select, { value: type, onChange: setType, options: [['PAYMENT_PLAN', t('typePlan')], ['BUDGET', t('typeBudget')]] })),
      type === 'PAYMENT_PLAN'
        ? h(FormRow, { label: t('taskMonth') }, h(Select, { value: month, onChange: setMonth, options: months, placeholder: t('taskMonth') }))
        : h(FormRow, { label: t('version') }, h(SearchSelect, { value: versionId, onChange: setVersionId, options: (versions || []).map(version => [version.id, budgetVersionLabel(version)]), placeholder: t('version'), disabled: busy || !versions?.length })),
      type === 'BUDGET' && versionError ? h('div', { className: 'sf-row', role: 'alert' }, '预算版本加载失败', h(LinkButton, { onClick: () => setVersionRetry(value => value + 1) }, '重新加载版本')) : null,
      type === 'BUDGET' && !versionError && versions && !versions.length ? h('p', { className: 'sf-note' }, `${t('empty')} · ${t('version')}`) : null,
      h('div', { className: 'sf-inline-form' },
        h('div', { className: 'sf-row-between' }, h('strong', null, `${t('taskDepartments')}（${validDepartmentIds.length}/${departments?.length || 0}）`),
          h('div', { className: 'sf-row' },
            h(LinkButton, { onClick: () => setSelectedDepartmentIds((departments || []).map(department => department.id)) }, t('selectAll')),
            h(LinkButton, { onClick: () => setSelectedDepartmentIds([]) }, t('clearFilters')))),
        h(MultiSearchSelect, {
          value: validDepartmentIds,
          onChange: setSelectedDepartmentIds,
          options: (departments || []).map(department => [department.id, department.name]),
          placeholder: t('department'),
          disabled: busy || !departments?.length,
        }),
        !departments?.length ? h('p', { className: 'sf-note' }, `${t('empty')} · ${t('department')}`) : null),
      h(FormRow, { label: t('taskDue') }, h(Field, { type: 'datetime-local', value: dueAt, onChange: setDueAt })),
      h(FormRow, { label: t('taskInstructions') }, h(Field, { value: instructions, onChange: setInstructions, maxLength: 500 })),
      h(FormRow, { label: t('taskOwner') }, h(SearchSelect, { value: ownerName, onChange: setOwnerName, options: personOptions, allowCustom: true, placeholder: t('taskOwner'), maxLength: 100, disabled: busy })),
      h(FormRow, { label: t('taskReviewer') }, h(SearchSelect, { value: reviewerName, onChange: setReviewerName, options: personOptions, allowCustom: true, placeholder: t('taskReviewer'), maxLength: 100, disabled: busy })),
      members?.forbidden || members?.error ? h('p', { className: 'sf-note' }, '人员列表暂时无法加载，可在选择器中输入并确认自定义姓名。') : null,
      h('div', { className: 'sf-task-options' },
        h('label', null, h('input', { type: 'checkbox', checked: allowModify, onChange: event => setAllowModify(event.target.checked) }), t('taskAllowModify')),
        h('label', null, h('input', { type: 'checkbox', checked: freezeCurrentMonth, onChange: event => setFreezeCurrentMonth(event.target.checked) }), t('taskFreezeMonth')),
        h('label', null, h('input', { type: 'checkbox', checked: startAsDraft, onChange: event => setStartAsDraft(event.target.checked) }), t('taskStartDraft')))))
}

// ---- 我的填报（部门） ----

function MyFilingSection({ assignments, busy, t, act, onDialog, onRetry, onReopen }) {
  const rows = assignments?.list || []
  return h(Card, { title: t('myFiling') }, h(Table, {
    columns: [
      { label: t('taskTitle'), key: 'title', sortValue: row => row.task?.title ?? row.taskTitle ?? '', render: row => row.task?.title ?? row.taskTitle ?? '—', stickyLeft: true },
      { label: t('departmentCol'), key: 'departmentName' },
      { label: t('statusCol'), key: 'status', render: row => h(Pill, { tone: row.status === 'LOCKED' ? 'green' : row.status === 'SUBMITTED' ? 'amber' : 'muted' }, row.status === 'LOCKED' ? t('commitFiling') : row.status === 'SUBMITTED' ? t('stSubmitted') : t('stDraft')) },
      { label: t('dueCol'), key: 'dueAt', sortValue: row => row.dueAt ?? row.task?.dueAt ?? null, render: row => h('span', { className: isOverdue(row) ? 'sf-neg' : '' }, shortDate(row.dueAt ?? row.task?.dueAt) ?? '—'), num: true },
      {
        label: t('actions'), key: 'actions', sortable: false,
        render: row => h('div', { className: 'sf-row', style: { flexWrap: 'nowrap', justifyContent: 'flex-end' } },
          h(LinkButton, { onClick: () => onDialog({ kind: 'assignment', assignment: row }) }, t('rowsEditor')),
          row.status === 'LOCKED' ? h(LinkButton, { onClick: () => onReopen(row) }, t('reopenFiling')) : null),
      },
    ],
    rows: assignments?.error ? [] : rows,
    empty: !assignments ? t('loading') : assignments.error ? h(ListLoadError, { label: '我的填报', onRetry }) : t('empty'),
    rowKey: 'id', tableId: 'finance-filing-assignments',
  }))
}

/** 部门行编辑器：月份/说明/金额多行 + 暂存/提交；复核定稿在弹窗内完成，重开走外层 ReasonDialog */
function AssignmentDialog({ assignment, busy, t, onClose, act }) {
  const task = assignment.task
  const editable = task?.status === 'OPEN' && (!task.dueAt || new Date(task.dueAt).getTime() >= Date.now()) &&
    (['PENDING', 'DRAFT', 'REJECTED'].includes(assignment.status) || (assignment.status === 'SUBMITTED' && task.allowModify === true))
  const emptyRow = () => ({ costItemId: '', month: String(task?.month ?? ''), description: '', plannedAmount: '' })
  const [rows, setRows] = useState(() => assignment.rows?.length ? assignment.rows.map(row => ({ ...row })) : [emptyRow()])
  const [costItems, setCostItems] = useState(null)
  const [costError, setCostError] = useState(false)
  const [reload, setReload] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    setCostError(false)
    api('/cost-items').then(value => {
      if (!cancelled) setCostItems((value.data?.list || []).filter(item => item.active))
    }).catch(() => { if (!cancelled) setCostError(true) })
    return () => { cancelled = true }
  }, [reload])
  const months = Array.from({ length: 12 }, (_, index) => [String(index + 1), (index + 1) + '月'])
  const updateRow = (index, patch) => setRows(current => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)))
  const persist = async thenSubmit => {
    if (!editable || saving || busy) return
    const filled = rows.filter(row => String(row.plannedAmount ?? '').trim())
    if (filled.some(row => !Number.isFinite(Number(row.plannedAmount)) || Number(row.plannedAmount) <= 0)) {
      setError('请填写大于 0 的金额'); return
    }
    if (thenSubmit && (!filled.length || filled.some(row => !row.costItemId || !row.month))) {
      setError('请至少填写一行，并补全费用类别、月份和金额'); return
    }
    setSaving(true); setError('')
    try {
      const saved = await act('/filing-assignments/' + assignment.id + '/rows', {
        rows: filled.map(row => ({
          ...(row.costItemId ? { costItemId: row.costItemId } : {}),
          ...(row.month ? { month: Number(row.month) } : {}),
          plannedAmount: Number(row.plannedAmount),
          ...(row.description ? { description: row.description } : {}),
        })),
      }, t('saved'))
      if (!saved) { setError('保存失败，填写内容已保留，请重试'); return }
      if (thenSubmit && !await act('/filing-assignments/' + assignment.id + '/submit', {})) {
        setError('内容已暂存，提交失败，请重试'); return
      }
      onClose()
    } catch {
      setError('操作失败，填写内容已保留，请重试')
    } finally { setSaving(false) }
  }
  return h(Dialog, { title: t('assignmentTitle') + ' · ' + (assignment.departmentName ?? ''), width: 'lg', onClose, footer: [
    editable ? h(GhostButton, { key: 'save', disabled: busy || saving, onClick: () => persist(false) }, t('saveDraft')) : null,
    editable ? h(PrimaryButton, { key: 'submit', busy: busy || saving, onClick: () => persist(true) }, t('submitFiling')) : null,
    assignment.status === 'SUBMITTED' ? h(PrimaryButton, {
      key: 'commit', busy: busy || saving,
      onClick: async () => { if (await act('/filing-assignments/' + assignment.id + '/commit', {})) onClose() },
    }, t('commitFiling')) : null,
    h(GhostButton, { key: 'cancel', disabled: saving, onClick: onClose }, t('close')),
  ] },
    h('div', { className: 'sf-stack' },
      !editable ? h('p', { className: 'sf-note' }, '当前填报只读；仅开放且未过期的活动可填写，已提交记录须在允许修改的窗口内重提。') : null,
      costError ? h('div', { role: 'alert' }, '费用类别加载失败', h(LinkButton, { onClick: () => setReload(value => value + 1) }, '重试')) : null,
      costItems && !costItems.length && !costError ? h('p', { className: 'sf-note' }, '暂无可用费用类别，请联系财务维护。') : null,
      error ? h('p', { role: 'alert', className: 'sf-neg' }, error) : null,
      h('div', { className: 'sf-row-between' },
        h('strong', null, t('rowsEditor')),
        editable ? h(LinkButton, { disabled: busy || saving, onClick: () => setRows(current => [...current, emptyRow()]) }, h(Glyph, { name: 'plus', size: 12 }), t('addRow')) : null),
      ...rows.map((row, index) => h('div', { key: row.id ?? index, className: 'sf-inline-form' },
        h('div', { className: 'sf-filters' },
          h(FormRow, { label: '费用类别' }, h(SearchSelect, {
            value: row.costItemId ?? '', onChange: value => updateRow(index, { costItemId: value }),
            options: (costItems || []).map(item => [item.id, item.name]),
            placeholder: costItems ? '费用类别' : '费用类别（加载中）', disabled: !editable || busy || saving || !costItems || costError,
          })),
          h(FormRow, { label: t('monthCol') }, h(Select, { value: String(row.month ?? ''), onChange: value => updateRow(index, { month: value }), options: months, placeholder: t('monthCol'), disabled: !editable || busy || saving })),
          h(FormRow, { label: t('description') }, h(Field, { value: row.description ?? '', onChange: value => updateRow(index, { description: value }), maxLength: 500, disabled: !editable || busy || saving })),
          h(FormRow, { label: t('planned') }, h(Field, { type: 'number', min: '0.01', step: '0.01', value: row.plannedAmount ?? '', onChange: value => updateRow(index, { plannedAmount: value }), disabled: !editable || busy || saving })),
          editable ? h(LinkButton, { disabled: busy || saving, onClick: () => setRows(current => current.filter((_, rowIndex) => rowIndex !== index)) }, h(Glyph, { name: 'trash', size: 13 })) : null))),
      h('p', { className: 'sf-note' }, t('entryHint'))))
}

// ---- 通讯录 / 归属 / 成员 ----

function DirectoryCard({ contacts, keyword, setKeyword, onlyUnmapped, setOnlyUnmapped, busy, t, act, onDialog, onRetry }) {
  const rows = contacts?.list || []
  return h(Card, {
    title: t('directory'),
    actions: [
      h(LinkButton, { key: 'sync', disabled: busy, onClick: () => act('/contacts-sync', {}, result => result?.skipped
        ? `同步跳过：${result.reason ?? '应用未配置'}`
        : result ? `同步完成：人员 ${result.users}，部门 ${result.departments}，部门匹配 ${result.departmentMatched}，用户匹配 ${result.userMatched}` : t('submitted')) }, t('dirSync')),
      h('label', { key: 'unmapped', className: 'sf-row', style: { gap: 6, fontSize: 12, color: 'var(--sf-ink2)' } },
        h('input', { type: 'checkbox', checked: onlyUnmapped, onChange: event => setOnlyUnmapped(event.target.checked) }), t('unmappedOnly')),
    ],
  },
    h('div', { className: 'sf-stack' },
      h(FormRow, { label: t('dirSearch') }, h(Field, { value: keyword, onChange: setKeyword, placeholder: t('dirSearch') })),
      h(Table, {
        columns: [
          { label: t('memberUser'), key: 'name', stickyLeft: true },
          { label: 'mobile', key: 'mobile' },
          { label: 'email', key: 'email' },
          { label: '同步时间', key: 'syncedAt', render: row => shortDate(row.syncedAt) ?? '—' },
          { label: t('systemUserId'), key: 'systemUserId', sortValue: row => Boolean(row.systemUserId), render: row => row.systemUserId ? h(Badge, { tone: 'green' }, '✓') : h(Badge, { tone: 'amber' }, t('unmappedOnly')) },
          { label: t('actions'), key: 'actions', sortable: false, render: row => h(LinkButton, { onClick: () => onDialog({ kind: 'mapUser', contact: row }) }, t('mapUser')) },
        ],
        rows: contacts?.error ? [] : rows,
        empty: !contacts ? t('loading') : contacts.error
          ? h('div', { role: 'alert' }, '读取通讯录暂时不可用。', h(LinkButton, { onClick: onRetry }, '重试加载'))
          : keyword || onlyUnmapped ? '没有匹配的通讯录人员' : '暂无通讯录人员',
        rowKey: 'id', tableId: 'finance-contacts',
      })))
}

function MapUserDialog({ contact, t, onClose, act }) {
  const [userId, setUserId] = useState(contact.systemUserId ?? '')
  const submit = async () => {
    if (!userId.trim()) return
    if (await act(`/contacts/${contact.id}/map-user`, { userId: userId.trim() })) onClose()
  }
  return h(Dialog, { title: `${t('mapUser')} · ${contact.name ?? ''}`, width: 'sm', onClose, footer: [
    h(GhostButton, { key: 'cancel', onClick: onClose }, t('cancel')),
    h(PrimaryButton, { key: 'ok', disabled: !userId.trim(), onClick: submit }, t('confirm')),
  ] },
    h(FormRow, { label: t('systemUserId') }, h(Field, { value: userId, onChange: setUserId })))
}

function employmentSourceLabel(row) {
  if (row.sourceRef === 'manual') return '人工补录'
  if (row.sourceRef?.startsWith('feishu-contact')) return '通讯录同步'
  return row.sourceRef || '—'
}

function employmentDateLabel(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function EmploymentCard({ employments, busy, t, onDialog, onRetry }) {
  const rows = [...(employments?.list || [])].sort((left, right) => new Date(right.startDate).getTime() - new Date(left.startDate).getTime())
  return h(Card, { title: t('employmentRecords'), actions: [h(LinkButton, { key: 'add', disabled: busy, onClick: () => onDialog({ kind: 'employment' }) }, h(Glyph, { name: 'plus', size: 12 }), t('empCreate'))] },
  employments?.error ? h('div', { role: 'alert', className: 'sf-stack' },
    h('p', { className: 'sf-neg' }, '读取归属记录暂时不可用，请稍后重试。'),
    h(LinkButton, { onClick: onRetry }, '重试加载')) : null,
  h(Table, {
    columns: [
      { label: t('empUser'), key: 'systemUserId', stickyLeft: true },
      { label: t('empDept'), key: 'departmentName', sortValue: row => row.departmentName ?? row.departmentId, render: row => row.departmentName ?? row.departmentId },
      { label: t('empStart'), key: 'startDate', sortValue: row => new Date(row.startDate).getTime(), render: row => employmentDateLabel(row.startDate), num: true },
      { label: '结束日期', key: 'endDate', sortValue: row => row.endDate ? new Date(row.endDate).getTime() : Infinity, render: row => row.endDate ? employmentDateLabel(row.endDate) : '至今', num: true },
      { label: '来源', key: 'sourceRef', sortValue: employmentSourceLabel, render: employmentSourceLabel },
    ],
    rows, empty: employments?.error ? null : !employments ? t('loading') : '暂无归属记录', rowKey: 'id', tableId: 'finance-employments',
  }),
  employments?.total > rows.length ? h('p', { className: 'sf-note' }, `仅展示前 ${rows.length} 条记录，排序仅作用于已加载记录。`) : null)
}

function EmploymentDialog({ contacts, contactsLoading, contactsError, departments, busy, t, onClose, onRetry, act }) {
  const [systemUserId, setSystemUserId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  const locked = busy || saving
  const userOptions = [...new Map(contacts.filter(contact => contact.systemUserId).map(contact => [contact.systemUserId, contact.name || contact.systemUserId])).entries()]
  const canSubmit = !contactsLoading && !contactsError && Boolean(startDate) && userOptions.some(([id]) => id === systemUserId) && (departments || []).some(department => department.id === departmentId)
  const submit = async () => {
    if (!canSubmit || locked || submitting.current) return
    const start = new Date(`${startDate}T00:00:00`)
    if (!Number.isFinite(start.getTime())) return
    submitting.current = true
    setSaving(true)
    setError('')
    try {
      if (await act('/employment-records', { systemUserId, departmentId, startDate: start.toISOString(), sourceRef: 'manual' }, '归属已登记（部门变化时旧记录自动闭合）')) onClose()
      else setError('登记失败，请检查字段或稍后重试。已保留输入。')
    } catch { setError('登记失败，请检查字段或稍后重试。已保留输入。') }
    finally { submitting.current = false; setSaving(false) }
  }
  return h(Dialog, { title: t('empCreate'), onClose: () => { if (!locked) onClose() }, footer: [
    h(GhostButton, { key: 'cancel', disabled: locked, onClick: onClose }, t('cancel')),
    h(PrimaryButton, { key: 'ok', busy: locked, disabled: !canSubmit || locked, onClick: submit }, t('submit')),
  ] },
    error ? h('p', { role: 'alert', className: 'sf-neg' }, error) : null,
    contactsError ? h('div', { role: 'alert' }, h('p', { className: 'sf-neg' }, '读取人员目录暂时不可用，请稍后重试。'), h(LinkButton, { onClick: onRetry }, '重试加载')) : null,
    !contactsLoading && !contactsError && !userOptions.length ? h('p', { className: 'sf-note' }, '暂无已绑定人员，请先同步或绑定通讯录。') : null,
    !(departments || []).length ? h('p', { className: 'sf-note' }, '暂无可用部门，请先同步组织目录。') : null,
    h('fieldset', { className: 'sf-stack sf-fieldset sf-employment-form', disabled: locked },
      h(FormRow, { label: t('empUser') }, h(SearchSelect, { value: systemUserId, disabled: locked || contactsLoading || contactsError, onChange: value => { setSystemUserId(value); setDepartmentId(''); setStartDate('') }, options: userOptions, placeholder: contactsLoading ? '人员加载中…' : t('empUser'), 'aria-label': '选择人员' })),
      h(FormRow, { label: t('empDept') }, h(SearchSelect, { value: departmentId, disabled: locked, onChange: setDepartmentId, options: (departments || []).map(department => [department.id, department.name]), placeholder: t('empDept'), title: (departments || []).find(department => department.id === departmentId)?.name, 'aria-label': '归属部门' })),
      h(FormRow, { label: t('empStart') }, h(Field, { type: 'date', disabled: locked, value: startDate, onChange: setStartDate, 'aria-label': '起始日期' }))))
}

function MembersCard({ members, busy, t, act, onDialog, onRetry }) {
  const rows = members?.list || []
  return h(Card, { title: t('membersTitle') }, members?.forbidden ? h('div', { className: 'sf-note', role: 'status' }, '当前账号没有成员权限，请联系财务负责人。') : members?.error ? h(ListLoadError, { label: '成员列表', onRetry }) : null,
  h(Table, {
    columns: [
      { label: t('memberUser'), key: 'name', sortValue: row => row.name ?? row.userId, render: row => row.name ?? row.userId, stickyLeft: true },
      { label: t('memberDept'), key: 'departmentName', render: row => row.departmentName ?? '—' },
      {
        label: t('role'), key: 'role',
        sortValue: row => t(`roleName${row.role}`),
        render: row => h(Select, {
          value: row.role,
          disabled: busy,
          onChange: value => act('/members', { userId: row.userId, role: value, name: row.name ?? undefined, enabled: row.enabled }),
          options: FINANCE_ROLES.map(role => [role, t(`roleName${role}`)]),
        }),
      },
      { label: t('enabledCol'), key: 'enabled', render: row => h(Pill, { tone: row.enabled ? 'green' : 'muted' }, row.enabled ? '✓' : '—') },
      { label: t('actions'), key: 'actions', sortable: false, render: row => h(LinkButton, { disabled: busy, onClick: () => act(`/members/${row.id}/remove`, {}) }, t('removeMember')) },
    ],
    rows: members?.error || members?.forbidden ? [] : rows,
    empty: members?.error || members?.forbidden ? null : !members ? t('loading') : t('empty'), rowKey: 'id', tableId: 'finance-members',
  }))
}

// ---- 录入面板（4 类型；排款月份必填对齐后端校验） ----

function EntryPanel({ year, orgs, departments, t, act }) {
  const [kind, setKind] = useState('payment')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [history, setHistory] = useState({ paymentPlans: [], payees: [], costItems: [], items: [], payers: [], incomeTypes: [] })
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [historyError, setHistoryError] = useState(false)
  const orgOptions = (orgs || []).map(org => [org.id, org.name])
  const departmentOptions = (departments || []).map(department => [department.id, department.name])
  const years = yearOptions(year)
  const months = Array.from({ length: 12 }, (_, index) => [String(index + 1), `${index + 1}月`])

  useEffect(() => {
    let cancelled = false
    setHistoryLoaded(false)
    setHistoryError(false)
    Promise.all([
      api(`/payment-plans?year=${year}&limit=100`),
      api(`/revenue-plans?year=${year}&limit=100`),
    ]).then(([payments, revenues]) => {
      if (cancelled) return
      const paymentRows = payments?.data?.list || []
      const revenueRows = revenues?.data?.list || []
      const unique = values => [...new Set(values.filter(value => typeof value === 'string' && value.trim()))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
      setHistory({
        paymentPlans: paymentRows
          .filter(row => row.id)
          .map(row => [row.id, [row.description || row.planType || '付款计划', row.orgName, row.planMonth ? `${row.planMonth}月` : null, row.id.slice(0, 8)].filter(Boolean).join(' · ')]),
        payees: unique(paymentRows.map(row => row.payeeName)),
        costItems: unique(paymentRows.map(row => row.costItemName)),
        items: unique(revenueRows.map(row => row.itemName)),
        payers: unique(revenueRows.map(row => row.payerName)),
        incomeTypes: unique(revenueRows.map(row => row.incomeTypeName)),
      })
      setHistoryLoaded(true)
    }).catch(() => { if (!cancelled) setHistoryError(true) })
    return () => { cancelled = true }
  }, [year])

  const submit = async event => {
    event.preventDefault()
    if (busy) return
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const num = key => Number(form.get(key))
    const text = key => { const value = String(form.get(key) || '').trim(); return value || undefined }
    const textChoice = key => text(key + 'Choice')
    setBusy(true); setNotice(null)
    try {
      let path, payload
      if (kind === 'payment') {
        path = '/payment-plans'
        payload = { orgId: text('orgId'), planType: text('planType'), year: num('year'), description: text('description'), plannedAmount: num('plannedAmount') }
        const planMonth = text('planMonth')
        if (!planMonth) { setNotice(`${t('opFailed')}: ${t('planMonthRequired')}`); setBusy(false); return }
        payload.planMonth = num('planMonth')
        if (textChoice('payeeName')) payload.payeeName = textChoice('payeeName')
        if (textChoice('costItemName')) payload.costItemName = textChoice('costItemName')
      } else if (kind === 'revenue') {
        path = '/revenue-plans'
        payload = { orgId: text('orgId'), year: num('year'), itemName: textChoice('itemName'), plannedAmount: num('plannedAmount') }
        if (text('month')) payload.month = num('month')
        if (textChoice('payerName')) payload.payerName = textChoice('payerName')
        if (textChoice('incomeTypeName')) payload.incomeTypeName = textChoice('incomeTypeName')
      } else if (kind === 'budget') {
        path = '/budget-lines'
        payload = { orgId: text('orgId'), year: num('year'), expenseType: text('expenseType'), budgetAmount: num('budgetAmount') }
        if (text('month')) payload.month = num('month')
        if (text('departmentId')) payload.departmentId = text('departmentId')
        if (textChoice('costItemName')) payload.costItemName = textChoice('costItemName')
        if (text('note')) payload.note = text('note')
      } else {
        path = `/payment-plans/${text('planId')}/actuals`
        payload = { actualAmount: num('actualAmount') }
        if (text('actualPaidAt')) payload.actualPaidAt = new Date(`${text('actualPaidAt')}T00:00:00`).toISOString()
      }
      await post(path, payload)
      setNotice(t('submitted'))
      formElement.reset()
    } catch (error) { setNotice(`${t('opFailed')}: ${error.message}`) } finally { setBusy(false) }
  }

  return h('form', { className: 'sf-card', key: kind, onSubmit: submit },
    h('div', { className: 'sf-card-head' }, h('h2', null, t('entryTitle')), h('span', { className: 'sf-card-unit' }, t('unitYuan'))),
    h('div', { className: 'sf-card-body' }, h('div', { className: 'sf-stack' },
      h('p', { className: 'sf-note' }, t('entryHint')),
      h(PillTabs, { tabs: [['payment', 'entryPaymentPlan'], ['revenue', 'entryRevenuePlan'], ['budget', 'entryBudgetLine'], ['backfill', 'entryBackfill']], value: kind, onChange: setKind, t }),
      h('div', { className: 'sf-form' },
        kind !== 'backfill' ? [
          h(FormRow, { key: 'org', label: t('org') }, h(SearchSelect, { name: 'orgId', required: true, options: orgOptions, placeholder: t('org') })),
          h(FormRow, { key: 'year', label: t('year') }, h(Select, { name: 'year', required: true, options: years, placeholder: t('year') })),
        ] : [
          h(FormRow, { key: 'plan', label: t('selectPlan') }, h(SearchSelect, { name: 'planId', required: true, options: history.paymentPlans, placeholder: t('selectPlan') })),
          historyError ? h('p', { key: 'plan-error', className: 'sf-note sf-neg' }, `${t('opFailed')}: ${t('selectPlan')}`) : null,
          historyLoaded && !history.paymentPlans.length ? h('p', { key: 'plan-empty', className: 'sf-note' }, `${t('empty')} · ${t('entryPaymentPlan')}`) : null,
        ],
        kind === 'payment' ? [
          h(FormRow, { key: 'pt', label: t('planType') }, h(Select, { name: 'planType', required: true, options: PLAN_TYPES.map(([id, label]) => [id, t(label)]) })),
          h(FormRow, { key: 'pd', label: t('description') }, h(Field, { name: 'description', required: true, maxLength: 500 })),
          h(FormRow, { key: 'pm', label: `${t('planMonth')} *` }, h(Select, { name: 'planMonth', required: true, options: months, placeholder: t('planMonth') })),
          h(FormRow, { key: 'py', label: t('payee') }, h(CustomizableTextSelect, { name: 'payeeName', options: history.payees, placeholder: t('payee') })),
          h(FormRow, { key: 'pc', label: t('costItem') }, h(CustomizableTextSelect, { name: 'costItemName', options: history.costItems, placeholder: t('costItem') })),
          h(FormRow, { key: 'pa', label: `${t('planned')}（${t('unitYuan')}）` }, h(Field, { name: 'plannedAmount', type: 'number', min: 0.01, step: '0.01', required: true })),
        ] : kind === 'revenue' ? [
          h(FormRow, { key: 'ri', label: t('itemName') }, h(CustomizableTextSelect, { name: 'itemName', options: history.items, placeholder: t('itemName'), required: true })),
          h(FormRow, { key: 'rm', label: t('month') }, h(Select, { name: 'month', options: months, placeholder: t('month') })),
          h(FormRow, { key: 'rp', label: t('payer') }, h(CustomizableTextSelect, { name: 'payerName', options: history.payers, placeholder: t('payer') })),
          h(FormRow, { key: 'rt', label: t('incomeType') }, h(CustomizableTextSelect, { name: 'incomeTypeName', options: history.incomeTypes, placeholder: t('incomeType') })),
          h(FormRow, { key: 'ra', label: `${t('planned')}（${t('unitYuan')}）` }, h(Field, { name: 'plannedAmount', type: 'number', min: 0.01, step: '0.01', required: true })),
        ] : kind === 'budget' ? [
          h(FormRow, { key: 'be', label: t('expenseType') }, h(Select, { name: 'expenseType', required: true, options: EXPENSE_TYPES.map(([id, label]) => [id, t(label)]) })),
          h(FormRow, { key: 'bm', label: t('month') }, h(Select, { name: 'month', options: months, placeholder: t('month') })),
          h(FormRow, { key: 'bd', label: t('department') }, h(SearchSelect, { name: 'departmentId', options: departmentOptions, placeholder: t('department') })),
          h(FormRow, { key: 'bc', label: t('costItem') }, h(CustomizableTextSelect, { name: 'costItemName', options: history.costItems, placeholder: t('costItem') })),
          h(FormRow, { key: 'ba', label: `${t('kpiBudget')}（${t('unitYuan')}）` }, h(Field, { name: 'budgetAmount', type: 'number', min: 0.01, step: '0.01', required: true })),
          h(FormRow, { key: 'bn', label: t('note') }, h(Field, { name: 'note', maxLength: 500 })),
        ] : [
          h(FormRow, { key: 'aa', label: t('actualAmountL') }, h(Field, { name: 'actualAmount', type: 'number', min: 0, step: '0.01', required: true })),
          h(FormRow, { key: 'ad', label: t('actualDateL') }, h(Field, { name: 'actualPaidAt', type: 'date' })),
        ],
        h('div', { className: 'sf-form-actions' },
          h(PrimaryButton, { type: 'submit', busy }, busy ? t('running') : t('submit')),
          notice ? h(Notice, null, notice) : null)))))
}
