// 片段 5/7 视图：预警（4 统计卡 + 规则集确认横幅 + 明细筛选分页 + 证据快照 Dialog + 按类型下钻）

// 服务端 alertType 枚举 → 中文文案键（与预警引擎产出枚举一致）
const ALERT_TYPES = [
  ['BUDGET_OVERRUN', 'typeOverrun'], ['EXECUTION_SLOW', 'typeSlow'], ['CASH_GAP', 'typeCashGap'], ['DATA_QUALITY', 'typeQuality'],
]
const alertTypeLabel = (value, t) => financeEnumLabel(value, t, Object.fromEntries(ALERT_TYPES))
const ALERT_STATUS_OPTIONS = [['OPEN', 'stPending'], ['CONFIRMED', 'stConfirmed'], ['RESOLVED', 'stResolved'], ['IGNORED', 'stIgnored'], ['', 'stAll']]

function AlertsView({ ctx, t, onDrill }) {
  const { year, orgId, revision } = ctx
  const [filters, setFilters] = useState({ severity: ctx.drillParams?.severity || '', alertType: ctx.drillParams?.alertType || '', month: ctx.drillParams?.month || '', status: ctx.drillParams?.status || 'OPEN' })
  const [activeStat, setActiveStat] = useState('')
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [detail, setDetail] = useState(null)
  const [statusDialog, setStatusDialog] = useState(null)

  const [reloadTick, setReloadTick] = useState(0)
  const params = new URLSearchParams({ year, page: String(page), limit: String(PAGE_SIZE), ...filters })
  if (orgId) params.set('orgId', orgId)
  for (const key of [...params.keys()]) if (!params.get(key)) params.delete(key)
  const summaryResource = useFinanceResource(`/finance/alerts/summary?year=${year}${orgId ? `&orgId=${encodeURIComponent(orgId)}` : ''}`, `${revision}-${reloadTick}`)
  const rulesResource = useFinanceResource('/finance/alert-rules', `${revision}-${reloadTick}`)
  const rowsResource = useFinanceResource(`/finance/alerts?${params}`, `${revision}-${reloadTick}`)
  const summary = summaryResource.data
  const rules = rulesResource.data
  const rows = rowsResource.data
  const load = () => setReloadTick(value => value + 1)
  const scanLock = useRef(false)
  const runEngine = async () => {
    if (scanLock.current) return
    scanLock.current = true
    setBusy(true); setNotice(null)
    try {
      const result = await post('/alerts/run', {})
      const data = result.data || {}
      setNotice(t('runDone').replace('{created}', data.created ?? 0).replace('{updated}', data.updated ?? 0).replace('{resolved}', data.resolved ?? 0))
      load()
    } catch (error) { setNotice(`${t('opFailed')}: ${error.message}`) } finally { scanLock.current = false; setBusy(false) }
  }

  const activeRuleSet = (rules?.list || []).find(item => item.status === 'ACTIVE')
  const statCards = [
    ['critical', summary?.critical ?? '—', 'rose', 'sevCritical'],
    ['warn', summary?.warn ?? '—', 'amber', 'sevWarn'],
    ['info', summary?.info ?? '—', 'sky', 'sevInfo'],
    ['resolved', summary?.resolved ?? '—', 'green', 'sevResolved'],
  ]
  const alertRows = rows?.list || []

  const drillTarget = alert => {
    const params = { year: String(alert.year || year), orgId: alert.orgId || '', ...(alert.month ? { month: String(alert.month) } : {}) }
    if (alert.alertType === 'CASH_GAP') return ['cash', { ...params, view: 'summary' }]
    return ['budget', { ...params, view: 'lines', ...(!alert.orgId || alert.alertType === 'DATA_QUALITY' ? { orgId: '', unassigned: true } : {}) }]
  }

  return h('div', { className: 'sf-view' },
    h('div', { className: 'sf-row-between' },
      h('div', { className: 'sf-stats' },
        ...statCards.map(([key, value, tone, labelKey]) => h(StatCard, {
          key, label: t(labelKey), value, tone,
          active: activeStat === key,
          onClick: () => {
            const severity = key === 'resolved' ? '' : key.toUpperCase()
            setActiveStat(activeStat === key ? '' : key)
            setPage(1)
            setFilters(f => ({ ...f, severity, status: key === 'resolved' ? 'RESOLVED' : 'OPEN' }))
          },
        }))),
      ctx.financeWriter ? h(PrimaryButton, { busy, onClick: runEngine }, h(Glyph, { name: 'refresh', size: 12 }), busy ? t('running') : t('runEngine')) : null),
    notice ? h(Notice, null, notice) : null,
    ...[summaryResource, rulesResource].filter(resource => resource.error || resource.loading).map((resource, key) => h(FinanceResource, { key, resource })),
    rules ? h('div', { className: `sf-banner ${activeRuleSet ? 'sf-banner-green' : 'sf-banner-amber'}`, role: 'status' },
      h(Glyph, { name: 'shield', size: 14 }),
      activeRuleSet
        ? t('rulesConfirmed').replace('{v}', String(activeRuleSet.version)).replace('{date}', shortDate(activeRuleSet.confirmedAt) ?? '—')
        : t('rulesUnconfirmed'),
      !activeRuleSet && ctx.role === 'FINANCE_OWNER' ? h(PrimaryButton, { onClick: () => post('/alert-rules/confirm', {}).then(load).catch(error => setNotice(`${t('opFailed')}: ${error.message}`)) }, t('confirmDefaultRules')) : null) : null,
    h('div', { className: 'sf-filters' },
      h(Select, { 'aria-label': '预警类型', value: filters.alertType, onChange: value => { setPage(1); setFilters(f => ({ ...f, alertType: value })) }, options: ALERT_TYPES.map(([id, key]) => [id, t(key)]), placeholder: '全部类型' }),
      h(Select, { 'aria-label': '预警月份', value: filters.month, onChange: value => { setPage(1); setFilters(f => ({ ...f, month: value })) }, options: Array.from({ length: 12 }, (_, i) => [String(i + 1), `${i + 1}月`]), placeholder: '全部月份' }),
      h(Select, { value: filters.severity, onChange: value => { setPage(1); setFilters(f => ({ ...f, severity: value })) }, options: [['CRITICAL', t('sevCritical')], ['WARN', t('sevWarn')], ['INFO', t('sevInfo')]], placeholder: t('severity') }),
      h(Select, { value: filters.status, onChange: value => { setPage(1); setFilters(f => ({ ...f, status: value })) }, options: ALERT_STATUS_OPTIONS.map(([id, key]) => [id, t(key)]), placeholder: t('stAll') })),
    h(Card, { title: t('alertsTitle') }, h(FinanceResource, { resource: rowsResource }, h(Table, { tableId: 'finance-AlertsView-1',
      columns: [
        { label: t('severity'), key: 'severity', sortValue: row => ({ INFO: 0, WARN: 1, CRITICAL: 2 }[row.severity] ?? 0), render: row => h(SeverityBadge, { severity: row.severity, t }) },
        { label: t('alertType'), key: 'alertType', render: row => alertTypeLabel(row.alertType, t) },
        { label: t('alertTitleCol'), key: 'title', stickyLeft: false },
        { label: t('detail'), key: 'detail', render: row => h('span', { style: { whiteSpace: 'normal', wordBreak: 'break-all', display: 'block', maxWidth: 420, textAlign: 'left' } }, row.detail ?? '—') },
        { label: t('org'), key: 'orgName' },
        { key: 'actions', label: '处理状态', sortable: false, render: row => ctx.financeWriter ? h(GhostButton, { onClick: event => { event.stopPropagation(); setStatusDialog(row) } }, '处理预警') : '只读' },
        { label: t('lastSeen'), key: 'lastSeenAt', render: row => shortDate(row.lastSeenAt) ?? '—', num: true },
      ],
      rows: alertRows, empty: t('empty'),
      onRowClick: row => setDetail(row), rowKey: 'id',
    })), h(Pager, { page, total: rows?.total, limit: PAGE_SIZE, onPage: setPage })),
    statusDialog ? h(FinanceFormDialog, { title: '更新预警处理状态', initial: { status: statusDialog.status }, fields: [{ key: 'status', label: '处理状态', options: [['OPEN', '待处理'], ['CONFIRMED', '已确认'], ['RESOLVED', '已解决'], ['IGNORED', '已忽略']], required: true }, { key: 'note', label: '处理说明' }], onClose: () => setStatusDialog(null), onSubmit: async body => { await financeRest(`/finance/alerts/${statusDialog.id}/status`, 'PATCH', body); load() } }) : null,
    detail ? h(Dialog, { title: t('alertDetail'), onClose: () => setDetail(null) },
      h('div', { className: 'sf-stack' },
        h('div', { className: 'sf-row' }, h(SeverityBadge, { severity: detail.severity, t }), h(Pill, { tone: 'muted' }, alertTypeLabel(detail.alertType, t) ?? '—'), h('span', { className: 'sf-note' }, `${shortDate(detail.firstSeenAt) ?? '—'} → ${shortDate(detail.lastSeenAt) ?? '—'}`)),
        h('p', { className: 'sf-note' }, detail.detail ?? detail.title ?? ''),
        detail.evidence && Object.keys(detail.evidence).length ? h('div', null, h('strong', null, t('evidence')), h(FinanceEvidence, { value: detail.evidence })) : null,
        h('div', { className: 'sf-row' }, h(PrimaryButton, { onClick: () => { const [tab, params] = drillTarget(detail); setDetail(null); onDrill(tab, params) } }, t('viewSource'))))) : null,
  )
}
