function SourcesView({ ctx }) {
  const [scope, setScope] = useFinanceViewState(ctx, 'scope', 'HEADQUARTERS')
  const [runId, setRunId] = useFinanceViewState(ctx, 'runId', '')
  const [runPage, setRunPage] = useFinanceViewState(ctx, 'runPage', 1)
  const [selectedRun, setSelectedRun] = useFinanceViewState(ctx, 'selectedRun', null)
  const [searchInput, setSearchInput] = useFinanceViewState(ctx, 'searchInput', '')
  const [search, setSearch] = useFinanceViewState(ctx, 'search', '')
  const [page, setPage] = useFinanceViewState(ctx, 'page', 1)
  const [selected, setSelected] = useState(null)
  const params = new URLSearchParams({ scope, page: String(page), limit: '20' })
  if (runId) params.set('runId', runId)
  if (search) params.set('search', search)
  const records = useFinanceResource(`/data-source/records?${params}`, ctx.revision)
  const runs = useFinanceResource(`/data-source/runs?scope=${scope}&page=${runPage}&limit=20`, ctx.revision)
  const runRows = financeRows(runs.data)
  const runOptions = selectedRun && !runRows.some(row => row.id === selectedRun.id) ? [selectedRun, ...runRows] : runRows
  const rows = financeRows(records.data)
  const fieldLabels = new Map(rows.flatMap(row => (row.fields || []).map(field => [field.key, field.label])))
  return h('div', { className: 'sf-stack' }, h(GhostButton, { onClick: () => ctx.onNavigate('datacenter') }, '返回数据中心'), h('p', { className: 'sf-banner sf-banner-amber' }, '来源暂存用于核对与追溯，采集成功不代表已审核发布，不计入正式财务指标。'),
    h('div', { className: 'sf-row' }, h(Select, { 'aria-label': '来源范围', value: scope, options: [['HEADQUARTERS', '总部'], ['HEZHONG', '合众']], onChange: value => { setScope(value); setRunId(''); setRunPage(1); setSelectedRun(null); setPage(1); setSelected(null) } }),
      h(Select, { 'aria-label': '同步批次', value: runId, options: runOptions.map(row => [row.id, `${financeLabel(row.bizSystem)} ${row.batchId || row.startedAt}`]), placeholder: '全部批次', onChange: value => { setRunId(value); setSelectedRun(runOptions.find(row => row.id === value) || null); setPage(1); setSelected(null) } }),
      h('form', { className: 'sf-row', onSubmit: event => { event.preventDefault(); setSearch(searchInput.trim()); setPage(1); setSelected(null) } }, h(Field, { 'aria-label': '来源记录搜索', value: searchInput, onChange: setSearchInput, placeholder: '单据号或关键词', maxLength: 100 }), h(GhostButton, { type: 'submit' }, '搜索'))),
    h(FinanceResource, { resource: runs }, h('div', { 'aria-label': '来源批次分页' }, h('p', { className: 'sf-note' }, '来源批次每页20条，可翻页查找；翻页保留当前批次筛选。'), h(Pager, { page: runPage, total: runs.data?.total, limit: 20, onPage: setRunPage }))),
    h(Card, { title: '来源记录' }, h(FinanceResource, { resource: records }, h(Table, { tableId: `finance-source-${scope}`, rows, empty: '暂无来源记录', onRowClick: setSelected, columns: [
      ...financeColumns([['sourceDocNo', '单据号'], ['tableName', '来源表'], ['revision', '修订版本'], ['createdAt', '入库时间']]),
      { key: 'category', label: '财务分类', render: row => `${financeDisplayValue(row.financialAnalysis?.category || '未分类', 'category')} · ${row.financialAnalysis?.level || '层级待核对'}` },
      { key: 'primaryAmount', label: '主金额 / 单位 / 币种', sortValue: row => row.financialAnalysis?.primaryAmount?.amount, render: row => row.financialAnalysis?.primaryAmount ? `${formatNumber(row.financialAnalysis.primaryAmount.amount)} ${row.financialAnalysis.primaryAmount.unit} · ${row.financialAnalysis.primaryAmount.currency}` : '主金额未提供' },
      ...[...fieldLabels].map(([key, label]) => ({ key: `field:${key}`, label, sortValue: row => sourceCellText(row.fields?.find(field => field.key === key)?.value), render: row => sourceCellText(row.fields?.find(field => field.key === key)?.value, label) })),
    ] })), h(Pager, { page, total: records.data?.total, limit: 20, onPage: setPage })),
    selected ? h(Dialog, { title: `来源详情：${selected.sourceDocNo}`, onClose: () => setSelected(null) }, h(FinanceEvidence, { value: selected.financialAnalysis }), h(Table, { tableId: 'finance-source-detail', rows: selected.fields || [], columns: [{ key: 'label', label: '字段' }, { key: 'value', label: '值', render: row => sourceCellText(row.value, row.label) }], empty: '无来源字段' })) : null)
}
function sourceCellText(value, label = '') {
  if (value == null || value === '') return '—'
  if (typeof value !== 'object') {
    const raw = String(value)
    if (/日期|时间|date|time/i.test(label) && /^\d{10}(\d{3})?$/.test(raw)) return new Date(Number(raw) * (raw.length === 10 ? 1000 : 1)).toLocaleString('zh-CN', { hour12: false })
    return raw
  }
  if (Array.isArray(value)) return value.map(item => sourceCellText(item, label)).join('；')
  return sourceCellText(value.text ?? value.name ?? value.value ?? JSON.stringify(value), label)
}
