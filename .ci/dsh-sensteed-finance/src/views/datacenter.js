// 片段 5/7 视图：数据中心（数据源配置控制台 + 同步批次 + 数据集规模 + 质量清单 + 导入批次）

function DataCenterView({ ctx, t }) {
  const { revision } = ctx
  const [configs, setConfigs] = useState(null)
  const [runs, setRuns] = useState(null)
  const [quality, setQuality] = useState(null)
  const [batches, setBatches] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [loadState, setLoadState] = useState('loading')

  const load = () => {
    setLoadState('loading')
    Promise.allSettled([api('/data-source-configs'), api('/data-source-runs?limit=20'), api('/quality')]).then(results => {
      const [configsResult, runsResult, qualityResult] = results
      setConfigs(configsResult.status === 'fulfilled' ? (configsResult.value.data ?? { list: [] }) : null)
      setRuns(runsResult.status === 'fulfilled' ? (runsResult.value.data ?? { list: [] }) : null)
      setQuality(qualityResult.status === 'fulfilled' ? qualityResult.value : null)
      const failed = results.filter(result => result.status === 'rejected').length
      setLoadState(failed === results.length ? 'error' : failed ? 'partial' : 'ready')
    })
  }
  useEffect(() => { load() }, [revision]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async config => {
    setBusy(true); setNotice(null)
    try {
      await post(`/data-source-configs/${config.id}/active`, { active: !config.active })
      setNotice(t('saved'))
      load()
    } catch (error) { setNotice(`${t('opFailed')}: ${error.message}`) } finally { setBusy(false) }
  }

  const issues = quality?.quality?.issues || []
  const batchList = quality?.batches?.list || []
  const runList = runs?.list || []
  const runTone = run => run.status === 'SUCCESS' ? 'green' : run.status === 'FAILED' ? 'rose' : 'amber'
  const issueTotal = issues.reduce((sum, issue) => sum + (finite(issue.count) ?? 0), 0)
  const criticalTotal = issues.filter(issue => issue.severity === 'CRITICAL').reduce((sum, issue) => sum + (finite(issue.count) ?? 0), 0)
  const warnTotal = issues.filter(issue => issue.severity === 'WARN').reduce((sum, issue) => sum + (finite(issue.count) ?? 0), 0)

  if (loadState === 'error') {
    return h('div', { className: 'sf-view' },
      h('div', { className: 'sf-fatal', role: 'alert' }, h(Glyph, { name: 'warning' }), h('strong', null, t('dataCenterFailed')), h('p', { className: 'sf-note' }, t('loadPartial')), h(GhostButton, { onClick: load }, t('dataCenterRetry'))))
  }

  return h('div', { className: 'sf-view' },
    notice ? h(Notice, null, notice) : null,
    loadState === 'loading' ? h('div', { className: 'sf-loading', role: 'status' }, h(Glyph, { name: 'loading' }), t('dataCenterLoading')) : null,
    loadState === 'partial' ? h('div', { className: 'sf-banner sf-banner-amber', role: 'status' }, h(Glyph, { name: 'warning', size: 14 }), t('dataCenterPartial'), h(GhostButton, { onClick: load }, t('dataCenterRetry'))) : null,
    h('div', { className: 'sf-dc-summary' },
      h('article', { className: 'sf-dc-stat' }, h('span', null, t('qualityIssues')), h('strong', null, formatNumber(issueTotal) ?? '0'), h('small', null, `${t('qualityCritical')} ${formatNumber(criticalTotal) ?? '0'} · ${t('qualityWarn')} ${formatNumber(warnTotal) ?? '0'}`)),
      h('article', { className: 'sf-dc-stat' }, h('span', null, t('dsRuns')), h('strong', null, formatNumber(runList.length) ?? '0'), h('small', null, `${t('latestSync')} ${shortDate(runList[0]?.runAt ?? runList[0]?.startedAt) ?? '—'}`)),
      h('article', { className: 'sf-dc-stat' }, h('span', null, t('batchesTitle')), h('strong', null, formatNumber(batchList.length) ?? '0'), h('small', null, `${t('successRows')} ${formatNumber(batchList.reduce((sum, row) => sum + (finite(row.successRows) ?? 0), 0)) ?? '0'}`))),
    h(Card, { title: t('dsConfigs') }, h(React.Fragment, null, h(Table, {
      columns: [
        { label: t('dsScope'), render: row => row.scope === 'HEADQUARTERS' ? t('scopeHq') : t('scopeHezhong') },
        { label: t('dsKind'), render: row => row.kind === 'DSS' ? t('kindDss') : t('kindFeishu') },
        { label: t('dataset'), key: 'displayName' },
        { label: t('dsEndpoint'), render: row => row.endpoint ?? '—' },
        { label: t('statusCol'), render: row => h(Pill, { tone: row.active ? 'green' : 'muted' }, row.active ? t('dsEnabled') : t('dsDisable')) },
        { label: t('actions'), render: row => h(LinkButton, { onClick: () => toggle(row) }, row.active ? t('dsDisable') : t('dsEnable')) },
      ],
      rows: configs?.list || [], empty: configs ? t('noSourceConfig') : t('empty'), rowKey: 'id',
    }), configs?.list?.length ? null : h('p', { className: 'sf-note' }, t('noSourceConfigHint')))),
    h('div', { className: 'sf-two-col' },
      h(Card, { title: t('dsRuns') }, h('div', { className: 'sf-timeline' },
        runList.length ? runList.map((run, index) => h('div', { key: run.id ?? index, className: 'sf-timeline-row' },
          h('span', { className: `sf-timeline-dot is-${runTone(run)}` }),
          h('div', { className: 'sf-timeline-main' },
            h('span', null, `${run.bizSystem ?? '—'} · ${run.scope ?? ''}`),
            h('small', null, `${shortDate(run.runAt ?? run.startedAt) ?? ''}${run.fallbackReason ? ` · ${t('dsFallback')}: ${run.fallbackReason}` : ''}`)),
          h(Pill, { tone: runTone(run) }, run.status ?? '—'))) : h(EmptyState, null, t('empty')))),
      h(Card, { title: t('qualityTitle') }, h(Table, {
        columns: [
          { label: t('dataset'), key: 'dataset' },
          { label: t('issue'), key: 'label' },
          { label: t('count'), key: 'count', num: true },
          { label: t('severity'), render: row => h(SeverityBadge, { severity: row.severity === 'CRITICAL' ? 'CRITICAL' : row.severity === 'WARN' ? 'WARN' : 'INFO', t }) },
        ],
        rows: issues, empty: t('empty'),
      }))),
    h(Card, { title: t('batchesTitle') }, h(Table, {
      columns: [
        { label: t('bizType'), key: 'bizType' },
        { label: t('sourceFile'), key: 'sourceFile' },
        { label: t('rows'), key: 'totalRows', num: true },
        { label: t('successRows'), key: 'successRows', num: true },
        { label: t('failedRows'), key: 'failedRows', num: true },
        { label: t('batchStatus'), key: 'status' },
        { label: t('startedAt'), render: row => shortDate(row.startedAt) ?? '—', num: true },
      ],
      rows: batchList, empty: t('empty'),
    })))
}
