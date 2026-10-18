// 与网页“成员与角色”同一任务边界：岗位分配、岗位维护和移除确认。
function financeMemberRoleBody(value, people, roles) {
  const userIds = [...new Set(value.userIds || [])]
  if (!userIds.length || userIds.length > 500 || userIds.some(id => !people.some(person => person.userId === id))) throw new Error('请从当前组织选择 1 至 500 名身份有效的成员')
  if (!roles.some(role => role.id === value.role && role.enabled)) throw new Error('请选择可用岗位角色')
  const reason = String(value.reason || '').trim()
  if (!reason || reason.length > 500) throw new Error('请填写 1 至 500 字的变更原因')
  return { userIds, role: value.role, reason }
}

function FinanceMembersView({ ctx, t }) {
  const action = useFinanceAction()
  const [dialog, setDialog] = useState(null), [keyword, setKeyword] = useState(''), [roleFilter, setRoleFilter] = useState(''), [selected, setSelected] = useState([])
  const revision = `${ctx.revision}-${action.revision}`
  const members = useFinanceResource('/finance/members', revision)
  const roles = useFinanceResource('/finance/access-roles', revision)
  const policies = useFinanceResource('/finance/permission-policies', revision)
  const directory = useFinanceResource('/finance/permissions/organization-directory', revision)
  const rows = financeRows(members.data), roleRows = financeRows(roles.data), people = financePolicyPeople(directory.data, 'role')
  const userPolicies = new Set(financeRows(policies.data).filter(row => row.subjectType === 'USER').map(row => row.subjectId))
  const ready = [members, roles, policies, directory].every(resource => !resource.loading && !resource.error && resource.data != null)
  const visible = rows.filter(row => (!roleFilter || (row.customRoleId ?? row.role) === roleFilter) && `${row.name || ''} ${row.userId}`.toLowerCase().includes(keyword.trim().toLowerCase())).sort((a, b) => (a.name || a.userId).localeCompare(b.name || b.userId, 'zh-CN'))
  const openAssign = (ids = [], role = '') => setDialog({ kind: 'assign', userIds: ids, role })
  return h('div', { className: 'sf-stack' },
    h(Card, { title: '成员与角色', actions: [h(GhostButton, { key: 'assign', disabled: !ready || action.busy, onClick: () => openAssign() }, '批量分配角色')] },
      h('p', { className: 'sf-note' }, '统一维护岗位角色，支持一次分配多名成员。成员独立权限优先于岗位权限；变更岗位不会清除独立配置。'),
      h(Notice, null, action.notice),
      h(FinanceOrganizationNotice, { directory: directory.data, onRefresh: action.busy ? undefined : directory.retry }),
      ...[roles, policies, directory].map((resource, i) => h(FinanceResource, { key: i, resource })),
      h('div', { className: 'sf-row' },
        h(Field, { 'aria-label': '搜索角色成员', placeholder: '搜索姓名或系统 ID', value: keyword, onChange: setKeyword }),
        h(SearchSelect, { buttonTrigger: true, 'aria-label': '筛选岗位角色', value: roleFilter, options: [['', `全部角色 · ${rows.length} 人`], ...roleRows.map(role => [role.id, `${role.name} · ${rows.filter(row => (row.customRoleId ?? row.role) === role.id).length} 人`])], onChange: setRoleFilter }),
        h(GhostButton, { disabled: !ready || action.busy || !visible.length, onClick: () => setSelected(current => [...new Set([...current, ...visible.map(row => row.userId)])]) }, '选择当前列表成员'),
        selected.length ? h(GhostButton, { disabled: !ready || action.busy, onClick: () => openAssign(selected) }, `为已选 ${selected.length} 名成员分配角色`) : null,
        selected.length ? h(GhostButton, { disabled: action.busy, onClick: () => setSelected([]) }, '清空选择') : null),
      h(FinanceResource, { resource: members }, h(MembersCard, { members: { list: visible }, busy: action.busy, ready, roles: roleRows, policies: userPolicies, policyReady: !policies.loading && !policies.error, selected, onSelect: setSelected, onAssign: row => openAssign([row.userId], row.customRoleId ?? row.role), onRemove: row => setDialog({ kind: 'remove', row }), t }))),
    h(Card, { title: '管理岗位角色' }, h(FinanceRoleManager, { roles: roleRows, ready, action })),
    dialog?.kind === 'assign' ? h(FinanceMemberRoleDialog, { key: JSON.stringify(dialog), initial: dialog, people, roles: roleRows, directory: directory.data, onDirectoryRefresh: directory.retry, policies: userPolicies, onClose: () => setDialog(null), onSave: async body => { await action.run('/finance/member-roles/batch', body); setSelected([]); setDialog(null) } }) : null,
    dialog?.kind === 'remove' ? h(FinanceFormDialog, { title: `移除财务角色：${dialog.row.name || dialog.row.userId}`, description: '移除后该成员不再保留当前财务岗位配置；此操作不会删除 SSO 组织身份。请核对成员后确认。', fields: [], onClose: () => setDialog(null), onSubmit: async () => { await action.run(`/finance/members/${dialog.row.id}/remove`, {}); setSelected(current => current.filter(id => id !== dialog.row.userId)) } }) : null)
}

function MembersCard({ members, busy, ready = false, roles = [], policies = new Set(), policyReady, selected = [], onSelect, onAssign, onRemove, t, onRetry }) {
  const rows = members?.list || []
  const roleName = row => roles.find(role => role.id === (row.customRoleId ?? row.role))?.name || t(`roleName${row.role}`)
  return h('div', null, members?.forbidden ? h('p', { role: 'status' }, '当前账号没有成员权限，请联系财务负责人。') : members?.error ? h(ListLoadError, { label: '成员列表', onRetry }) : null,
    h(Table, { tableId: 'finance-members', rowKey: 'id', rows: members?.error || members?.forbidden ? [] : rows, empty: members?.error || members?.forbidden ? null : !members ? t('loading') : t('empty'), columns: [
      { key: 'selection', label: '选择', sortable: false, render: row => h('input', { type: 'checkbox', 'aria-label': `选择 ${row.name || row.userId}`, checked: selected.includes(row.userId), disabled: busy || !ready, onChange: event => onSelect(event.target.checked ? [...new Set([...selected, row.userId])] : selected.filter(id => id !== row.userId)) }) },
      { key: 'name', label: '成员', render: row => row.name || row.userId },
      { key: 'role', label: '岗位角色', sortValue: roleName, render: roleName },
      { key: 'policy', label: '权限来源', render: row => !policyReady ? '来源待核对' : policies.has(row.userId) ? '成员独立配置' : '继承角色' },
      { key: 'enabled', label: '状态', render: row => row.enabled ? '已启用' : '已停用' },
      { key: 'actions', label: '操作', sortable: false, render: row => h('div', { className: 'sf-row' }, h(GhostButton, { disabled: busy || !ready, onClick: () => onAssign(row) }, '调整角色'), h(GhostButton, { disabled: busy || !ready, onClick: () => onRemove(row) }, '移除角色')) },
    ] }))
}

function FinanceMemberRoleDialog({ initial, people, roles, directory, onDirectoryRefresh, policies, onSave, onClose }) {
  const [value, setValue] = useState({ userIds: initial.userIds || [], role: initial.role || '', reason: '' })
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), lock = useRef(false)
  const update = patch => { setValue(current => ({ ...current, ...patch })); setError('') }
  const submit = async event => {
    event.preventDefault(); if (lock.current) return
    try {
      const body = financeMemberRoleBody(value, people, roles)
      lock.current = true; setBusy(true); setError(''); await onSave(body)
    } catch (cause) { setError(cause.message || '分配失败，整批未保存，填写内容已保留') }
    finally { lock.current = false; setBusy(false) }
  }
  const overridden = value.userIds.filter(id => policies.has(id)).length
  return h(Dialog, { title: '批量分配角色', onClose, dismissDisabled: busy }, h('form', { className: 'sf-stack', onSubmit: submit },
    h('p', { className: 'sf-note' }, '从 SSO 当前组织选择成员，可分配已同步但尚未登录的人员。部门仅辅助选择当前成员，不自动分配未来加入人员。'),
    h(FinanceOrganizationNotice, { directory, onRefresh: busy ? undefined : onDirectoryRefresh }),
    h('fieldset', { className: 'sf-fieldset sf-stack', disabled: busy },
      h(FormRow, { label: '选择成员' }, h(MultiSearchSelect, { value: value.userIds, disabled: busy, options: people.map(person => [person.userId, `${person.name || person.userId} · ${(person.departmentIds || []).map(id => directory?.departments?.find(row => row.id === id)?.name).filter(Boolean).join('、') || '未分配部门'}`]), placeholder: '选择成员', onChange: userIds => update({ userIds }) })),
      h(FormRow, { label: '按部门追加当前成员（含下级）' }, h(SearchSelect, { buttonTrigger: true, disabled: busy, value: '', options: (directory?.departments || []).map(row => [row.id, row.name]), placeholder: '选择部门追加成员', onChange: id => update({ userIds: [...new Set([...value.userIds, ...financePolicyDepartmentPeople(directory, [id], 'role')])] }) })),
      h('p', { role: 'status', className: 'sf-note' }, `已选 ${value.userIds.length} 人` + (overridden ? `；其中 ${overridden} 人保留成员独立权限。若要继承岗位，请前往功能与数据授权恢复继承。` : '；未配置独立权限的成员继承岗位权限。')),
      h(FormRow, { label: '岗位角色' }, h(SearchSelect, { buttonTrigger: true, disabled: busy, value: value.role, options: roles.filter(role => role.enabled).map(role => [role.id, role.name]), placeholder: '选择岗位角色', onChange: role => update({ role }) })),
      h(FormRow, { label: '变更原因' }, h(Textarea, { 'aria-label': '变更原因', value: value.reason, disabled: busy, required: true, maxLength: 500, onChange: reason => update({ reason }) }))),
    error ? h('p', { role: 'alert', className: 'sf-neg' }, error) : null,
    h('div', { className: 'sf-row' }, h(PrimaryButton, { type: 'submit', busy }, '确认分配'), h(GhostButton, { disabled: busy, onClick: onClose }, '取消'))))
}
