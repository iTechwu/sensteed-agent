// 片段 5/7 视图：总览（对齐前端 overview-section：5 KPI + 月度趋势 + 主体执行 + 收支达成 + 预警 TOP5）

function OverviewView({ brief, t, onDrill, orgId, workQueue }) {
  if (!brief) return h(EmptyState, null, t('empty'))
  const data = brief.data || brief
  const overview = data.overview || {}
  const m = overview.metrics || {}
  const trend = overview.trend || []
  const alertsSummary = data.alertsSummary || {}
  const cashList = data.cash?.list || []
  const cashTotals = cashList.reduce((acc, row) => {
    acc.plannedIncome += finite(row.plannedIncome) ?? 0
    acc.actualIncome += finite(row.actualIncome) ?? 0
    acc.plannedExpense += finite(row.plannedExpense) ?? 0
    acc.actualExpense += finite(row.actualExpense) ?? 0
    return acc
  }, { plannedIncome: 0, actualIncome: 0, plannedExpense: 0, actualExpense: 0 })
  const exec = execRateOf(m.prSubmittedAmount, m.prEstimatedAmount, m.budgetAmount)
  const trendData = trend.map(point => ({
    label: String(point.month).padStart(2, '0'),
    prSubmitted: finite(point.prSubmittedAmount),
    paid: finite(point.paidAmount),
  }))
  const openAlerts = (data.openAlerts || alertsSummary.top || []).slice(0, 5)
  const workItems = workQueue?.state === 'loading' ? null : [
    {
      id: 'filing', icon: 'plan', tone: 'blue', label: t('pendingFiling'), hint: t('pendingFilingHint'), value: (workQueue?.tasks?.list || []).filter(item => item.status !== 'CLOSED').length, target: 'entry',
    },
    {
      id: 'quality', icon: 'database', tone: 'amber', label: t('pendingQuality'), hint: t('pendingQualityHint'), value: (workQueue?.quality?.issues || []).reduce((sum, item) => sum + (finite(item.count) ?? 0), 0), target: 'datacenter',
    },
    {
      id: 'alerts', icon: 'warning', tone: 'rose', label: t('pendingAlerts'), hint: t('pendingAlertsHint'), value: workQueue?.alerts?.total ?? alertsSummary.total ?? 0, target: 'alerts',
    },
  ]
  const workbench = h('section', { className: 'sf-workbench', 'aria-labelledby': 'sf-workbench-title' },
    h('div', { className: 'sf-workbench-head' },
      h('div', null,
        h('h2', { id: 'sf-workbench-title' }, t('workbenchTitle')),
        h('p', null, t('workbenchHint'))),
      workQueue?.state === 'partial' ? h('span', { className: 'sf-workbench-status' }, t('loadPartial')) : null),
    workItems
      ? h('div', { className: 'sf-work-items' }, ...workItems.map(item => h('button', {
        type: 'button', key: item.id, className: `sf-work-item is-${item.tone}`, onClick: () => onDrill(item.target),
      },
        h('span', { className: 'sf-work-icon' }, h(Glyph, { name: item.icon, size: 15 })),
        h('span', { className: 'sf-work-copy' }, h('strong', null, item.label), h('small', null, item.hint)),
        h('b', null, item.value))))
      : h('div', { className: 'sf-work-items is-loading', role: 'status' }, ...[1, 2, 3].map(index => h('div', { key: index, className: 'sf-work-skeleton' }))))
  return h('div', { className: 'sf-view' },
    h('div', { className: 'sf-scopebar' },
      h('span', null, `${orgId ? t('scopeOrg') : t('scopeAll')} · ${data.year ?? ''} ${t('scopeYear')} · ${t('unitNote')}`),
      h('span', null, `${t('kpiExecRate')} =（${t('kpiPrSubmitted')}+${t('kpiPrEstimated')}）/${t('kpiBudget')}`)),
    workbench,
    h('div', { className: 'sf-kpis' },
      h(KpiCard, { icon: 'data', label: t('kpiBudget'), value: yuan(m.budgetAmount), onClick: () => onDrill('budget') }),
      h(KpiCard, { icon: 'plan', label: t('kpiPrSubmitted'), value: yuan(m.prSubmittedAmount), hint: `${t('kpiExecRate')} ${ratio(exec, 1) ?? '—'}`, onClick: () => onDrill('budget', { view: 'ledger' }) }),
      h(KpiCard, { icon: 'clock', label: t('kpiPrEstimated'), value: yuan(m.prEstimatedAmount), onClick: () => onDrill('budget', { view: 'ledger' }) }),
      h(KpiCard, { icon: 'goal', label: t('kpiPaid'), value: yuan(m.paidAmount), hint: `${t('kpiPaid')}/${t('kpiBudget')} ${ratio(m.paidAmount, m.budgetAmount) ?? '—'}`, onClick: () => onDrill('cash') }),
      h(KpiCard, {
        icon: 'warning', label: t('kpiAlerts'), value: alertsSummary.total ?? 0,
        hint: `${t('sevCritical')} ${alertsSummary.critical ?? 0} · ${t('sevWarn')} ${alertsSummary.warn ?? 0}`,
        hintTone: alertsSummary.critical > 0 ? 'down' : alertsSummary.warn > 0 ? 'warn' : 'up',
        negative: alertsSummary.critical > 0, onClick: () => onDrill('alerts'),
      })),
    h('div', { className: 'sf-overview-grid' },
      h(Card, { title: t('trendTitle'), unit: t('unitNote') },
        h(GroupedBars, {
          data: trendData,
          series: [
            { key: 'prSubmitted', label: t('kpiPrSubmitted'), tone: 'a' },
            { key: 'paid', label: t('kpiPaid'), tone: 'b' },
          ],
          onBarClick: point => onDrill('budget', { view: 'month', month: Number(point.label) }),
        })),
      h(Card, { title: t('orgSummary') }, h(Table, {
        columns: [
          { label: t('org'), key: 'orgName', stickyLeft: true },
          { label: t('kpiBudget'), render: row => wan(row.budgetAmount) ?? '—', num: true },
          { label: t('kpiPrSubmitted'), render: row => wan(row.prSubmittedAmount) ?? '—', num: true },
          { label: t('kpiPaid'), render: row => wan(row.paidAmount) ?? '—', num: true },
          {
            label: t('kpiExecRate'), num: true,
            render: row => {
              const rate = execRateOf(row.prSubmittedAmount, row.prEstimatedAmount, row.budgetAmount)
              if (rate === null) return '—'
              const level = heatLevel(rate)
              return h('span', { className: `sf-heat sf-heat-${level}` }, ratio(rate, 1))
            },
          },
          {
            label: '', width: 120,
            render: row => {
              const rate = execRateOf(row.prSubmittedAmount, row.prEstimatedAmount, row.budgetAmount)
              const level = heatLevel(rate)
              return h(Progress, { value: rate, tone: level === 'over' ? 'rose' : level === 'healthy' ? 'green' : level === 'slow' ? 'amber' : undefined })
            },
          },
        ],
        rows: overview.byOrg || [], empty: t('empty'),
      })),
      h('div', { className: 'sf-two-col' },
        h(Card, { title: t('incomeAch'), unit: t('unitNote') },
          h('div', { className: 'sf-stack' },
            h('div', null, h('div', { className: 'sf-row-between' }, h('span', { className: 'sf-kpi-value' }, yuan(cashTotals.actualIncome) ?? '—'), h('span', { className: 'sf-note' }, `${t('planCol')} ${yuan(cashTotals.plannedIncome) ?? '—'} · ${t('achieve')} ${ratio(cashTotals.plannedIncome ? cashTotals.actualIncome / cashTotals.plannedIncome : null, 1) ?? '—'}`)), h(Progress, { value: cashTotals.plannedIncome ? cashTotals.actualIncome / cashTotals.plannedIncome : null, tone: 'green' })),
            h('div', null, h('div', { className: 'sf-row-between' }, h('span', { className: 'sf-kpi-value' }, yuan(cashTotals.actualExpense) ?? '—'), h('span', { className: 'sf-note' }, `${t('planCol')} ${yuan(cashTotals.plannedExpense) ?? '—'} · ${t('achieve')} ${ratio(cashTotals.plannedExpense ? cashTotals.actualExpense / cashTotals.plannedExpense : null, 1) ?? '—'}`)), h(Progress, { value: cashTotals.plannedExpense ? cashTotals.actualExpense / cashTotals.plannedExpense : null, tone: 'amber' })))),
        h(Card, { title: t('alertSummary'), actions: [h(LinkButton, { key: 'more', onClick: () => onDrill('alerts') }, t('drill'))] }, h(Table, {
          columns: [
            { label: t('severity'), render: row => h(SeverityBadge, { severity: row.severity, t }) },
            { label: t('alertTitleCol'), key: 'title' },
            { label: t('org'), key: 'orgName' },
          ],
          rows: openAlerts, empty: t('empty'),
        })))))
}
