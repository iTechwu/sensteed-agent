function SourcesView({ ctx }) {
  const [scope, setScope] = useState('HEADQUARTERS')
  const [runId, setRunId] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null)
  const params = new URLSearchParams({ scope, page: String(page), limit: '20' })
  if (runId) params.set('runId', runId)
  if (search) params.set('search', search)
  const records = useFinanceResource(`/data-source/records?${params}`, ctx.revision)
  const runs = useFinanceResource(`/data-source/runs?scope=${scope}&limit=100`, ctx.revision)
  const rows = financeRows(records.data)
  const fieldLabels = new Map(rows.flatMap(row => (row.fields || []).map(field => [field.key, field.label])))
  return h('div', { className: 'sf-stack' }, h('p', { className: 'sf-banner sf-banner-amber' }, '来源暂存用于核对与追溯，采集成功不代表已审核发布，不计入正式财务指标。'),
    h('div', { className: 'sf-row' }, h(Select, { 'aria-label': '来源范围', value: scope, options: [['HEADQUARTERS', '总部'], ['HEZHONG', '合众']], onChange: value => { setScope(value); setRunId(''); setPage(1); setSelected(null) } }),
      h(Select, { 'aria-label': '同步批次', value: runId, options: financeRows(runs.data).map(row => [row.id, `${row.bizSystem} ${row.batchId || row.startedAt}`]), placeholder: '全部批次', onChange: value => { setRunId(value); setPage(1) } }),
      h('form', { className: 'sf-row', onSubmit: event => { event.preventDefault(); setSearch(searchInput.trim()); setPage(1) } }, h(Field, { 'aria-label': '来源记录搜索', value: searchInput, onChange: setSearchInput, placeholder: '单据号或关键词', maxLength: 100 }), h(GhostButton, { type: 'submit' }, '搜索'))),
    h(Card, { title: '来源记录' }, h(FinanceResource, { resource: records }, h(Table, { tableId: `finance-source-${scope}`, rows, empty: '暂无来源记录', onRowClick: setSelected, columns: [
      ...financeColumns([['sourceDocNo', '单据号'], ['tableName', '来源表'], ['revision', '修订版本'], ['createdAt', '入库时间']]),
      { key: 'category', label: '财务分类', render: row => row.financialAnalysis?.category || '未分类' },
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
