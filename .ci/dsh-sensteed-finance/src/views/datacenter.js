// 片段 5/7 视图：数据中心（配置、手动同步、指标、同步批次、质量清单与导入批次）

function DataCenterView({ ctx, t }) {
  const { revision } = ctx
  const canManage = ctx.financeWriter && ctx.permissions.includes('finance.source.review')
  const request = useRef(0)
  const [configs, setConfigs] = useState(null)
  const [runs, setRuns] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [quality, setQuality] = useState(null)
  const [batches, setBatches] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [loadState, setLoadState] = useState('loading')
  const [configDialog, setConfigDialog] = useState(null)
  const [syncForm, setSyncForm] = useState({ scope: 'HEADQUARTERS', bizSystem: 'OA', docType: 'PURCHASE', tableMappingKey: 'OA/PURCHASE' })
  const [syncResult, setSyncResult] = useState(null)

  const load = () => {
    const sequence = ++request.current
    setLoadState('loading'); setQuality(null); setRuns(null); setMetrics(null); setConfigs(null)
    Promise.allSettled([
      api('/data-source-configs?limit=50'),
      api('/data-source-runs?limit=20'),
      api('/data-source-metrics?days=7'),
      api('/quality'),
    ]).then(results => {
      if (request.current !== sequence) return
      const [configsResult, runsResult, metricsResult, qualityResult] = results
      setConfigs(configsResult.status === 'fulfilled' ? (configsResult.value.data ?? { list: [] }) : null)
      setRuns(runsResult.status === 'fulfilled' ? (runsResult.value.data ?? { list: [] }) : null)
      setMetrics(metricsResult.status === 'fulfilled' ? (metricsResult.value.data ?? []) : null)
      setQuality(qualityResult.status === 'fulfilled' ? qualityResult.value : null)
      const failed = results.filter(result => result.status === 'rejected').length
      setLoadState(failed === results.length ? 'error' : failed ? 'partial' : 'ready')
    })
  }
  useEffect(() => { load(); return () => { request.current++ } }, [revision]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveConfig = async form => {
    setBusy(true); setNotice(null)
    try {
      await post('/data-source-configs', form)
      setNotice(t('saved'))
      setConfigDialog(null)
      load()
      return true
    } catch (error) {
      setNotice(`${t('opFailed')}: ${error.message}`)
      return false
    } finally { setBusy(false) }
  }

  const toggle = async config => {
    setBusy(true); setNotice(null)
    try {
      await post(`/data-source-configs/${config.id}/active`, { active: !config.active })
      setNotice(t('saved'))
      load()
    } catch (error) { setNotice(`${t('opFailed')}: ${error.message}`) } finally { setBusy(false) }
  }

  const sync = async () => {
    if (!syncForm.bizSystem.trim()) return
    setBusy(true); setNotice(null); setSyncResult(null)
    try {
      const response = await post('/data-source-sync', {
        scope: syncForm.scope,
        bizSystem: syncForm.bizSystem.trim(),
        docType: syncForm.docType.trim() || undefined,
        tableMappingKey: syncForm.tableMappingKey.trim() || undefined,
      })
      setSyncResult(response.data)
      setNotice(t('syncDone'))
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


  const scopeOptions = [['HEADQUARTERS', t('scopeHq')], ['HEZHONG', t('scopeHezhong')]]
  const systemOptions = [['OA', 'OA'], ['NC', 'NC'], ['ERP', 'ERP']]
  const docOptions = [['PURCHASE', t('docPurchase')], ['REIMBURSEMENT', t('docReimbursement')], ['INCOME', t('docIncome')]]
  const mappingOptions = [['OA/PURCHASE', 'OA / 采购'], ['NC/PURCHASE', 'NC / 采购'], ['ERP/PURCHASE', 'ERP / 采购']]

  return h('div', { className: 'sf-view' },
    h(FinanceDataAssets, { ctx }),
    h(Card, { title: '数据流转与追溯' }, h('p', { className: 'sf-note' }, '数据资产 → 采集来源 → 暂存记录 → 核对发布 → 正式事实。来源采集成功不代表已发布，正式预算事实从预算执行查看。'), h('div', { className: 'sf-row' }, h(GhostButton, { onClick: () => ctx.onNavigate('sources', { year: String(ctx.year) }) }, '查看来源暂存'), h(GhostButton, { onClick: () => ctx.onNavigate('facts', { year: String(ctx.year) }) }, '核对发布与正式事实'))),
    notice ? h(Notice, null, notice) : null,
    loadState === 'loading' ? h('div', { className: 'sf-loading', role: 'status' }, h(Glyph, { name: 'loading' }), t('dataCenterLoading')) : null,
    loadState === 'error' ? h('div', { className: 'sf-fatal', role: 'alert' }, h('strong', null, t('dataCenterFailed')), h('p', { className: 'sf-note' }, t('loadPartial')), h(GhostButton, { onClick: load }, t('dataCenterRetry'))) : null,
    loadState === 'partial' ? h('div', { className: 'sf-banner sf-banner-amber', role: 'status' }, h(Glyph, { name: 'warning', size: 14 }), t('dataCenterPartial'), h(GhostButton, { onClick: load }, t('dataCenterRetry'))) : null,
    h('div', { className: 'sf-dc-summary' },
      h('article', { className: 'sf-dc-stat' }, h('span', null, t('qualityIssues')), h('strong', null, quality ? formatNumber(issueTotal) : '—'), h('small', null, `${t('qualityCritical')} ${quality ? formatNumber(criticalTotal) : '—'} · ${t('qualityWarn')} ${quality ? formatNumber(warnTotal) : '—'}`)),
      h('article', { className: 'sf-dc-stat' }, h('span', null, '最近同步（最多20条）'), h('strong', null, runs ? formatNumber(runList.length) : '—'), h('small', null, `${t('latestSync')} ${shortDate(runList[0]?.runAt ?? runList[0]?.startedAt) ?? '—'}`)),
      h('article', { className: 'sf-dc-stat' }, h('span', null, '最近导入批次（最多20条）'), h('strong', null, quality ? formatNumber(batchList.length) : '—'), h('small', null, `${t('successRows')} ${formatNumber(batchList.reduce((sum, row) => sum + (finite(row.successRows) ?? 0), 0)) ?? '0'}`))),
    canManage ? h(Card, { title: t('dsManualSync'), actions: h('span', { className: 'sf-card-unit' }, t('dsRouteHint')) },
      h('div', { className: 'sf-stack' },
        h('div', { className: 'sf-inline-form' },
          h(FormRow, { label: t('dsScope') }, h(Select, { value: syncForm.scope, onChange: value => setSyncForm(current => ({ ...current, scope: value })), options: scopeOptions })),
          h(FormRow, { label: t('bizSystem') }, h(SearchSelect, { value: syncForm.bizSystem, onChange: value => setSyncForm(current => ({ ...current, bizSystem: value })), options: systemOptions, allowCustom: true, placeholder: t('bizSystem') })),
          h(FormRow, { label: t('docType') }, h(SearchSelect, { value: syncForm.docType, onChange: value => setSyncForm(current => ({ ...current, docType: value })), options: docOptions, allowCustom: true, placeholder: t('docType') })),
          h(FormRow, { label: t('tableMapping') }, h(SearchSelect, { value: syncForm.tableMappingKey, onChange: value => setSyncForm(current => ({ ...current, tableMappingKey: value })), options: mappingOptions, allowCustom: true, placeholder: t('tableMapping') })),
        ),
        h('div', { className: 'sf-row-between' }, h('span', { className: 'sf-note' }, t('dsSyncHint')), h(PrimaryButton, { busy, disabled: !syncForm.bizSystem.trim(), onClick: sync }, t('syncNow'))),
        syncResult ? h('div', { className: 'sf-note', role: 'status' }, `${t('syncFetched')} ${syncResult.fetched ?? 0} · ${t('dsTransport')} ${financeLabel(syncResult.transport)} · ${t('processingStage')} ${financeDisplayValue(syncResult.stage, 'stage')}${syncResult.batchId ? ` · ${syncResult.batchId}` : ''}`) : null,
      )) : null,
    h(Card, { title: t('dsConfigs'), actions: canManage ? h(PrimaryButton, { busy, onClick: () => setConfigDialog({}) }, h(Glyph, { name: 'plus', size: 12 }), t('dsAdd')) : null }, h(React.Fragment, null,
      h(Table, { tableId: 'finance-DataCenterView-configs', minColumns: '900px',
        columns: [
          { label: t('dsScope'), key: 'scope', render: row => row.scope === 'HEADQUARTERS' ? t('scopeHq') : t('scopeHezhong') },
          { label: t('dsKind'), key: 'kind', render: row => row.kind === 'DSS' ? t('kindDss') : t('kindFeishu') },
          { label: t('dataset'), key: 'displayName' },
          { label: t('dsEndpoint'), key: 'endpoint', render: row => row.endpoint ? `${row.endpoint}${row.secretRef ? ` · ${row.secretRef}` : ''}` : row.secretRef ? `凭证引用 ${row.secretRef}` : '—' },
          { label: t('updatedAt'), key: 'updatedAt', render: row => shortDate(row.updatedAt) ?? '—' },
          { label: t('statusCol'), key: 'active', render: row => h(Pill, { tone: row.active ? 'green' : 'muted' }, row.active ? t('dsEnabled') : t('dsDisable') ) },
          { label: t('actions'), key: 'actions', sortable: false, render: row => canManage ? h('div', { className: 'sf-row' }, h(LinkButton, { disabled: busy, onClick: () => setConfigDialog(row) }, t('edit')), h(LinkButton, { disabled: busy, onClick: () => toggle(row) }, row.active ? t('dsDisable') : t('dsEnable'))) : null },
        ],
        rows: configs?.list || [], empty: configs ? t('noSourceConfig') : t('empty'), rowKey: 'id',
      }), configs?.list?.length ? null : h('p', { className: 'sf-note' }, t('noSourceConfigHint')))),
    h(Card, { title: `${t('dsMetrics')} · ${t('last7Days')}` }, h(Table, { tableId: 'finance-DataCenterView-metrics',
      columns: [
        { label: t('dsScope'), key: 'scope', render: row => row.scope === 'HEADQUARTERS' ? t('scopeHq') : t('scopeHezhong') },
        { label: t('dsKind'), key: 'transport', render: row => row.transport === 'DSS' ? t('kindDss') : t('kindFeishu') },
        { label: t('successRate'), key: 'successRate', num: true, render: row => `${row.successRate ?? 0}%` },
        { label: t('fallbackRate'), key: 'fallbackRate', num: true, render: row => `${row.fallbackRate ?? 0}%` },
        { label: t('emptyRate'), key: 'emptyResultRate', num: true, render: row => `${row.emptyResultRate ?? 0}%` },
        { label: t('avgDuration'), key: 'avgDurationMs', num: true, render: row => `${row.avgDurationMs ?? 0} 毫秒` },
        { label: t('latestSync'), key: 'lastSuccessAt', render: row => shortDate(row.lastSuccessAt) ?? '—' },
      ], rows: metrics || [], empty: metrics ? t('empty') : t('loading'),
    })),
    h('div', { className: 'sf-two-col' },
      h(Card, { title: '最近同步（最多20条）' }, h(Table, { tableId: 'finance-DataCenterView-runs', minColumns: '1200px',
        columns: [
          { label: t('startedAt'), key: 'startedAt', render: row => shortDate(row.startedAt) ?? '—' },
          { label: t('dsScope'), key: 'scope', render: row => row.scope === 'HEADQUARTERS' ? t('scopeHq') : t('scopeHezhong') },
          { label: t('bizSystem'), key: 'bizSystem', render: row => financeLabel(row.bizSystem) },
          { label: t('docType'), key: 'docType', render: row => financeLabel(row.docType) },
          { label: t('dsTransport'), key: 'transportUsed', render: row => financeLabel(row.transportUsed) },
          { label: t('dsFallback'), key: 'fallbackReason', render: row => row.fallbackReason ? h(Badge, { tone: 'amber' }, financeLabel(row.fallbackReason, '回退原因待核查')) : '—' },
          { label: t('batchStatus'), key: 'status', render: row => h(Pill, { tone: runTone(row) }, financeDisplayValue(row.status, 'syncStatus')) },
          { label: t('processingStage'), key: 'stage', render: row => financeDisplayValue(row.stage, 'stage') },
          { label: t('batchId'), key: 'batchId', render: row => row.batchId ?? '—' },
          { label: t('dataSummary'), key: 'stats', render: row => runStats(row.stats) },
          { label: t('errorSummary'), key: 'errorSummary', render: row => row.errorSummary ? h('span', { className: 'sf-text-danger' }, financeErrorText(row.errorSummary)) : '—' },
        ], rows: runList, empty: t('empty'), rowKey: 'id',
      })),
      h(Card, { title: t('qualityTitle') }, h(Table, { tableId: 'finance-DataCenterView-quality',
        columns: [
          { label: t('dataset'), key: 'dataset', render: row => financeLabel(row.dataset) },
          { label: t('issue'), key: 'label' },
          { label: t('count'), key: 'count', num: true },
          { label: t('severity'), key: 'severity', sortValue: row => ({ INFO: 0, WARN: 1, CRITICAL: 2 }[row.severity] ?? 0), render: row => h(SeverityBadge, { severity: row.severity === 'CRITICAL' ? 'CRITICAL' : row.severity === 'WARN' ? 'WARN' : 'INFO', t }) },
          { key: 'repair', label: '修复入口', render: row => h(GhostButton, { onClick: () => { const target = financeQualityDestination(row); ctx.onNavigate(target.tab, target.params) } }, '查看对应明细') },
        ], rows: issues, empty: quality ? t('empty') : '质量清单未加载，不能据此判断没有问题',
      }))),
    h(Card, { title: '最近导入批次（最多20条）' }, h(Table, { tableId: 'finance-DataCenterView-batches',
      columns: [
        { label: t('bizType'), key: 'bizType', render: row => financeLabel(row.bizType, '业务类型待核查') },
        { label: t('sourceFile'), key: 'sourceFile' },
        { label: t('rows'), key: 'totalRows', num: true },
        { label: t('successRows'), key: 'successRows', num: true },
        { label: t('failedRows'), key: 'failedRows', num: true },
          { label: t('batchStatus'), key: 'status', render: row => financeDisplayValue(row.status, 'syncStatus') },
        { label: t('startedAt'), key: 'startedAt', render: row => shortDate(row.startedAt) ?? '—', num: true },
      ], rows: batchList, empty: t('empty'),
    })),
    configDialog ? h(DataSourceConfigDialog, { config: configDialog.id ? configDialog : null, busy, t, onClose: () => setConfigDialog(null), onSave: saveConfig }) : null,
  )
}

function runStats(stats) {
  if (!stats) return '—'
  const labels = { fetched: '采集', inserted: '新增', updated: '更新', duplicated: '重复', rejected: '待核对' }
  const values = Object.entries(stats).filter(([key, value]) => labels[key] && typeof value === 'number').map(([key, value]) => `${labels[key]} ${value}`)
  return values.length ? values.join(' / ') : '—'
}

function DataSourceConfigDialog({ config, busy, t, onClose, onSave }) {
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({
    scope: config?.scope || 'HEADQUARTERS', kind: config?.kind || 'DSS', displayName: config?.displayName || '',
    endpoint: config?.endpoint || '', secretRef: config?.secretRef || '',
    tableMappingsText: config?.tableMappings ? JSON.stringify(config.tableMappings, null, 2) : '', active: config?.active ?? true,
  })
  const submit = () => {
    if (!form.displayName.trim()) { setFormError(t('required')); return }
    let tableMappings
    if (form.tableMappingsText.trim()) {
      try { tableMappings = JSON.parse(form.tableMappingsText) } catch { setFormError(t('invalidJson')); return }
    }
    setFormError('')
    onSave({ scope: form.scope, kind: form.kind, displayName: form.displayName.trim(), endpoint: form.endpoint.trim() || undefined, secretRef: form.secretRef.trim() || undefined, tableMappings, active: form.active })
  }
  return h(Dialog, { title: config ? t('dsEdit') : t('dsAdd'), dismissDisabled: busy, onClose: busy ? undefined : onClose, footer: [
    h(GhostButton, { key: 'cancel', disabled: busy, onClick: onClose }, t('cancel')),
    h(PrimaryButton, { key: 'save', busy, disabled: !form.displayName.trim(), onClick: submit }, t('save')),
  ] },
    h('fieldset', { className: 'sf-stack sf-fieldset', disabled: busy },
      h('div', { className: 'sf-inline-form' },
        h(FormRow, { label: t('dsScope') }, h(Select, { value: form.scope, onChange: value => setForm(current => ({ ...current, scope: value })), options: [['HEADQUARTERS', t('scopeHq')], ['HEZHONG', t('scopeHezhong')]], disabled: Boolean(config) })),
        h(FormRow, { label: t('dsKind') }, h(Select, { value: form.kind, onChange: value => setForm(current => ({ ...current, kind: value })), options: [['DSS', t('kindDss')], ['FEISHU', t('kindFeishu')]], disabled: Boolean(config) })),
      ),
      h(FormRow, { label: t('dataset') }, h(Field, { value: form.displayName, onChange: value => setForm(current => ({ ...current, displayName: value })), placeholder: t('dsNamePlaceholder'), maxLength: 100 })),
      h(FormRow, { label: t('dsEndpoint') }, h(Field, { value: form.endpoint, onChange: value => setForm(current => ({ ...current, endpoint: value })), placeholder: t('dsEndpointPlaceholder'), maxLength: 500 })),
      h(FormRow, { label: t('secretRef') }, h(Field, { value: form.secretRef, onChange: value => setForm(current => ({ ...current, secretRef: value })), placeholder: t('secretRefHint'), maxLength: 100 })),
      h(FormRow, { label: t('tableMappings') }, h(Textarea, { value: form.tableMappingsText, onChange: value => setForm(current => ({ ...current, tableMappingsText: value })), rows: 5, placeholder: '{"OA/PURCHASE":"tblXXX"}' })),
      formError ? h('p', { className: 'sf-note sf-neg', role: 'alert' }, formError) : null,
      h('div', { className: 'sf-row-between' }, h('span', null, t('dsEnabled')), h(Switch, { checked: form.active, onChange: value => setForm(current => ({ ...current, active: value })), label: t('dsEnabled') })),
      h('p', { className: 'sf-note' }, t('secretRefHint')),
    ))
}

function financeQualityDestination(issue) {
  const year = String(new Date().getFullYear()), unassigned = String(issue.label).includes('未分配')
  return issue.dataset === 'budget_line' ? { tab: 'budget', params: { year, orgId: '', view: 'lines', unassigned } }
    : issue.dataset === 'payment_plan' ? { tab: 'cash', params: { year, orgId: '', view: 'plans', unassigned } }
    : { tab: 'cash', params: { year, orgId: '', view: 'summary' } }
}
function FinanceDataAssets({ ctx }) {
  const year = String(new Date().getFullYear())
  const budget = useFinanceResource(`/finance/budget/lines?year=${year}&page=1&limit=1`, ctx.revision)
  const pr = useFinanceResource('/finance/payment-requests?page=1&limit=1', ctx.revision)
  const plans = useFinanceResource('/finance/payment-plans?page=1&limit=1', ctx.revision)
  const revenues = useFinanceResource('/finance/revenue-plans?page=1&limit=1', ctx.revision)
  const datasets = [
    [budget, `${year}年主版本预算`, '仅当年正式主版本，不含草稿与其他版本', 'budget', { year, orgId: '', view: 'lines' }],
    [pr, '付款申请PR（已打 / 预计）', '全部年度付款申请记录', 'budget', { year, orgId: '', view: 'ledger' }],
    [plans, '付款计划', '全部年度付款计划记录', 'cash', { year, orgId: '', view: 'plans' }],
    [revenues, '收入计划', '全部年度收入计划记录', 'cash', { year, orgId: '', view: 'revenue' }],
  ]
  const totals = datasets.map(([resource]) => !resource.error && !resource.loading ? finite(resource.data?.total) : null)
  return h(Card, { title: '数据集入库规模' },
    h('p', { className: 'sf-note' }, '预算为当年正式主版本；PR、付款与收入计划为全部年度。下钻默认进入当年，可在明细切换年度。统计取服务端总数，不以当前页条数代替。'),
    h('div', { className: 'sf-row' }, h('strong', null, `四大类合计：${totals.every(total => total !== null) ? formatNumber(totals.reduce((sum, value) => sum + value, 0)) : '—'} 行`), h('span', null, `财务主体 / 业务线（不含集团）：${ctx.orgs.filter(row => row.type !== 'GROUP').length}`)),
    ...datasets.map(([resource, label, note, tab, params], index) => h('div', { key: label, className: 'sf-row-between' }, h('div', null, h('strong', null, label), h('p', { className: 'sf-note' }, note)), h('div', { className: 'sf-row' }, h('span', null, totals[index] === null ? '—' : `${formatNumber(totals[index])} 行`), h(GhostButton, { onClick: () => ctx.onNavigate(tab, params) }, '查看明细')))),
    ...datasets.filter(([resource]) => resource.error).map(([resource, label]) => h('div', { key: label, role: 'alert' }, `${label}统计加载失败，未知不计为零。`, h(GhostButton, { onClick: resource.retry }, '重试'))))
}
