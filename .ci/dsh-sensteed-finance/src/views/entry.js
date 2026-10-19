// 片段 5/7 视图：录入（填报控制台：任务管理/我的填报 + 通讯录 + 归属记录 + 成员角色 + 录入面板 4 类型）

function EntryView({ ctx, t, directoryOnly, directorySection }) {
  const { year, orgs, departments, revision } = ctx
  const [section, setSection] = useState(directoryOnly ? 'org' : 'filing')
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
    if (!directoryOnly) api('/filing-tasks').then(value => { if (!cancelled) setTasks(value.data ?? { list: [] }) }).catch(() => { if (!cancelled) setTasks({ list: [], error: true }) })
    if (!directoryOnly) api('/filing-assignments').then(value => { if (!cancelled) setAssignments(value.data ?? { list: [] }) }).catch(() => { if (!cancelled) setAssignments({ list: [], error: true }) })
    setEmployments(null)
    if (!directoryOnly || !directorySection || directorySection === 'employment') api('/employment-records?limit=50').then(value => { if (!cancelled) setEmployments(value.data ?? { list: [] }) }).catch(() => { if (!cancelled) setEmployments({ list: [], error: true }) })
    if (!directoryOnly) api('/members').then(value => { if (!cancelled) setMembers(value.data ?? { list: [] }) }).catch(error => { if (!cancelled) setMembers(error?.status === 403 ? { list: [], forbidden: true } : { list: [], error: true }) })
    if (!directoryOnly) api('/quality').then(value => { if (!cancelled) setQuality(value) }).catch(() => {})
    return () => { cancelled = true }
  }, [revision, reloadTick, directoryOnly, directorySection])
  useEffect(() => {
    if (directoryOnly && directorySection && directorySection !== 'directory') return
    let cancelled = false
    setContacts(null)
    api(`/contacts?limit=100&${onlyUnmapped ? 'onlyUnmapped=1&' : ''}${keyword.trim() ? `keyword=${encodeURIComponent(keyword.trim())}` : ''}`)
      .then(value => { if (!cancelled) setContacts(value.data ?? { list: [] }) })
      .catch(() => { if (!cancelled) setContacts({ list: [], error: true }) })
    return () => { cancelled = true }
  }, [revision, reloadTick, keyword, onlyUnmapped, directoryOnly, directorySection])
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
      !directoryOnly ? h(PillTabs, { tabs: [['filing', 'filingTasks'], ['my', 'myFiling'], ['org', 'directory']], value: section, onChange: setSection, t }) : null,
      notice ? h(Notice, null, notice) : null),

    // 录入前检查（对齐前端录入前检查卡：未分配>0 时告警）
    quality ? h('div', { className: `sf-banner ${unassignedCount > 0 ? 'sf-banner-amber' : 'sf-banner-green'}` },
      h(Glyph, { name: unassignedCount > 0 ? 'warning' : 'check', size: 14 }),
      unassignedCount > 0 ? t('preCheckBad').replace('{n}', String(unassignedCount)) : t('preCheckOk')) : null,

    section === 'filing' ? h(FilingSection, { tasks, busy, t, act, onDialog: setDialog, onRetry: retryLists }) : null,
    section === 'my' ? h(MyFilingSection, { assignments, busy, t, act, onDialog: setDialog, onRetry: retryLists, onReopen: assignment => { setDialog({ kind: 'reason', title: t('reopenFiling'), required: true, run: reason => act(`/filing-assignments/${assignment.id}/reopen`, { reason }) }) } }) : null,
    section === 'org' ? h('div', { className: 'sf-stack' },
      !directorySection || directorySection === 'directory' ? h(DirectoryCard, { contacts, keyword, setKeyword, onlyUnmapped, setOnlyUnmapped, busy, t, act, onDialog: setDialog, onRetry: () => setReloadTick(value => value + 1) }) : null,
      !directorySection || directorySection === 'employment' ? h(EmploymentCard, { employments, busy, t, onDialog: setDialog, onRetry: () => setReloadTick(value => value + 1) }) : null,
      !directorySection || directorySection === 'members' ? h(FinanceMembersView, { ctx, t }) : null) : null,

    // 录入面板常开内嵌（对齐前端 FinanceEntryPanel）
    !directoryOnly && ctx.financeWriter ? h(EntryPanel, { key: year, year, orgs, departments, t, onSaved: () => window.dispatchEvent(new Event('sf:refresh')) }) : !directoryOnly ? h('p', { className: 'sf-note' }, t('entryFinanceOnly')) : null,

    dialog?.kind === 'createTask' ? h(CreateTaskDialog, { year, orgs, departments, members, busy, t, onClose: () => setDialog(null), act }) : null,
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

function CreateTaskDialog({ year, orgs, departments, members, busy, t, onClose, act }) {
  const [title, setTitle] = useState('')
  const [selectedOrgId, setOrgId] = useState('')
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
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const submitLock = useRef(false)
  const locked = busy || submitting
  const close = () => { if (!submitLock.current && !busy) onClose() }
  const orgId = selectedOrgId || (orgs?.length === 1 ? orgs[0].id : '')
  const personOptions = [...new Set((members?.list || []).filter(member => member.enabled !== false).map(member => member.name?.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN')).map(name => [name, name])
  const validDepartmentIds = selectedDepartmentIds.filter(id => (departments || []).some(department => department.id === id))
  // 与网页一致：活动必须归属一个主体，逐部门写入 departments[].orgId。
  const orgOptions = (orgs || []).map(org => [org.id, org.name])
  const validOrg = (orgs || []).some(org => org.id === orgId)
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
      if (!cancelled) setVersions((value.data?.list || []).filter(version => version.status === 'DRAFT'))
    }).catch(() => { if (!cancelled) { setVersions([]); setVersionError(true) } })
    return () => { cancelled = true }
  }, [year, versionRetry])
  const months = Array.from({ length: 12 }, (_, index) => [String(index + 1), `${index + 1}月`])
  const canSubmit = !locked && title.trim() && validOrg && dueAt && Number.isFinite(new Date(dueAt).getTime()) && validDepartmentIds.length &&
    (type !== 'BUDGET' || (!versionError && versions?.some(version => version.id === versionId))) &&
    (type !== 'PAYMENT_PLAN' || (Number(month) >= 1 && Number(month) <= 12))
  const submit = async () => {
    if (!canSubmit || submitLock.current) return
    submitLock.current = true; setSubmitting(true); setSubmitError(null)
    try {
      const created = await act('/filing-tasks', {
        title: title.trim(), type, year: Number(year), dueAt: new Date(dueAt).toISOString(),
        ...(type === 'PAYMENT_PLAN' ? { month: Number(month) } : { versionId }),
        departments: validDepartmentIds.map(departmentId => ({ departmentId, orgId })),
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        ...(ownerName.trim() ? { ownerName: ownerName.trim() } : {}),
        ...(reviewerName.trim() ? { reviewerName: reviewerName.trim() } : {}),
        allowModify, freezeCurrentMonth, startAsDraft,
      })
      if (created) onClose()
      else setSubmitError('发起失败，请检查字段与权限后重试；本次输入已保留。')
    } catch {
      setSubmitError('发起失败，请检查字段与权限后重试；本次输入已保留。')
    } finally { submitLock.current = false; setSubmitting(false) }
  }
  return h(Dialog, { title: t('createTask'), onClose: close, footer: [
    h(GhostButton, { key: 'cancel', disabled: locked, onClick: close }, t('cancel')),
    h(PrimaryButton, { key: 'ok', disabled: !canSubmit, busy: locked, onClick: submit }, t(startAsDraft ? 'taskStartDraft' : 'taskPublish')),
  ] },
    submitError ? h('p', { role: 'alert', className: 'sf-neg' }, submitError) : null,
    h('fieldset', { className: 'sf-stack sf-fieldset', disabled: locked, 'aria-busy': locked },
      h(FormRow, { label: t('taskTitle') }, h(Field, { value: title, onChange: setTitle, maxLength: 150 })),
      h(FormRow, { label: t('taskType') }, h(Select, { value: type, onChange: setType, options: [['PAYMENT_PLAN', t('typePlan')], ['BUDGET', t('typeBudget')]] })),
      type === 'PAYMENT_PLAN'
        ? h(FormRow, { label: t('taskMonth') }, h(Select, { value: month, onChange: setMonth, options: months, placeholder: t('taskMonth') }))
        : h(FormRow, { label: t('version') }, h(SearchSelect, { value: versionId, onChange: setVersionId, options: (versions || []).map(version => [version.id, budgetVersionLabel(version)]), placeholder: t('version'), disabled: locked || !versions?.length })),
      type === 'BUDGET' && versionError ? h('div', { className: 'sf-row', role: 'alert' }, '预算版本加载失败', h(LinkButton, { onClick: () => setVersionRetry(value => value + 1) }, '重新加载版本')) : null,
      type === 'BUDGET' && !versionError && versions && !versions.length ? h('p', { className: 'sf-note' }, `${t('empty')} · ${t('version')}`) : null,
      h(FormRow, { label: `${t('taskOrg')} *` },
        h(SearchSelect, { buttonTrigger: true, value: orgId, onChange: setOrgId, options: orgOptions, placeholder: t('taskOrg'), disabled: locked || !orgOptions.length })),
      !validOrg ? h('p', { role: 'alert', className: 'sf-note' }, t('taskOrgMissing')) : null,
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
          disabled: locked || !departments?.length,
        }),
        !departments?.length ? h('p', { className: 'sf-note' }, `${t('empty')} · ${t('department')}`) : null),
      h(FormRow, { label: t('taskDue') }, h(Field, { type: 'datetime-local', value: dueAt, onChange: setDueAt })),
      h(FormRow, { label: t('taskInstructions') }, h(Field, { value: instructions, onChange: setInstructions, maxLength: 500 })),
      h(FormRow, { label: t('taskOwner') }, h(SearchSelect, { value: ownerName, onChange: setOwnerName, options: personOptions, allowCustom: true, placeholder: t('taskOwner'), maxLength: 100, disabled: locked })),
      h(FormRow, { label: t('taskReviewer') }, h(SearchSelect, { value: reviewerName, onChange: setReviewerName, options: personOptions, allowCustom: true, placeholder: t('taskReviewer'), maxLength: 100, disabled: locked })),
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
function AssignmentDialog({ assignment, canEdit = true, canVerify = true, busy, t, onClose, act }) {
  const task = assignment.task
  const editable = canEdit && task?.status === 'OPEN' && (!task.dueAt || new Date(task.dueAt).getTime() >= Date.now()) &&
    (['PENDING', 'DRAFT', 'REJECTED'].includes(assignment.status) || (assignment.status === 'SUBMITTED' && task.allowModify === true))
  const emptyRow = () => ({ costItemId: '', month: String(task?.month ?? ''), description: '', plannedAmount: '' })
  const [rows, setRows] = useState(() => assignment.rows?.length ? assignment.rows.map(row => ({ ...row })) : [emptyRow()])
  const [costItems, setCostItems] = useState(null)
  const [costError, setCostError] = useState(false)
  const [reload, setReload] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [excelBusy, setExcelBusy] = useState(false)
  const writeLock = useRef(false)
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
    if (!editable || saving || busy || excelBusy || writeLock.current) return
    const filled = rows.filter(row => String(row.plannedAmount ?? '').trim())
    if (filled.some(row => !Number.isFinite(Number(row.plannedAmount)) || Number(row.plannedAmount) <= 0)) {
      setError('请填写大于 0 的金额'); return
    }
    if (thenSubmit && (!filled.length || filled.some(row => !row.costItemId || !row.month))) {
      setError('请至少填写一行，并补全费用类别、月份和金额'); return
    }
    writeLock.current = true
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
    } finally { writeLock.current = false; setSaving(false) }
  }
  return h(Dialog, { title: t('assignmentTitle') + ' · ' + (assignment.departmentName ?? ''), width: 'lg', dismissDisabled: saving || excelBusy, onClose: saving || excelBusy ? undefined : onClose, footer: [
    editable ? h(GhostButton, { key: 'save', disabled: busy || saving || excelBusy, onClick: () => persist(false) }, t('saveDraft')) : null,
    editable ? h(PrimaryButton, { key: 'submit', busy: busy || saving || excelBusy, onClick: () => persist(true) }, t('submitFiling')) : null,
    canVerify && assignment.status === 'SUBMITTED' ? h(PrimaryButton, {
      key: 'commit', busy: busy || saving || excelBusy,
      onClick: async () => { if (await act('/filing-assignments/' + assignment.id + '/commit', {})) onClose() },
    }, t('commitFiling')) : null,
    h(GhostButton, { key: 'cancel', disabled: saving || excelBusy, onClick: onClose }, t('close')),
  ] },
    h('div', { className: 'sf-stack' },
      !editable ? h('p', { className: 'sf-note' }, '当前填报只读；仅开放且未过期的活动可填写，已提交记录须在允许修改的窗口内重提。') : null,
      editable ? h(FilingExcelDraft, { assignmentId: assignment.id, disabled: saving || busy, onBusyChange: setExcelBusy, onApply: imported => setRows(imported.map(row => ({ ...row, month: row.month == null ? '' : String(row.month), plannedAmount: String(row.plannedAmount) }))) }) : null,
      costError ? h('div', { role: 'alert' }, '费用类别加载失败', h(LinkButton, { onClick: () => setReload(value => value + 1) }, '重试')) : null,
      costItems && !costItems.length && !costError ? h('p', { className: 'sf-note' }, '暂无可用费用类别，请联系财务维护。') : null,
      error ? h('p', { role: 'alert', className: 'sf-neg' }, error) : null,
      h('div', { className: 'sf-row-between' },
        h('strong', null, t('rowsEditor')),
        editable ? h(LinkButton, { disabled: busy || saving || excelBusy, onClick: () => setRows(current => [...current, emptyRow()]) }, h(Glyph, { name: 'plus', size: 12 }), t('addRow')) : null),
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
          editable ? h(LinkButton, { disabled: busy || saving || excelBusy, onClick: () => setRows(current => current.filter((_, rowIndex) => rowIndex !== index)) }, h(Glyph, { name: 'trash', size: 13 })) : null))),
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
          { label: t('mobile'), key: 'mobile' },
          { label: t('email'), key: 'email' },
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

function EmploymentCard({ employments, busy, t, onDialog, onRetry, page = 1, onPage, userName }) {
  const rows = [...(employments?.list || [])].sort((left, right) => new Date(right.startDate).getTime() - new Date(left.startDate).getTime())
  return h(Card, { title: t('employmentRecords'), actions: [h(LinkButton, { key: 'add', disabled: busy, onClick: () => onDialog({ kind: 'employment' }) }, h(Glyph, { name: 'plus', size: 12 }), t('empCreate'))] },
  employments?.error ? h('div', { role: 'alert', className: 'sf-stack' },
    h('p', { className: 'sf-neg' }, '读取归属记录暂时不可用，请稍后重试。'),
    h(LinkButton, { onClick: onRetry }, '重试加载')) : null,
  h(Table, {
    columns: [
      { label: t('empUser'), key: 'systemUserId', stickyLeft: true, render: row => userName || row.systemUserId },
      { label: t('empDept'), key: 'departmentName', sortValue: row => row.departmentName ?? row.departmentId, render: row => row.departmentName ?? row.departmentId },
      { label: t('empStart'), key: 'startDate', sortValue: row => new Date(row.startDate).getTime(), render: row => employmentDateLabel(row.startDate), num: true },
      { label: '结束日期', key: 'endDate', sortValue: row => row.endDate ? new Date(row.endDate).getTime() : Infinity, render: row => row.endDate ? employmentDateLabel(row.endDate) : '至今', num: true },
      { label: '来源', key: 'sourceRef', sortValue: employmentSourceLabel, render: employmentSourceLabel },
    ],
    rows, empty: employments?.error ? null : !employments ? t('loading') : '暂无归属记录', rowKey: 'id', tableId: 'finance-employments',
  }),
  onPage ? h(Pager, { page, total: employments?.total, limit: 20, onPage }) : employments?.total > rows.length ? h('p', { className: 'sf-note' }, `仅展示前 ${rows.length} 条记录，排序仅作用于已加载记录。`) : null)
}

function financeEmploymentStartISOString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00`)
  const [year, month, day] = value.split('-').map(Number)
  if (!Number.isFinite(date.getTime()) || date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) return null
  return date.toISOString()
}
function EmploymentDialog({ contacts, contactsLoading, contactsError, departments, busy, t, onClose, onRetry, act, initialUserId = '' }) {
  const [systemUserId, setSystemUserId] = useState(initialUserId)
  const [departmentId, setDepartmentId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [attempted, setAttempted] = useState(false)
  const submitting = useRef(false), formRef = useRef(null), prefix = useId()
  const locked = busy || saving
  const exit = useFinanceFormExit({ departmentId: '', startDate: '' }, { departmentId, startDate }, locked, onClose)
  const userOptions = [...new Map(contacts.filter(contact => contact.systemUserId).map(contact => [contact.systemUserId, contact.name || contact.systemUserId])).entries()]
  const fields = [
    { key: 'systemUserId', label: '选择人员', required: true, searchable: true, options: userOptions, disabled: Boolean(initialUserId) || contactsLoading || contactsError },
    { key: 'departmentId', label: '归属部门', required: true, searchable: true, options: (departments || []).map(department => [department.id, department.name]) },
    { key: 'startDate', label: '起始日期', required: true, type: 'date' },
  ]
  const errors = financeFormErrors(fields, { systemUserId, departmentId, startDate })
  if (!financeEmploymentStartISOString(startDate)) errors.startDate = '请输入有效的起始日期'
  if (!userOptions.some(([id]) => id === systemUserId)) errors.systemUserId = '请选择已绑定的人员'
  if (!(departments || []).some(department => department.id === departmentId)) errors.departmentId = '请选择可用的归属部门'
  const canSubmit = !contactsLoading && !contactsError && userOptions.length && (departments || []).length
  const change = (key, value) => {
    setError('')
    if (key === 'systemUserId') {
      if (value === systemUserId || initialUserId) return
      exit.leave(() => { setSystemUserId(value); setDepartmentId(''); setStartDate(''); setAttempted(false) })
    } else if (key === 'departmentId') setDepartmentId(value)
    else setStartDate(value)
  }
  const submit = async event => {
    event?.preventDefault()
    if (!canSubmit || locked || submitting.current) return
    setAttempted(true); setError('')
    if (Object.keys(errors).length) { financeFocusFormError(formRef.current); return }
    submitting.current = true
    setSaving(true)
    try {
      if (await act('/employment-records', { systemUserId, departmentId, startDate: financeEmploymentStartISOString(startDate), sourceRef: 'manual' }, '归属已登记（部门变化时旧记录自动闭合）')) onClose()
      else setError('登记失败，请检查字段或稍后重试。已保留输入。')
    } catch { setError('登记失败，请检查字段或稍后重试。已保留输入。') }
    finally { submitting.current = false; setSaving(false) }
  }
  const rows = financeFormFields(fields, { systemUserId, departmentId, startDate }, change, attempted ? errors : {}, locked, prefix)
  return h(Dialog, { title: t('empCreate'), onClose: exit.close, dismissDisabled: locked, footer: [
    h(GhostButton, { key: 'cancel', disabled: locked, onClick: exit.close }, t('cancel')),
    h(PrimaryButton, { key: 'ok', busy: locked, disabled: !canSubmit || locked, onClick: submit }, locked ? '登记中…' : '登记'),
  ] },
    contactsError ? h('div', { role: 'alert' }, h('p', { className: 'sf-neg' }, '读取人员目录暂时不可用，请稍后重试。'), h(LinkButton, { onClick: onRetry }, '重试加载')) : null,
    !contactsLoading && !contactsError && !userOptions.length ? h('p', { className: 'sf-note' }, '暂无已绑定人员，请先同步或绑定通讯录。') : null,
    !(departments || []).length ? h('p', { className: 'sf-note' }, '暂无可用部门，请先同步组织目录。') : null,
    h('form', { ref: formRef, noValidate: true, onSubmit: submit, className: 'sf-stack' },
      h('fieldset', { className: 'sf-stack sf-fieldset sf-employment-form', disabled: locked }, ...rows),
      h('p', { className: 'sf-note', 'aria-label': '登记摘要' }, `${userOptions.find(([id]) => id === systemUserId)?.[1] || '待选择人员'} → ${(departments || []).find(department => department.id === departmentId)?.name || '待选择部门'}；${startDate || '待填写日期'} 当地时间 00:00 生效。部门变化时旧记录自动闭合。`),
      attempted && Object.keys(errors).length ? h('p', { role: 'alert', className: 'sf-neg' }, '请检查输入，已定位到首个错误。') : null,
      error ? h('p', { role: 'alert', className: 'sf-neg' }, error) : null,
      exit.prompt))
}


function CostItemCreator({ t, onCreated, onCancel, onBusyChange, submitLabel = '新增并选用' }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [failure, setFailure] = useState('')
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const valid = /^[A-Za-z0-9_-]{1,50}$/.test(code.trim()) && name.trim().length >= 1 && name.trim().length <= 100
  const save = async () => {
    if (!valid || inFlight.current) return
    inFlight.current = true
    onBusyChange?.(true)
    setSaving(true); setFailure('')
    try {
      const result = await financeRest('/finance/cost-items', 'POST', { code: code.trim(), name: name.trim() })
      const item = result?.data
      if (!item?.id) throw new Error('费用类别创建结果无效，请重试')
      onCreated(item)
    } catch (error) {
      setFailure(error.message || '新增费用类别失败，请检查编号和名称后重试')
    } finally { inFlight.current = false; setSaving(false); onBusyChange?.(false) }
  }
  return h('div', { className: 'sf-stack sf-cost-item-creator', role: 'group', 'aria-label': '新增费用类别', 'aria-busy': saving, onKeyDown: event => {
    if (event.key === 'Enter' && event.target?.tagName === 'INPUT') {
      event.preventDefault()
      if (!event.nativeEvent?.isComposing && !event.isComposing) void save()
    }
  } },
    h(FormRow, { label: '费用类别编号' }, h(Field, { value: code, onChange: setCode, maxLength: 50, placeholder: '如 TRAVEL', disabled: saving })),
    h(FormRow, { label: '费用类别名称' }, h(Field, { value: name, onChange: setName, maxLength: 100, placeholder: '如 差旅费', disabled: saving })),
    h('p', { className: 'sf-note' }, '编号使用字母、数字、下划线或连字符；新增后会自动选中。'),
    failure ? h('p', { role: 'alert', className: 'sf-neg' }, failure) : null,
    h('div', { className: 'sf-row' },
      h(PrimaryButton, { type: 'button', busy: saving, disabled: !valid, onClick: save }, saving ? '正在新增…' : submitLabel),
      h(GhostButton, { disabled: saving, onClick: onCancel }, t('cancel'))))
}

function financePlanOptionLabel(plan, kind) {
  const title = (kind === 'payment' ? plan.description : plan.itemName)?.trim()
  const month = kind === 'payment' ? plan.planMonth : plan.month
  const period = `${plan.year ? `${plan.year}年` : ''}${month ? `${month}月` : kind === 'payment' ? '（月份未指定）' : ' 年度（不分月）'}`.trim()
  const amount = plan.plannedAmount !== null && plan.plannedAmount !== undefined && Number.isFinite(plan.plannedAmount)
    ? `计划 ¥${plan.plannedAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '计划金额未提供'
  return [title || (kind === 'payment' ? '付款计划' : '收入计划'), plan.orgName?.trim() || '未分配主体', period, amount, `#${plan.id.slice(0, 8)}`].join(' · ')
}

const FINANCE_ENTRY_TEXT_LIMITS = { payment: { description: 500, payeeName: 200, costItemName: 100 }, revenue: { itemName: 200, incomeTypeName: 100, payerName: 200 } }

function EntryPanel({ year, orgId, orgs, departments, role, t, onSaved, onYearChange, onNavigate, onLeaveGuardChange }) {
  const [kind, setKind] = useState('payment')
  const dirtyRef = useRef(false)
  const entryRootRef = useRef(null)
  const entryMountedRef = useRef(false)
  const [pendingChange, setPendingChange] = useState(null)
  const [entryOrg, setEntryOrg] = useState(() => orgs?.find(org => org.id === orgId && org.type !== 'GROUP')?.id || orgs?.find(org => org.type === 'COMPANY')?.id || orgs?.find(org => org.type !== 'GROUP')?.id || '')
  const [entryYear, setEntryYear] = useState(String(year))
  const [backfillKind, setBackfillKind] = useState('payment')
  const [backfillOrg, setBackfillOrg] = useState(orgId || '')
  const [selectedPlan, setSelectedPlan] = useState(null)
  const [backfillAmount, setBackfillAmount] = useState('')
  const [backfillDate, setBackfillDate] = useState('')
  const [planKeyword, setPlanKeyword] = useState('')
  const [planSearch, setPlanSearch] = useState({ keyword: '', page: 1 })
  const [planResult, setPlanResult] = useState({ path: null, data: null, error: false })
  const [costItems, setCostItems] = useState(null)
  const [costError, setCostError] = useState(false)
  const [retry, setRetry] = useState(0)
  const savingRef = useRef(false)
  useFinanceNavigationEntry(() => dirtyRef.current, () => savingRef.current, () => { dirtyRef.current = false })
  const [formRevision, setFormRevision] = useState(0)
  useEffect(() => {
    if (entryMountedRef.current) requestAnimationFrame(() => entryRootRef.current?.querySelector?.('[role="tab"][aria-selected="true"]')?.focus?.())
    entryMountedRef.current = true
  }, [kind, formRevision])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [history, setHistory] = useState({ payees: [], items: [], payers: [], incomeTypes: [] })
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [historyError, setHistoryError] = useState({})
  const orgOptions = (orgs || []).filter(org => org.type !== 'GROUP').map(org => [org.id, org.name])
  const departmentOptions = (departments || []).map(department => [department.id, department.name])
  const years = yearOptions(year)
  const requestChange = useCallback(action => {
    if (savingRef.current) return
    if (dirtyRef.current) setPendingChange(() => action)
    else action()
  }, [])
  useEffect(() => { onLeaveGuardChange?.(requestChange); return () => onLeaveGuardChange?.(null) }, [onLeaveGuardChange, requestChange])
  useEffect(() => {
    if (!orgOptions.some(([id]) => id === entryOrg)) setEntryOrg(orgs?.find(org => org.type === 'COMPANY')?.id || orgOptions[0]?.[0] || '')
  }, [orgs, entryOrg])
  const markDirty = () => { dirtyRef.current = true; setNotice(null) }
  const changeKind = value => { if (value !== kind) requestChange(() => { setKind(value); resetBackfill(); setNotice(null) }) }
  const changeEntryYear = value => {
    if (value !== entryYear) requestChange(() => { setEntryYear(value); resetBackfill(); setFormRevision(current => current + 1); setNotice(null); onYearChange?.(value) })
  }
  const resetBackfill = () => { setSelectedPlan(null); setBackfillAmount(''); setBackfillDate(''); setPlanKeyword(''); setPlanSearch({ keyword: '', page: 1 }) }
  const changeBackfillScope = action => requestChange(() => { resetBackfill(); action(); setFormRevision(current => current + 1); setNotice(null) })
  const historyOrg = entryOrg
  const discardDialog = pendingChange ? h(Dialog, {
    title: t('entryDiscardTitle'), onClose: () => setPendingChange(null),
    footer: h('div', { className: 'sf-toolbar' },
      h(GhostButton, { onClick: () => setPendingChange(null) }, t('entryKeepEditing')),
      h(PrimaryButton, { onClick: () => { const action = pendingChange; dirtyRef.current = false; setPendingChange(null); action() } }, t('entryDiscardContinue'))),
  }, h('p', null, t('entryDiscardDescription'))) : null
  const months = Array.from({ length: 12 }, (_, index) => [String(index + 1), `${index + 1}月`])

  useEffect(() => {
    if (kind !== 'payment' && kind !== 'revenue') return
    let cancelled = false
    setHistoryLoaded(false)
    setHistoryError({})
    Promise.allSettled([
      api(`/payment-plans?${new URLSearchParams({ year: entryYear, ...(historyOrg ? { orgId: historyOrg } : {}), limit: '200' })}`),
      api(`/revenue-plans?${new URLSearchParams({ year: entryYear, ...(historyOrg ? { orgId: historyOrg } : {}), limit: '200' })}`),
    ]).then(([payments, revenues]) => {
      if (cancelled) return
      const paymentRows = payments.status === 'fulfilled' ? payments.value?.data?.list || [] : []
      const revenueRows = revenues.status === 'fulfilled' ? revenues.value?.data?.list || [] : []
      setHistoryError({ payment: payments.status === 'rejected', revenue: revenues.status === 'rejected' })
      const unique = values => [...new Set(values.filter(value => typeof value === 'string' && value.trim()))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
      setHistory({
        year: entryYear, orgId: historyOrg,
        payees: unique(paymentRows.map(row => row.payeeName)),
        costItems: unique(paymentRows.map(row => row.costItemName)),
        items: unique(revenueRows.map(row => row.itemName)),
        payers: unique(revenueRows.map(row => row.payerName)),
        incomeTypes: unique(revenueRows.map(row => row.incomeTypeName)),
      })
      setHistoryLoaded(true)
    })
    return () => { cancelled = true }
  }, [entryYear, historyOrg, retry, kind])

  useEffect(() => {
    if (kind !== 'payment') return
    let cancelled = false
    setCostItems(null); setCostError(false)
    api('/cost-items').then(value => {
      if (!cancelled) setCostItems((value.data?.list || []).filter(item => item.active))
    }).catch(() => { if (!cancelled) setCostError(true) })
    return () => { cancelled = true }
  }, [kind, retry])

  const suggestions = historyLoaded && history.year === entryYear && history.orgId === historyOrg ? history : { payees: [], items: [], payers: [], incomeTypes: [] }
  const planPath = kind === 'backfill' ? `/${backfillKind === 'payment' ? 'payment-plans' : 'revenue-plans'}?${new URLSearchParams({ year: entryYear, ...(backfillOrg ? { orgId: backfillOrg } : {}), ...(planSearch.keyword ? { keyword: planSearch.keyword } : {}), page: String(planSearch.page), limit: '20' })}` : null
  useEffect(() => {
    if (!planPath) return
    let cancelled = false
    setPlanResult({ path: planPath, data: null, error: false })
    api(planPath).then(value => { if (!cancelled) setPlanResult({ path: planPath, data: value.data, error: false }) })
      .catch(() => { if (!cancelled) setPlanResult({ path: planPath, data: null, error: true }) })
    return () => { cancelled = true }
  }, [planPath, retry])
  const currentPlans = planResult.path === planPath ? planResult : { data: null, error: false }
  const planLoading = !currentPlans.data && !currentPlans.error
  const pendingPlanSearch = planKeyword.trim() !== planSearch.keyword
  const backfillPlans = !pendingPlanSearch && !planLoading && !currentPlans.error ? (currentPlans.data?.list || []).map(row => [row.id, financePlanOptionLabel(row, backfillKind)]) : []
  const planTotal = currentPlans.data?.total ?? 0
  const planPages = Math.max(1, Math.ceil(planTotal / 20))
  const backfillReady = Boolean(selectedPlan)
  const chooseBackfillPlan = id => {
    if (id === selectedPlan?.id) return
    const option = backfillPlans.find(([value]) => value === id)
    if (id && !option) return
    const change = () => { setSelectedPlan(option ? { id, label: option[1] } : null); setBackfillAmount(''); setBackfillDate(''); setFormRevision(value => value + 1); dirtyRef.current = Boolean(option); setNotice(null) }
    if (backfillAmount || backfillDate) requestChange(change)
    else change()
  }
  const runPlanSearch = () => {
    if (pendingPlanSearch || planSearch.page !== 1) setPlanSearch({ keyword: planKeyword.trim(), page: 1 })
    else setRetry(value => value + 1)
  }
  const planSearchContent = h('div', { className: 'sf-stack sf-plan-search-status' },
    h('p', { className: 'sf-note' }, (backfillKind === 'payment' ? '按付款描述、收款方、PR 编号或部门搜索' : '按收入项目、付款主体或收入类型搜索') + '；范围为当前年度和主体。'),
    pendingPlanSearch ? h('p', { role: 'status' }, '输入关键词后点击搜索或按 Enter。')
      : currentPlans.error ? h('div', { role: 'alert' }, '计划加载失败。', h(LinkButton, { onClick: () => setRetry(value => value + 1) }, '重试'))
        : planLoading ? h('p', { role: 'status' }, '正在读取计划…')
          : h('div', { className: 'sf-stack' },
            !backfillPlans.length ? h('p', { role: 'status' }, planSearch.keyword ? '未找到匹配计划，可更换关键词或清空搜索。' : '当前范围暂无可回填计划。') : null,
            h('div', { className: 'sf-row-between', 'aria-label': '计划分页' },
              h('span', { role: 'status' }, `第 ${planSearch.page} / ${planPages} 页 · 共 ${planTotal} 条`),
              h('div', { className: 'sf-row' },
                h(GhostButton, { disabled: planSearch.page <= 1, onClick: () => setPlanSearch({ ...planSearch, page: planSearch.page - 1 }) }, '上一页'),
                h(GhostButton, { disabled: planSearch.page >= planPages, onClick: () => setPlanSearch({ ...planSearch, page: planSearch.page + 1 }) }, '下一页')))))

  const submit = async event => {
    event.preventDefault()
    if (savingRef.current || kind === 'budget') return
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const num = key => Number(form.get(key))
    const text = key => { const value = String(form.get(key) || '').trim(); return value || undefined }
    const textChoice = key => text(key + 'Choice')
    const customFields = kind === 'payment' ? ['payeeName', 'costItemName'] : kind === 'revenue' ? ['itemName', 'payerName', 'incomeTypeName'] : []
    const pendingField = customFields.find(key => text(key + 'ChoiceDraft'))
    if (pendingField) {
      setNotice(t('entryCustomPending'))
      formElement.querySelector?.(`[data-finance-pending="${pendingField}Choice"]`)?.click()
      return
    }
    const amountKey = kind === 'backfill' ? 'actualAmount' : 'plannedAmount'
    const amount = num(amountKey)
    const monthKey = kind === 'payment' ? 'planMonth' : 'month'
    const validMonth = !text(monthKey) || (Number.isInteger(num(monthKey)) && num(monthKey) >= 1 && num(monthKey) <= 12)
    const activeYear = Number(entryYear)
    if (!text(amountKey) || !Number.isFinite(amount) || amount < 0 || (kind !== 'backfill' && amount === 0) ||
      (kind !== 'backfill' && (!orgOptions.some(([id]) => id === text('orgId')) || activeYear < 2000 || activeYear > 2100 || !Number.isInteger(activeYear) || !validMonth))) {
      setNotice(t('entryInvalid')); return
    }
    if (kind === 'payment' && !text('description')) { setNotice(t('entryDescriptionRequired')); return }
    const limits = FINANCE_ENTRY_TEXT_LIMITS[kind] || {}
    if (kind !== 'backfill' && Object.entries(limits).some(([key, max]) => (text(key === 'description' ? key : key + 'Choice') || '').length > max)) { setNotice(t('entryTextTooLong')); return }
    if (kind === 'revenue' && !textChoice('itemName')) { setNotice(t('entryIncomeRequired')); return }
    if (kind === 'backfill' && (!backfillReady || selectedPlan.id !== text('planId'))) { setNotice(t('selectPlan')); return }
    savingRef.current = true
    setBusy(true); setNotice(null)
    try {
      let path, payload
      if (kind === 'payment') {
        path = '/payment-plans'
        payload = { orgId: text('orgId'), planType: text('planType'), year: activeYear, description: text('description'), plannedAmount: num('plannedAmount') }
        const planMonth = text('planMonth')
        if (!planMonth) { setNotice(`${t('opFailed')}: ${t('planMonthRequired')}`); setBusy(false); return }
        payload.planMonth = num('planMonth')
        if (textChoice('payeeName')) payload.payeeName = textChoice('payeeName')
        if (textChoice('costItemName')) payload.costItemName = textChoice('costItemName')
        if (text('departmentId')) payload.departmentId = text('departmentId')
        if (text('expenseType')) payload.expenseType = text('expenseType')
      } else if (kind === 'revenue') {
        path = '/revenue-plans'
        payload = { orgId: text('orgId'), year: activeYear, itemName: textChoice('itemName'), plannedAmount: num('plannedAmount') }
        if (text('month')) payload.month = num('month')
        if (textChoice('payerName')) payload.payerName = textChoice('payerName')
        if (textChoice('incomeTypeName')) payload.incomeTypeName = textChoice('incomeTypeName')
      } else {
        path = `/${backfillKind === 'payment' ? 'payment-plans' : 'revenue-plans'}/${text('planId')}/actuals`
        payload = { actualAmount: num('actualAmount') }
        if (text('actualPaidAt')) payload.actualPaidAt = new Date(`${text('actualPaidAt')}T00:00:00`).toISOString()
      }
      await post(path, payload)
      setNotice(t(kind === 'backfill' ? 'entryActualsSaved' : kind === 'payment' ? 'entryPaymentSaved' : 'entryRevenueSaved'))
      dirtyRef.current = false
      if (kind === 'backfill') resetBackfill()
      formElement.reset()
      setFormRevision(value => value + 1)
      setRetry(value => value + 1)
      onSaved?.()
    } catch (error) { setNotice(`${t('opFailed')}: ${error.message}`) } finally { savingRef.current = false; setBusy(false) }
  }

  if (kind === 'budget') return h('div', { className: 'sf-card', ref: entryRootRef },
    h('div', { className: 'sf-card-head' }, h('h2', null, t('entryTitle'))),
    h('div', { className: 'sf-card-body sf-stack' },
      h(PillTabs, { tabs: [['payment', 'entryPaymentPlan'], ['revenue', 'entryRevenuePlan'], ['budget', 'entryBudgetLine'], ['backfill', 'entryBackfill']], value: kind, onChange: changeKind, t }),
      h(FormRow, { label: t('year') }, h(Select, { name: 'year', value: entryYear, onChange: changeEntryYear, options: years })),
      h(ConfiguredBudgetEntry, { year: entryYear, onNavigate })))

  return h('form', { className: 'sf-card', ref: entryRootRef, key: `${kind}-${formRevision}`, onSubmit: submit, onChangeCapture: event => { if (!['year', 'backfillKind'].includes(event.target.name) && !event.target.closest?.('[data-entry-filter]')) markDirty() } },
    discardDialog,
    h('div', { className: 'sf-card-head' }, h('h2', null, t('entryTitle')), h('span', { className: 'sf-card-unit' }, t('unitYuan'))),
    h('div', { className: 'sf-card-body' }, h('div', { className: 'sf-stack' },
      h('p', { className: 'sf-note' }, t('entryHint')),
      h('fieldset', { className: 'sf-fieldset sf-stack', disabled: busy, 'aria-busy': busy },
      h(PillTabs, { tabs: [['payment', 'entryPaymentPlan'], ['revenue', 'entryRevenuePlan'], ['budget', 'entryBudgetLine'], ['backfill', 'entryBackfill']], value: kind, onChange: changeKind, t }),
      h('div', { className: 'sf-form sf-entry-form' },
        kind !== 'backfill' ? [
          h(FormRow, { key: 'org', label: `${t('org')} *` }, h(SearchSelect, { buttonTrigger: true, name: 'orgId', value: entryOrg, onChange: value => { setEntryOrg(value); markDirty() }, required: true, disabled: !orgOptions.length, options: orgOptions, placeholder: t('org') })),
          h(FormRow, { key: 'year', label: t('year') }, h(Select, { name: 'year', value: entryYear, onChange: changeEntryYear, options: years })),
          !orgOptions.length ? h('p', { key: 'org-empty', className: 'sf-note', role: 'status' }, t('entryOrgEmpty')) : null,
        ] : [
          h(FormRow, { key: 'backfill-year', label: t('year') }, h(Select, { name: 'year', value: entryYear, onChange: changeEntryYear, options: years })),
          h(FormRow, { key: 'backfill-org', label: '主体范围' }, h(SearchSelect, { buttonTrigger: true, value: backfillOrg, onChange: value => { if (value !== backfillOrg) changeBackfillScope(() => setBackfillOrg(value)) }, options: [['', '全部主体（含未分配）'], ...orgOptions], placeholder: '主体范围' })),
          h(FormRow, { key: 'backfill-kind', label: t('backfillKind') }, h(Select, { name: 'backfillKind', value: backfillKind, onChange: value => { if (value !== backfillKind) changeBackfillScope(() => setBackfillKind(value)) }, options: [['payment', '付款计划实付'], ['revenue', '收入计划实收']] })),
          h(FormRow, { key: 'plan', wide: true, label: '选择计划记录 *' }, h(SearchSelect, { buttonTrigger: true, name: 'planId', value: selectedPlan?.id || '', selectedLabel: selectedPlan?.label, onChange: chooseBackfillPlan, required: true, options: backfillPlans, placeholder: '选择计划记录', maxLength: 200,
            remoteSearch: { value: planKeyword, onChange: setPlanKeyword, onSubmit: runPlanSearch, content: planSearchContent } })),
          selectedPlan ? h('p', { key: 'selected-plan', className: 'sf-note sf-entry-wide' }, '本次回填：' + selectedPlan.label) : null,
          !planLoading && !pendingPlanSearch && !currentPlans.error && planTotal === 0 && !planSearch.keyword && !selectedPlan ? h('div', { key: 'plan-empty', className: 'sf-stack' },
            h('p', { className: 'sf-note' }, '当前范围暂无可回填计划，请先创建付款计划或收入计划。'),
            h(LinkButton, { onClick: () => changeKind(backfillKind) }, t(backfillKind === 'payment' ? 'createPaymentPlan' : 'createRevenuePlan'))) : null,
        ],
        kind === 'payment' ? [
          h('div', { key: 'p-summary', className: 'sf-form-grid sf-entry-wide' },
            h(FormRow, { label: t('planType') }, h(Select, { name: 'planType', required: true, options: PLAN_TYPES.map(([id, label]) => [id, t(label)]) })),
            h(FormRow, { label: `${t('entryPlanMonth')} *` }, h(Select, { name: 'planMonth', defaultValue: String(new Date().getMonth() + 1), required: true, options: months, placeholder: t('entryPlanMonth') })),
            h(FormRow, { label: `${t('planned')}（${t('unitYuan')}） *` }, h(Field, { name: 'plannedAmount', type: 'number', min: 0.01, step: '0.01', required: true }))),
          h(FormRow, { key: 'pd', wide: true, label: `${t('description')} *` }, h(Field, { name: 'description', required: true, maxLength: 500 })),
          h(FormRow, { key: 'py', label: t('entryPayee') }, h(CustomizableTextSelect, { buttonTrigger: true, onChange: markDirty, name: 'payeeName', options: suggestions.payees, placeholder: t('entryPayee') })),
          h(FormRow, { key: 'pdept', label: t('entryDepartment') }, h(SearchSelect, { buttonTrigger: true, name: 'departmentId', onChange: markDirty, options: departmentOptions, placeholder: t('entryDepartment') })),
          h(FormRow, { key: 'pc', label: t('costItem') }, h(CustomizableTextSelect, { buttonTrigger: true, onChange: markDirty, name: 'costItemName', options: (costItems || []).map(item => item.name), placeholder: t('costItem'), maxLength: 100 })),
          h(FormRow, { key: 'pexpense', label: t('expenseType') }, h(Select, { name: 'expenseType', options: [['', t('entryOptional')], ...EXPENSE_TYPES.map(([id, label]) => [id, t(label)])] })),
        ] : kind === 'revenue' ? [
          h('div', { key: 'r-summary', className: 'sf-form-grid sf-entry-wide' },
            h(FormRow, { label: t('entryRevenueMonth') }, h(Select, { name: 'month', defaultValue: String(new Date().getMonth() + 1), options: [['', t('entryAnnual')], ...months] })),
            h(FormRow, { label: `${t('planned')}（${t('unitYuan')}） *` }, h(Field, { name: 'plannedAmount', type: 'number', min: 0.01, step: '0.01', required: true }))),
          h(FormRow, { key: 'ri', wide: true, label: `${t('itemName')} *` }, h(CustomizableTextSelect, { buttonTrigger: true, onChange: markDirty, name: 'itemName', options: suggestions.items, placeholder: t('itemName'), required: true })),
          h(FormRow, { key: 'rt', label: t('incomeType') }, h(CustomizableTextSelect, { buttonTrigger: true, onChange: markDirty, name: 'incomeTypeName', options: suggestions.incomeTypes, placeholder: t('incomeType'), maxLength: 100 })),
          h(FormRow, { key: 'rp', label: t('entryPayer') }, h(CustomizableTextSelect, { buttonTrigger: true, onChange: markDirty, name: 'payerName', options: suggestions.payers, placeholder: t('entryPayer') })),
        ] : [
          h(FormRow, { key: 'aa', label: `${t('actualAmountL')} *` }, h(Field, { name: 'actualAmount', value: backfillAmount, onChange: value => { setBackfillAmount(value); markDirty() }, type: 'number', min: 0, step: '0.01', required: true })),
          h(FormRow, { key: 'ad', label: '实际日期' }, h(Field, { name: 'actualPaidAt', value: backfillDate, onChange: value => { setBackfillDate(value); markDirty() }, type: 'date' })),
        ],
        ['payment', 'revenue'].includes(kind) ? h('p', { className: 'sf-note sf-entry-wide' }, t('entryHistoryScope')) : null,
        kind === 'payment' && costError ? h('div', { role: 'status' }, h('p', { className: 'sf-note' }, t('entryCostFailed')), h(LinkButton, { onClick: () => setRetry(value => value + 1) }, t('retry'))) : null,
        ['payment', 'revenue'].includes(kind) && historyError[kind] ? h('div', { role: 'status', className: 'sf-stack' },
          h('p', { className: 'sf-note' }, t('entryHistoryFailed')),
          h(LinkButton, { onClick: () => setRetry(value => value + 1) }, t('retry'))) : null,
        h('div', { className: 'sf-form-actions sf-entry-wide' },
          h(PrimaryButton, { type: 'submit', busy, disabled: (kind !== 'backfill' && !orgOptions.length) || (kind === 'backfill' && (!backfillReady || !backfillAmount.trim())) }, busy ? t('running') : t(kind === 'backfill' ? 'entryBackfillAction' : 'entrySaveAction')),
          notice ? h('div', { role: 'status', 'aria-live': 'polite' }, h(Notice, null, notice)) : null))))))
}

// 与网页组织通讯录使用同一权威目录；本地镜像和手工填写用户 ID 不作为身份来源。
function financeDirectoryRows(directory, keyword = '', onlyPending = false) {
  const departments = new Map((directory?.departments || []).map(row => [row.id, row.name]))
  const search = keyword.trim().toLocaleLowerCase('zh-CN')
  return (directory?.members || []).filter(row => row.source !== 'LOCAL_MIRROR')
    .filter(row => !onlyPending || !(row.identityEnabled ?? row.enabled))
    .filter(row => !search || `${row.name} ${(row.departmentIds || []).map(id => departments.get(id) || '').join(' ')}`.toLocaleLowerCase('zh-CN').includes(search))
    .map(row => ({ ...row, id: row.key, identityReady: row.identityEnabled ?? row.enabled, syncedAt: directory.lastSyncedAt, departmentName: (row.departmentIds || []).map(id => departments.get(id)).filter(Boolean).join('、') }))
}
function FinanceDirectoryView({ ctx }) {
  const [keyword, setKeyword] = useState('')
  const [onlyPending, setOnlyPending] = useState(false)
  const action = useFinanceAction()
  const directory = useFinanceResource('/finance/permissions/organization-directory', `${ctx.revision}-${action.revision}`)
  const rows = financeDirectoryRows(directory.data, keyword, onlyPending)
  const maskPhone = value => value ? String(value).replace(/^(\+?\d{0,3})?(\d{3})\d+(\d{4})$/, '$1$2****$3') : '—'
  const maskEmail = value => value ? String(value).replace(/^(.).*(@.*)$/, '$1***$2') : '—'
  return h('div', { className: 'sf-stack' },
    h('p', { className: 'sf-note' }, '组织身份由 SSO 与飞书同步维护；成员无需先登录，不能手工填写用户 ID 建立身份。'),
    h(Notice, null, action.notice),
    h(FinanceOrganizationNotice, { directory: directory.data, onRefresh: directory.retry }),
    h(Card, { title: '组织通讯录', actions: [h(GhostButton, { key: 'sync', disabled: action.busy, onClick: async () => {
      try { const result = await action.run('/finance/feishu/directory/sync'); if (result?.skipped) action.report(`同步跳过：${result.reason || '应用未配置'}`) } catch { /* notice retains the failure */ }
    } }, action.busy ? '同步中…' : '同步组织通讯录')] },
      h('div', { className: 'sf-filters' }, h(Field, { value: keyword, onChange: setKeyword, 'aria-label': '搜索姓名或部门', placeholder: '搜索姓名或部门' }), h('label', null, h('input', { type: 'checkbox', checked: onlyPending, onChange: event => setOnlyPending(event.target.checked) }), '只看待同步身份')),
      h(FinanceResource, { resource: directory }, h(Table, { tableId: 'finance-authoritative-directory', rows, rowKey: 'id', empty: keyword || onlyPending ? '没有匹配的人员' : '暂无组织人员', columns: [
        { key: 'name', label: '姓名' }, { key: 'departmentName', label: '部门' },
        { key: 'mobile', label: '手机', render: row => maskPhone(row.mobile) }, { key: 'email', label: '邮箱', render: row => maskEmail(row.email) },
        { key: 'identityReady', label: '身份状态', render: row => row.identityReady ? '身份就绪' : '待同步身份' },
        { key: 'syncedAt', label: '同步时间', render: row => shortDate(row.syncedAt) || '—' }, { key: 'warning', label: '同步提示' },
      ] }))))
}
function FinanceCostItemsView({ ctx, t }) {
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [page, setPage] = useState(1)
  const items = useFinanceResource(`/finance/cost-items?page=${page}&limit=20`, `${ctx.revision}-${revision}`)
  if (ctx.role !== 'FINANCE_OWNER') return h('p', { role: 'alert' }, '费用类别仅财务负责人可维护')
  return h('div', { className: 'sf-stack' },
    h('p', { className: 'sf-note' }, '维护预算与填报共用的费用类别，统一费用分类口径。'),
    h(Card, { title: '共享费用类别', actions: [h(GhostButton, { key: 'create', disabled: busy, onClick: () => setCreating(true) }, '新增费用类别')] },
      creating ? h(CostItemCreator, { t, submitLabel: '新增费用类别', onBusyChange: setBusy, onCancel: () => setCreating(false), onCreated: () => { setCreating(false); setPage(1); setRevision(value => value + 1) } }) : null,
      h(FinanceResource, { resource: items }, h(Table, { tableId: 'finance-cost-items', rows: financeRows(items.data), rowKey: 'id', columns: financeColumns([['code', '费用类别编号'], ['name', '费用类别名称']]), empty: '暂无费用类别，请先新增' })),
      h(Pager, { page, total: items.data?.total, limit: 20, onPage: setPage })))
}

/** 按人员查看完整归属历史；目录与历史分别分页，保留已选人员。 */
function FinanceEmploymentView({ ctx, t }) {
  const [contactPage, setContactPage] = useFinanceViewState(ctx, 'contactPage', 1)
  const [page, setPage] = useFinanceViewState(ctx, 'page', 1)
  const [searchInput, setSearchInput] = useFinanceViewState(ctx, 'searchInput', '')
  const [keyword, setKeyword] = useFinanceViewState(ctx, 'keyword', '')
  const [selected, setSelected] = useFinanceViewState(ctx, 'selected', null)
  const [open, setOpen] = useState(false)
  const [tick, setTick] = useState(0)
  const action = useFinanceAction()
  const params = new URLSearchParams({ page: contactPage, limit: 20 })
  if (keyword) params.set('keyword', keyword)
  const contacts = useFinanceResource(`/finance/feishu/contacts?${params}`, ctx.revision)
  const records = useFinanceResource(selected?.systemUserId ? `/finance/employment/records?${new URLSearchParams({ systemUserId: selected.systemUserId, page, limit: 20 })}` : null, `${ctx.revision}-${tick}`)
  const people = financeRows(contacts.data)
  const options = selected && !people.some(person => person.id === selected.id) ? [selected, ...people] : people
  const act = async (path, body) => { try { await action.run('/finance/employment/records', body); setTick(value => value + 1); return true } catch { return false } }
  return h('div', { className: 'sf-stack' },
    h('p', { className: 'sf-note' }, '按人员核对归属时间段；人员与记录每页20条，跨页保留已选人员。调岗登记会自动闭合旧归属，排序仅作用于当前页。'),
    h('form', { className: 'sf-row', onSubmit: event => { event.preventDefault(); setKeyword(searchInput.trim()); setContactPage(1) } }, h(Field, { 'aria-label': '搜索归属人员', value: searchInput, maxLength: 100, placeholder: '姓名、手机号或邮箱', onChange: setSearchInput }), h(GhostButton, { type: 'submit' }, '搜索人员')),
    h(FinanceResource, { resource: contacts }, h(SearchSelect, { 'aria-label': '选择人员', value: selected?.id || '', selectedLabel: selected?.name, options: options.map(person => [person.id, `${person.name}${person.systemUserId ? '' : '（未绑定）'}`]), onChange: id => { setSelected(options.find(person => person.id === id) || null); setPage(1) }, placeholder: '选择人员' }), h(Pager, { page: contactPage, total: contacts.data?.total, limit: 20, onPage: setContactPage })),
    h(Notice, null, action.notice),
    !selected ? h('p', null, '请先选择人员') : !selected.systemUserId ? h('p', null, '该人员尚未绑定系统身份，请先核对组织通讯录。') : h(FinanceResource, { resource: records }, h(EmploymentCard, { employments: records.data, page, onPage: setPage, userName: selected.name, busy: contacts.loading || Boolean(contacts.error), t, onDialog: () => setOpen(true), onRetry: records.retry })),
    selected?.systemUserId ? h(FinanceEmploymentPreview, { key: selected.systemUserId, systemUserId: selected.systemUserId, revision: `${ctx.revision}-${tick}` }) : null,
    open ? h(EmploymentDialog, { contacts: [selected], initialUserId: selected.systemUserId, departments: ctx.departments, busy: action.busy, t, act, onClose: () => setOpen(false) }) : null)
}

/** 仅查询已登记归属；不从当前通讯录推断历史，也不在客户端重算归属。 */
function FinanceEmploymentPreview({ systemUserId, revision }) {
  const [date, setDate] = useState('')
  const at = financeEmploymentStartISOString(date)
  const result = useFinanceResource(at ? `/finance/employment/resolve?${new URLSearchParams({ systemUserId, at })}` : null, revision)
  const prefix = useId()
  return h('section', { className: 'sf-stack', 'aria-label': '归属解析预览' },
    h('h4', null, '归属解析预览（输入日期查当日归属部门）'),
    h(FormRow, { label: '归属解析日期' }, h(Field, { type: 'date', value: date, onChange: setDate, 'aria-label': '归属解析日期', 'aria-invalid': date && !at ? true : undefined, 'aria-describedby': `${prefix}-date-hint` })),
    h('p', { id: `${prefix}-date-hint`, className: date && !at ? 'sf-neg' : 'sf-note' }, date && !at ? '请输入有效的解析日期' : '按所选日期当地时间 00:00 解析归属。'),
    !at ? h('p', { className: 'sf-note' }, '选择日期后解析') : h(FinanceResource, { resource: result },
      result.data ? h('p', { role: 'status' }, `${date} 归属：${result.data.departmentName ?? result.data.departmentId ?? '未匹配（无该日期的归属记录）'}`) : null))
}
