function NotificationsView({ ctx, onDrill }) {
  const [category, setCategory] = useState('ACTION_REQUIRED')
  const [unread, setUnread] = useState(false)
  const [page, setPage] = useState(1)
  const action = useFinanceAction()
  const revision = `${ctx.revision}-${action.revision}`
  const list = useFinanceResource(`/finance/notifications?category=${category}&page=${page}&limit=20${unread ? '&unread=true' : ''}`, revision)
  const summary = useFinanceResource('/finance/notifications/summary', revision)
  return h('div', { className: 'sf-stack' },
    h(FinanceResource, { resource: summary }, h('div', { className: 'sf-kpis' }, ...[['total', '通知总数'], ['unread', '未读'], ['pending', '待处理']].map(([key, label]) => h(KpiCard, { key, label, value: summary.data?.[key] })))),
    h('div', { className: 'sf-row' }, h(Select, { value: category, 'aria-label': '通知分类', options: [['ACTION_REQUIRED', '待我处理'], ['RELATED_TO_ME', '与我相关'], ['SYSTEM', '系统通知']], onChange: value => { setCategory(value); setPage(1) } }),
      h('label', null, h('input', { type: 'checkbox', checked: unread, onChange: event => { setUnread(event.target.checked); setPage(1) } }), '只看未读'),
      h(GhostButton, { disabled: action.busy, onClick: () => { void action.run('/finance/notifications/read-all', { category }).catch(() => {}) } }, '本分类全部标为已读')),
    h(Notice, null, action.notice),
    h(Card, { title: '通知列表' }, h(FinanceResource, { resource: list }, h(Table, { tableId: 'finance-notifications', rows: financeRows(list.data), empty: '暂无通知', columns: [
      ...financeColumns([['title', '标题'], ['detail', '详情'], ['status', '业务状态'], ['createdAt', '时间']]),
      { key: 'readAt', label: '阅读状态', render: row => row.readAt ? '已读' : '未读' },
      { key: 'actions', label: '操作', sortable: false, render: row => h('div', { className: 'sf-row' },
        !row.readAt ? h(GhostButton, { disabled: action.busy, onClick: () => { void action.run(`/finance/notifications/${row.id}/read`).catch(() => {}) } }, '标为已读') : null,
        row.linkPath ? h(GhostButton, { onClick: () => onDrill(financeNotificationTarget(row.linkPath), { sourcePath: row.linkPath }) }, '查看业务') : null) },
    ] })), h(Pager, { page, total: list.data?.total, limit: 20, onPage: setPage })),
    h('p', { className: 'sf-note' }, '标记已读只改变阅读状态，不会确认、发布或完成对应业务。'))
}
function financeNotificationTarget(path) {
  if (path.startsWith('/review')) return 'review'
  if (path.startsWith('/budget-engine')) return 'engine'
  if (path.startsWith('/budget')) return 'budget'
  if (path.startsWith('/cash')) return 'cash'
  if (path.startsWith('/cost-engineering')) return 'bom'
  if (path.startsWith('/settings/finance-permissions')) return 'permissions'
  if (path.startsWith('/data-entry')) return 'entry'
  if (path.startsWith('/alerts')) return 'alerts'
  return 'overview'
}
