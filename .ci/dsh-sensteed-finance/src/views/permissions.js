const FINANCE_PERMISSION_NAMES = {
  'budget.activity.read': '查看预算填报活动', 'budget.activity.manage': '创建/发布/关闭填报活动', 'budget.activity.reopen': '重开已关闭活动',
  'budget.submission.read': '查看预算填报', 'budget.submission.edit': '代部门修改填报', 'budget.submission.verify': '确认/退回填报',
  'budget.adjustment.approve': '审核预算调整', 'budget.version.manage': '创建/编辑预算版本', 'budget.version.publish': '发布正式预算版本',
  'budget.compare.read': '查看预算比较', 'budget.execution.read': '查看预算执行', 'cash.plan.read': '查看资金计划', 'cash.plan.write': '填报资金计划', 'cash.plan.verify': '确认资金计划',
  'finance.source.review': '来源数据清洗/确认/退回', 'finance.invoice.check': '发票重复/真伪校验', 'finance.archive.read': '电子档案查询',
  'finance.assistant.read': '查看 AI 财务助手', 'cost.engineering.read': '查看成本工程', 'finance.permission.manage': '管理财务权限',
}
function PermissionsView({ ctx }) {
  const action = useFinanceAction()
  const [userId, setUserId] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState(null)
  const revision = `${ctx.revision}-${action.revision}`
  const manage = ctx.role === 'FINANCE_OWNER' && ctx.permissions?.includes('finance.permission.manage')
  const me = useFinanceResource('/finance/permissions/me', revision)
  const members = useFinanceResource(manage ? '/finance/members' : null, revision)
  const grants = useFinanceResource(manage ? `/finance/permissions?page=${page}&limit=20&activeOnly=${activeOnly}${userId ? `&userId=${encodeURIComponent(userId)}` : ''}` : null, revision)
  const memberOptions = financeRows(members.data).filter(row => row.enabled !== false).map(row => [row.systemUserId || row.userId, row.displayName || row.name || row.systemUserId || row.userId]).filter(([id]) => id)
  return h('div', { className: 'sf-stack' },
    h(Card, { title: '我的权限可用范围' }, h(FinanceResource, { resource: me }, h(Table, { tableId: 'finance-my-permissions', rows: (me.data?.permissions || []).map(permission => ({ permission, scopes: me.data?.scopes?.find(row => row.permission === permission)?.scopes || [] })), empty: '暂无权限', columns: [
      { key: 'permission', label: '功能', render: row => FINANCE_PERMISSION_NAMES[row.permission] || row.permission },
      { key: 'scopes', label: '数据范围', render: row => h(FinanceEvidence, { value: row.scopes }) },
    ] }))),
    manage ? h(Card, { title: '财务授权管理', actions: [h(GhostButton, { key: 'create', onClick: () => setDialog({ kind: 'create', title: '新增授权' }) }, '新增授权')] },
      h('div', { className: 'sf-row' }, h(SearchSelect, { value: userId, onChange: value => { setUserId(value); setPage(1) }, options: memberOptions, placeholder: '全部成员' }), h('label', null, h('input', { type: 'checkbox', checked: activeOnly, onChange: event => { setActiveOnly(event.target.checked); setPage(1) } }), '仅生效授权')),
      h(Notice, null, action.notice), h(FinanceResource, { resource: grants }, h(Table, { tableId: 'finance-grants', rows: financeRows(grants.data), empty: '暂无显式授权', columns: [
        ...financeColumns([['userName', '人员'], ['scopeType', '范围'], ['orgId', '主体'], ['departmentId', '部门'], ['yearFrom', '起始年度'], ['yearTo', '截止年度'], ['expiresAt', '有效期'], ['grantReason', '原因']]),
        { key: 'permission', label: '功能', render: row => FINANCE_PERMISSION_NAMES[row.permission] || row.permission },
        { key: 'actions', label: '操作', sortable: false, render: row => !row.revokedAt ? h(GhostButton, { disabled: action.busy, onClick: () => setDialog({ kind: 'revoke', title: '撤销授权', id: row.id }) }, '撤销授权') : '已撤销' },
      ] })), h(Pager, { page, total: grants.data?.total, limit: 20, onPage: setPage })) : null,
    dialog ? h(FinanceFormDialog, { title: dialog.title, initial: { scopeType: 'SELF' }, onClose: () => setDialog(null),
      fields: dialog.kind === 'revoke' ? [{ key: 'reason', label: '撤销原因', required: true, type: 'textarea' }] : [
        { key: 'userId', label: '被授权人', options: memberOptions, required: true }, { key: 'permission', label: '功能权限', options: Object.entries(FINANCE_PERMISSION_NAMES), required: true },
        { key: 'scopeType', label: '数据范围', options: [['SELF', '本人'], ['DEPARTMENT', '指定部门'], ['ORG', '指定主体'], ['GLOBAL', '全域']], required: true },
        { key: 'orgId', label: '主体', options: ctx.orgs.map(row => [row.id, row.name]), required: true, when: values => values.scopeType === 'ORG' },
        { key: 'departmentId', label: '部门', options: ctx.departments.map(row => [row.id, row.name]), required: true, when: values => values.scopeType === 'DEPARTMENT' },
        { key: 'yearFrom', label: '起始年度', type: 'number', min: 2000, max: 2100 }, { key: 'yearTo', label: '截止年度', type: 'number', min: 2000, max: 2100 },
        { key: 'startsAt', label: '开始生效', type: 'datetime-local' }, { key: 'expiresAt', label: '到期时间', type: 'datetime-local' }, { key: 'reason', label: '变更原因', required: true, type: 'textarea' },
      ], onSubmit: async body => {
        if (body.yearFrom && body.yearTo && body.yearFrom > body.yearTo) throw new Error('起始年度不能晚于截止年度')
        if (body.startsAt && body.expiresAt && body.startsAt > body.expiresAt) throw new Error('开始时间不能晚于到期时间')
        return action.run(dialog.kind === 'revoke' ? `/finance/permissions/${dialog.id}/revoke` : '/finance/permissions', body)
      } }) : null,
    h('p', { className: 'sf-note' }, '生效权限由角色基线与显式授权共同决定。撤销显式授权不会移除角色自带权限。'))
}
