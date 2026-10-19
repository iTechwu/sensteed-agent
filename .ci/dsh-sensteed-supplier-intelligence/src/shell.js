function Workbench() {
  const bridge = supplierNavigation()
  const [tab, setTab, externalNavigation] = bridge.usePage()
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [access, setAccess] = useState(null)
  const [accessReason, setAccessReason] = useState('')
  const [scopeReady, setScopeReady] = useState(false)
  const [unread, setUnread] = useState(0)
  const openRecords = (id, status = '') => {
    const filters = id === 'suppliers'
      ? { 'supplier-query': '', 'supplier-filter': '', 'supplier-page': 1 }
      : { [`${id}-status`]: status, [`${id}-page`]: 1, [`${id}-detail`]: '', [`${id}-supplier-filter`]: '' }
    for (const [key, value] of Object.entries(filters)) panelMemory[`${currentScopeId}:${key}`] = value
    setTab(id)
  }
  const accessRequest = useRef(null)
  const retryAccess = () => {
    accessRequest.current?.abort()
    const controller = new AbortController(), generation = bridge.epoch
    accessRequest.current = controller
    setAccess(null)
    setAccessReason('')
    fetch(`${BASE}/access`, { credentials: 'same-origin', redirect: 'error', signal: AbortSignal.any([controller.signal, bridge.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) })
      .then(response => response.json())
      .then(body => { if (controller.signal.aborted || generation !== bridge.epoch) return; adoptScope(body?.scopeId); setScopeReady(Boolean(body?.scopeId)); setAccessReason(body?.reason || 'unavailable'); setAccess(body?.allowed === true) })
      .catch(() => { if (controller.signal.aborted || generation !== bridge.epoch) return; setAccessReason('connection_unavailable'); setAccess(false) })
  }
  useEffect(() => {
    const refreshEvent = () => refresh()
    const suppliersEvent = () => setTab('suppliers')
    const scopeEvent = () => { setSelected(''); setEvidence(''); setTab('overview'); refresh() }
    const agentError = () => { setError('Agent 会话暂不可用，工作台仍可继续查看和编辑。') }
    window.addEventListener('supplier-risk:refresh', refreshEvent)
    window.addEventListener('supplier-risk:open-suppliers', suppliersEvent)
    window.addEventListener('supplier-risk:scope-changed', scopeEvent)
    window.addEventListener('supplier-risk:agent-error', agentError)
    return () => {
      window.removeEventListener('supplier-risk:refresh', refreshEvent)
      window.removeEventListener('supplier-risk:open-suppliers', suppliersEvent)
      window.removeEventListener('supplier-risk:scope-changed', scopeEvent)
      window.removeEventListener('supplier-risk:agent-error', agentError)
    }
  }, [])
  useEffect(() => { retryAccess(); return () => accessRequest.current?.abort() }, [])
  // Synchronous reload lock: bursts of refresh events must not stack revisions.
  const loadingRef = useRef(false)
  const refresh = () => {
    if (loadingRef.current) return
    loadingRef.current = true
    setError('')
    setRevision(value => value + 1)
    setTimeout(() => { loadingRef.current = false }, 400)
  }
  useEffect(() => {
    if (access === true) bridge.publish(TABS.map(([id, label]) => ({ id, label })), tab, id => { setError(''); setTab(id) })
    else if (access === false && !bridge.accessUnavailable(accessReason) && bridge.getSnapshot().status !== 'denied') bridge.invalidate()
  })
  useEffect(() => () => bridge.clearSource(), [])
  if (access === null) return h('main', { className: 'sr-page', role: 'status' }, '正在连接供应链工作台…')
  if (!access) return h('main', { className: 'sr-page' }, h('h1', null, '供应商风险'), h('p', null, accessMessage(accessReason)), h('button', { type: 'button', className: 'sr-button sr-secondary', onClick: retryAccess }, '重新连接'))
  return h('main', { className: 'sr-page' },
    h('header', { className: 'sr-header' },
      h('div', null, h('p', { className: 'sr-eyebrow' }, 'SUPPLIER INTELLIGENCE'), h('h1', null, '供应商风险'), h('p', { className: 'sr-subtitle' }, '查看供应商风险变化，核验线索，评估交付与经营影响。')),
      h('button', { type: 'button', className: 'sr-icon-button', 'aria-label': '刷新数据', title: '刷新数据', onClick: refresh }, h(IconRefreshOutlineRegular, { size: 18 }))),
    !externalNavigation ? h('nav', { className: 'sr-tabs', 'aria-label': '供应商风险页面' }, ...TABS.map(([id, label]) => h('button', {
      key: id, type: 'button', 'aria-current': tab === id ? 'page' : undefined,
      onClick: () => { setError(''); setTab(id) },
    }, label, id === 'weekly' && unread > 0 ? h('span', { className: 'sr-unread' }, unread) : null))) : null,
    error ? h('div', { className: 'sr-error', role: 'alert' }, error, h('button', { type: 'button', onClick: refresh }, '重试')) : null,
    h('section', { className: 'sr-content' },
      tab === 'overview' ? h(Overview, { revision, setError, onUnread: setUnread, onNavigate: openRecords, onOpen: (id, name) => { setSelected(id, name); setTab('business') } }) : null,
      tab === 'suppliers' ? h(Suppliers, { revision, setError, onSelect: (id, name) => { setSelected(id, name); setTab('business') }, onImported: refresh }) : null,
      tab === 'enterprise' ? h(Evidence, { kind: 'enterprise', revision, setError, onSelect: row => { setSelected(row.supplierId, row.supplierName); setEvidence(row.evidenceId, 'enterprise', row.eventId); setTab('business') } }) : null,
      tab === 'media' ? h(Evidence, { kind: 'media', revision, setError, onSelect: row => { setSelected(row.supplierId, row.supplierName); setEvidence(row.evidenceId, 'media', row.eventId); setTab('business') } }) : null,
      tab === 'business' ? h(Business, { revision, setError, onScopeReady: scopeReady }) : null,
      tab === 'weekly' ? h(Weekly, { revision, setError, onUnread: setUnread, onScopeReady: scopeReady }) : null))
}

function accessMessage(reason) {
  return {
    login_required: '请先完成 Sensteed 登录，再连接供应商风险工作台。',
    plugin_disabled: '供应商风险插件已关闭，请在插件设置中启用后重试。',
    entitlement_required: '当前账号未获得供应链数据权限，请联系管理员开通。',
    credential_unavailable: '本机 Models 凭据不可用，请重新登录后重试。',
    supply_chain_unavailable: '供应链 MCP 当前未连接，请稍后重试。',
    connection_unavailable: '本地工作台连接失败，请重新连接。',
  }[reason] || '当前插件、凭据或供应链 MCP 暂不可用。'
}

function setSelected(value, name = '') {
  if (value !== selectedSupplier) setEvidence('')
  selectedSupplier = value
  selectedSupplierName = name
}
function setEvidence(value, kind = '', eventId = '') { selectedEvidence = value; selectedEvidenceKind = kind; selectedEvidenceEventId = eventId }

function useLoad(loader, deps, setError) {
  const [state, setState] = useState({ loading: true, data: null })
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setState({ loading: true, data: null, error: null })
    loader(controller.signal).then(data => { if (active) setState({ loading: false, data }) })
      .catch(error => { if (active) { setState({ loading: false, data: null, error: errorText(error) }); setError(errorText(error)) } })
    return () => { active = false; controller.abort() }
  }, deps)
  return state
}

function Loading({ state, empty }) {
  if (state.loading && !state.data) return h('p', { className: 'sr-muted', role: 'status', 'aria-busy': true }, '正在读取已归集数据…')
  if (state.error) return h('p', { className: 'sr-muted', role: 'alert' }, state.error)
  if (!state.data) return h('p', { className: 'sr-muted' }, empty || '暂无可显示的数据。')
  return null
}

function Metric({ label, value, hint, onClick }) {
  return h(onClick ? 'button' : 'div', { className: 'sr-metric', ...(onClick ? { type: 'button', onClick, 'aria-label': `${label} ${value ?? '—'}，查看记录` } : {}) }, h('span', null, label), h('strong', null, value ?? '—'), hint ? h('small', null, hint) : null)
}

function Overview({ revision, setError, onUnread, onOpen, onNavigate }) {
  const state = useLoad(() => api('supply_chain_workbench_overview_get'), [revision], setError)
  const value = state.data
  if (!value) return h(Loading, { state })
  const counts = value.counts || {}
  const changes = value.changes || []
  const sourceGapCount = (value.sources || []).filter(source => source.status !== 'available' || source.stale).length
  return h(React.Fragment, null,
    h('div', { className: 'sr-metrics' },
      h(Metric, { label: '供应商', value: counts.suppliers ?? 0, hint: '查看供应商台账', onClick: () => onNavigate('suppliers') }),
      h(Metric, { label: '高优先级事项', value: counts.priorityItems ?? 0, hint: '已确认风险，见近期变化' }),
      h(Metric, { label: '待核验线索', value: counts.pendingClues ?? 0, hint: '工商与媒体线索合计' }),
      h(Metric, { label: '来源缺口', value: value.sources?.length ? sourceGapCount : '—', hint: value.sources?.length ? `统计于 ${fmt(value.statisticsAt)}` : '暂无覆盖统计' })),
    h('div', { className: 'sr-filter-bar' }, h('span', { className: 'sr-muted' }, '下一步'), h('button', { type: 'button', className: 'sr-button sr-secondary', onClick: () => onNavigate('enterprise', 'PENDING_REVIEW') }, '核对工商与司法线索'), h('button', { type: 'button', className: 'sr-button sr-secondary', onClick: () => onNavigate('media', 'PENDING_REVIEW') }, '核验媒体线索')),
    h('div', { className: 'sr-columns' },
      h('section', { className: 'sr-section' }, h('h2', null, '近期变化'),
        changes.length ? h('div', { className: 'sr-list' }, ...changes.slice(0, 10).map((item, index) => h('button', { type: 'button', className: 'sr-list-row', key: item.evidenceId || item.eventId || index, onClick: () => onOpen(item.supplierId, item.supplierName) },
          h('span', { className: 'sr-status', 'data-tone': item.isConfirmed ? 'confirmed' : 'candidate' }, item.isConfirmed ? '已确认' : '待核验'),
          h('span', null, h('strong', null, item.supplierName || item.supplierId), h('small', null, item.title || item.summary || '证据摘要未提供')),
          h('time', null, fmt(item.riskPromptedAt || item.retrievedAt))))) : h('p', { className: 'sr-muted' }, '暂无已记录的风险变化。可先查看供应商台账，确认来源覆盖与更新时间。')),
      h('section', { className: 'sr-section' }, h('h2', null, '来源覆盖'), !(value.sources || []).length ? h('p', { className: 'sr-muted' }, '暂无来源覆盖记录。请先核对供应商台账；不能据此判断风险较低。') : null,
        ...(value.sources || []).map(source => h('div', { className: 'sr-source', key: source.sourceId || source.source || source.name },
          h('span', null, source.name || source.platform || source.sourceId || source.source || '未命名来源'),
          h('span', { className: 'sr-status', 'data-tone': source.status === 'available' && !source.stale ? 'confirmed' : 'candidate' }, source.stale ? '数据滞后' : ({ available: '已覆盖', unavailable: '暂不可用', pending: '待接入' }[source.status] || '待核对')),
          h('small', null, source.lastSuccessAt ? `最近成功 ${fmt(source.lastSuccessAt)}` : source.reason || '暂无成功记录'))),
        h('p', { className: 'sr-source-note' }, '页面只读取已保存数据，不触发外部采集。'))),
    h('p', { className: 'sr-footnote' }, '数据来自已保存的台账与证据；暂无记录不代表没有风险。'))
}

function Suppliers({ revision, setError, onSelect, onImported }) {
  const [query, setQuery] = useRemembered('supplier-query', '')
  const [page, setPage] = useRemembered('supplier-page', 1)
  const [submitted, setSubmitted] = useRemembered('supplier-filter', '')
  const [showAdd, setShowAdd] = useRemembered('supplier-add-open', false)
  const [newName, setNewName] = useRemembered('supplier-add-name', '')
  const [importText, setImportText] = useRemembered('supplier-import-text', '')
  const [busy, setBusy] = useState(false)
  const state = useLoad(() => api('supply_chain_workbench_suppliers_list', { page, pageSize: 20, ...(submitted ? { query: submitted } : {}) }), [page, submitted, revision], setError)
  const data = state.data
  const clearFilter = () => { setQuery(''); setSubmitted(''); setPage(1) }
  const intakeTrigger = useRef(null)
  const closeIntake = () => {
    setShowAdd(false)
    requestAnimationFrame(() => intakeTrigger.current?.focus?.())
  }
  return h(React.Fragment, null,
    h('div', { className: 'sr-toolbar' }, h('form', { onSubmit: event => { event.preventDefault(); setPage(1); setSubmitted(query.trim()) } }, h('label', { className: 'sr-search' }, h(IconSearchOutlineRegular, { size: 16 }), h('input', { type: 'search', value: query, onChange: event => setQuery(event.target.value), placeholder: '搜索供应商名称或统一社会信用代码', 'aria-label': '搜索供应商' })), h('button', { type: 'submit', className: 'sr-button' }, '搜索')),
      h('div', { className: 'sr-toolbar-actions' }, h('span', { className: 'sr-muted' }, `${data?.total ?? '—'} 家供应商`), h('button', { type: 'button', className: 'sr-button sr-secondary', ref: intakeTrigger, 'aria-expanded': showAdd, onClick: () => { showAdd ? closeIntake() : setShowAdd(true) } }, showAdd ? '收起新增' : '新增 / 导入'))),
    submitted && data?.items.length > 0 ? h('div', { className: 'sr-filter-summary', role: 'status' }, `搜索“${submitted}” · 找到 ${data.total} 家供应商`, h('button', { type: 'button', className: 'sr-link', onClick: clearFilter }, '清除筛选')) : null,
    showAdd ? h('div', { role: 'region', 'aria-label': '新增或导入供应商', onKeyDown: event => { if (event.key === 'Escape') { event.stopPropagation(); closeIntake() } } },
      h(SupplierIntake, { newName, setNewName, importText, setImportText, busy, setBusy, setError, onDone: () => { setPage(1); setSubmitted(''); onImported?.(); window.dispatchEvent(new CustomEvent('supplier-risk:refresh')) } })) : null,
    h(Loading, { state }), data && data.items.length === 0 ? h('section', { className: 'sr-section sr-empty-panel', role: 'status' },
      h('h2', null, submitted ? '没有匹配的供应商' : page > 1 ? '这一页暂无供应商' : '当前团队尚未导入供应商'),
      h('p', { className: 'sr-muted' }, submitted ? '请调整供应商名称或统一社会信用代码后重试。' : page > 1 ? '台账可能已更新，请返回第一页查看。' : '若此前已录入，请先确认当前登录团队，并由管理员核对历史数据迁移，避免重复建档。'),
      submitted || page > 1 ? h('button', { type: 'button', className: 'sr-button sr-secondary', onClick: clearFilter }, submitted ? '清除筛选' : '返回第一页') :
        h('button', { type: 'button', className: 'sr-button sr-secondary', onClick: () => setShowAdd(true) }, '新增 / 导入供应商')) : null,
    data && data.items.length > 0 ? h(React.Fragment, null,
      h('div', { className: 'sr-table-wrap' }, h('table', { className: 'sr-table' }, h('thead', null, h('tr', null, ...['供应商', '统一社会信用代码', '类别', '主体核验', '监控范围', '来源覆盖', '更新时间', ''].map(label => h('th', { key: label, scope: 'col' }, label || '操作')))), h('tbody', null,
        ...data.items.map(row => h('tr', { key: row.supplierId }, h('td', null, h('strong', null, row.displayName)), h('td', null, row.creditCode || '未关联'), h('td', null, row.category || '未分类'), h('td', null, h(Status, { value: row.verificationStatus })), h('td', null, ({ LEGAL_ENTITY_ONLY: '仅法人主体', LEGAL_ENTITY_AND_SUBSIDIARIES: '法人及子公司', LEGAL_ENTITY_AND_SUBSIDIARIES_AND_INVESTMENTS: '法人、子公司及投资企业' }[row.monitoringScope] || '未设置')), h('td', null, ({ partial: '部分覆盖', complete: '完整覆盖', available: '已覆盖' }[row.coverage?.status] || '待接入')), h('td', null, fmt(row.updatedAt)), h('td', null, h('button', { type: 'button', className: 'sr-link', onClick: () => onSelect(row.supplierId, row.displayName) }, '业务影响'))))))),
      h(Pagination, { page, pageSize: 20, total: data.total, onChange: setPage })) : null)
}

async function loadSupplierOptions(signal) {
  const suppliers = []
  const seen = new Set()
  for (let page = 1; ; page++) {
    const data = await api('supply_chain_workbench_suppliers_list', { page, pageSize: 100 }, signal)
    if (!Array.isArray(data?.items) || !Number.isInteger(data.total) || data.total < 0) throw new Error('invalid_gateway_response')
    for (const supplier of data.items) {
      if (!supplier.supplierId || seen.has(supplier.supplierId)) throw new Error('supplier_list_incomplete')
      seen.add(supplier.supplierId)
      suppliers.push(supplier)
    }
    if (suppliers.length >= data.total) return suppliers
    if (!data.items.length) throw new Error('supplier_list_incomplete')
  }
}

function SupplierIntake({ newName, setNewName, importText, setImportText, busy, setBusy, setError, onDone }) {
  const [result, setResult] = useState('')
  const [runId, setRunId] = useRemembered('supplier-intake-run', '')
  const [category, setCategory] = useRemembered('supplier-add-category', '')
  const [monitoringScope, setMonitoringScope] = useRemembered('supplier-add-scope', 'LEGAL_ENTITY_ONLY')
  const run = useRun(runId)
  const [intakeMode, setIntakeMode] = useRemembered('supplier-intake-mode', 'add')
  const pending = busy || Boolean(runId && !run?.terminal)
  useEffect(() => { if (run?.terminal) window.dispatchEvent(new CustomEvent('supplier-risk:refresh')) }, [run?.terminal])
  const add = async event => {
    event.preventDefault(); setBusy(true); setError(''); setResult('')
    try {
      const created = await api('supply_chain_supplier_create', { supplier: { displayName: newName.trim(), monitoringScope, ...(category.trim() ? { category: category.trim() } : {}) }, idempotencyKey: crypto.randomUUID(), confirm: true })
      setRunId(created?.runId || '')
      setResult('新增任务已提交。')
      setNewName(''); onDone()
    } catch (error) { setError(errorText(error)) } finally { setBusy(false) }
  }
  const importCsv = async event => {
    event.preventDefault(); setBusy(true); setError(''); setResult('')
    try {
      const imported = await api('supply_chain_supplier_import', { csvText: importText, idempotencyKey: crypto.randomUUID(), confirm: true })
      setRunId(imported?.runId || '')
      setResult('导入任务已提交，正在处理。')
      setImportText(''); onDone()
    } catch (error) { setError(errorText(error)) } finally { setBusy(false) }
  }
  return h('div', { className: 'sr-intake' },
    h('div', { className: 'sr-mode-switch', 'aria-label': '录入方式' }, ...[['add', '新增一家供应商'], ['import', '批量导入 CSV']].map(([id, label]) => h('button', { key: id, type: 'button', 'aria-pressed': intakeMode === id, onClick: () => setIntakeMode(id) }, label))),
    h('form', { className: 'sr-section sr-form', hidden: intakeMode !== 'add', onSubmit: add }, h('h3', null, '新增供应商'), h('p', { className: 'sr-muted' }, '新记录进入待核验状态；关联登记主体前不会扩展企业监控。'), Field('供应商名称', h('input', { required: true, maxLength: 256, value: newName, onChange: event => setNewName(event.target.value) })), Field('供应商类别', h('input', { maxLength: 256, value: category, onChange: event => setCategory(event.target.value), placeholder: '可选' })), Field('监控范围', h('select', { value: monitoringScope, onChange: event => setMonitoringScope(event.target.value) }, h('option', { value: 'LEGAL_ENTITY_ONLY' }, '仅法人主体'), h('option', { value: 'LEGAL_ENTITY_AND_SUBSIDIARIES' }, '法人及子公司'), h('option', { value: 'LEGAL_ENTITY_AND_SUBSIDIARIES_AND_INVESTMENTS' }, '法人、子公司及投资企业'))), h('button', { type: 'submit', className: 'sr-button', disabled: pending || !newName.trim() }, '确认新增')),
    h('form', { className: 'sr-section sr-form', hidden: intakeMode !== 'import', onSubmit: importCsv }, h('h3', null, '批量导入 CSV'), h('p', { className: 'sr-muted' }, '从表格复制或粘贴 CSV 文本。首行为字段名，每行一家供应商；单次最多 20,000 个字符。'), Field('CSV 内容', h('textarea', { rows: 5, spellCheck: false, maxLength: 20000, value: importText, onChange: event => setImportText(event.target.value), placeholder: 'supplier_name,country_region,monitoring_scope,seed_source\n示例供应商,中国,LEGAL_ENTITY_ONLY,采购台账' })), h('button', { type: 'submit', className: 'sr-button sr-secondary', disabled: pending || !importText.trim() }, '确认导入')),
    (result || runId) ? h('div', { className: 'sr-intake-result', role: 'status' }, h('p', { className: 'sr-muted' }, result || '上次提交的任务'), run ? h('p', { role: run.status === 'failed' ? 'alert' : 'status' }, `状态：${runStatus(run)}${run.result?.created !== undefined ? ` · 新增 ${run.result.created} · 重复 ${run.result.duplicates || 0} · 错误 ${run.result.errorCount || 0}` : ''}${run.error?.code ? ` · ${run.error.code}` : ''}`) : runId ? h('p', null, '正在确认任务状态，请勿重复提交…') : null, run?.result?.errorsTruncated ? h('p', { className: 'sr-muted' }, '仅显示前 100 条行错误。') : null, run?.result?.rowErrors?.length ? h('ul', null, ...run.result.rowErrors.map(error => h('li', { key: `${error.row}-${error.errorCode}` }, `第 ${error.row} 行：${error.errorCode === 'INVALID_SUPPLIER_INPUT' ? '字段格式无效' : '该行未能导入'}`))) : null) : null)
}

function safeSourceUrl(value) {
  if (typeof value !== 'string') return undefined
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined } catch { return undefined }
}

function reportStatus(report) {
  if (report.status === 'succeeded') return report.isRead ? '已读' : '未读'
  return { failed: '生成失败', running: '生成中', pending: '等待生成', queued: '等待生成' }[report.status] || '状态待确认'
}

function Status({ value }) {
  const confirmed = ['CONFIRMED', 'VERIFIED', 'APPROVED', 'available'].includes(value)
  const label = { rejected: '已排除', PENDING: '待处理', FAILED: '失败', RUNNING: '处理中', REJECTED: '已排除', STALE: '需重新评估', running: '处理中', pending: '等待处理', queued: '排队中', succeeded: '已完成', failed: '失败', cancelled: '已取消', CONFIRMED: '已确认', VERIFIED: '已核验', APPROVED: '已通过', PENDING_REVIEW: '待核验', CANDIDATE: '候选', available: '可用' }[value] || value || '未知'
  return h('span', { className: 'sr-status', 'data-tone': confirmed ? 'confirmed' : 'candidate' }, label)
}

function Evidence({ kind, revision, setError, onSelect }) {
  const [page, setPage] = useRemembered(`${kind}-page`, 1)
  const [status, setStatus] = useRemembered(`${kind}-status`, '')
  const [detailId, setDetailId] = useRemembered(`${kind}-detail`, '')
  const [supplierFilter, setSupplierFilter] = useRemembered(`${kind}-supplier-filter`, '')
  const detailHeading = useRef(null)
  const evidenceTrigger = useRef(null)
  const returnToEvidence = () => { setDetailId(''); requestAnimationFrame(() => evidenceTrigger.current?.focus()) }
  const [reviewReason, setReviewReason] = useRemembered(`${kind}-review-reason:${detailId}`, '')
  const [reviewNote, setReviewNote] = useState('')
  const [reviewRunId, setReviewRunId] = useRemembered(`${kind}-review-run:${detailId}`, '')
  const reviewRun = useRun(reviewRunId)
  const [reviewBusy, setReviewBusy] = useState(false)
  const reviewPending = reviewBusy || Boolean(reviewRunId && !reviewRun?.terminal)
  const state = useLoad(() => api('supply_chain_workbench_evidence_list', { kind, page, pageSize: 20, ...(supplierFilter ? { supplierId: supplierFilter } : {}), ...(status ? { reviewStatus: status } : {}) }), [kind, page, status, supplierFilter, revision], setError)
  const detailState = useLoad(() => detailId ? api('supply_chain_workbench_evidence_get', { kind, evidenceId: detailId }) : Promise.resolve(null), [kind, detailId, revision], () => {})
  const supplierState = useLoad(signal => loadSupplierOptions(signal), [], () => {})
  const data = state.data
  const detail = detailState.data?.evidence
  useEffect(() => { setReviewNote('') }, [kind, detailId])
  useEffect(() => { if (detailId) detailHeading.current?.focus() }, [kind, detailId])
  useEffect(() => { if (reviewRun?.terminal) window.dispatchEvent(new CustomEvent('supplier-risk:refresh')) }, [reviewRun?.terminal])
  const submitReview = async decision => {
    if (!detail?.eventId || !reviewReason.trim()) return
    setReviewBusy(true); setError(''); setReviewNote('')
    try {
      const result = await api('supply_chain_risk_event_review', { eventId: detail.eventId, decision, reasonCode: reviewReason.trim(), comment: '', idempotencyKey: crypto.randomUUID(), confirm: true })
      setReviewRunId(result?.runId || '')
      setReviewNote('审核任务已提交。')
      window.dispatchEvent(new CustomEvent('supplier-risk:refresh'))
    } catch (error) { setError(errorText(error)) } finally { setReviewBusy(false) }
  }
  return h(React.Fragment, null,
    h('div', { className: 'sr-toolbar' }, h('div', null, h('h2', null, kind === 'enterprise' ? '工商与司法风险' : '媒体舆情线索'), h('p', { className: 'sr-muted' }, kind === 'enterprise' ? '查看企业登记与司法风险记录，核对主体、来源及发生时间后评估影响。' : '媒体命中属于候选线索，主体匹配不等同于事实核验。')),
      h('label', { className: 'sr-select-label' }, '核验状态', h('select', { value: status, onChange: event => { setDetailId(''); setPage(1); setStatus(event.target.value) }, 'aria-label': '按核验状态筛选' }, h('option', { value: '' }, '全部'), h('option', { value: 'PENDING_REVIEW' }, '待核验'), h('option', { value: 'CONFIRMED' }, '已确认'), h('option', { value: 'REJECTED' }, '已排除')))),
    h('div', { className: 'sr-filter-bar' }, h('label', { className: 'sr-select-label' }, '供应商', h('select', { value: supplierFilter, 'aria-label': '按供应商筛选证据', disabled: supplierState.loading, onChange: event => { setSupplierFilter(event.target.value); setPage(1); setDetailId('') } }, h('option', { value: '' }, '全部供应商'), ...(supplierState.data || []).map(row => h('option', { key: row.supplierId, value: row.supplierId }, row.displayName || '未命名供应商')), supplierFilter && !supplierState.data?.some(row => row.supplierId === supplierFilter) ? h('option', { value: supplierFilter }, '已选供应商') : null)), supplierState.error ? h('span', { className: 'sr-muted' }, '供应商选项加载失败，仍可查看当前证据。') : null, (supplierFilter || status) ? h('button', { type: 'button', className: 'sr-link', onClick: () => { setSupplierFilter(''); setStatus(''); setDetailId(''); setPage(1) } }, '清除证据筛选') : null),
    h(Loading, { state }), !detailId && data?.items?.length === 0 ? h('section', { className: 'sr-section sr-empty-panel', role: 'status' }, h('h2', null, (status || supplierFilter) ? '没有符合筛选条件的记录' : '暂无已归集证据'), h('p', { className: 'sr-muted' }, '暂无记录不代表没有风险。请核对供应商台账与来源覆盖，或调整核验状态筛选。'), status ? h('button', { type: 'button', className: 'sr-button sr-secondary', onClick: () => { setStatus(''); setPage(1) } }, '查看全部状态') : null) : null, (data || detailId) ? h(React.Fragment, null,
      h('div', { className: 'sr-evidence-list', hidden: Boolean(detailId) }, ...(data?.items || []).map(row => h('article', { className: 'sr-evidence', key: row.evidenceId },
        h('div', { className: 'sr-evidence-head' }, h(Status, { value: row.reviewStatus }), h('span', null, row.supplierName || row.supplierId), h('time', null, fmt(row.occurredAt || row.exposedAt || row.riskPromptedAt || row.retrievedAt))),
        h('h3', null, row.title || row.category || '未命名证据'), h('p', null, row.summary || row.description || '未提供摘要'),
        h('div', { className: 'sr-evidence-meta' }, h('span', null, `来源 ${row.platform || row.source || '未知'}`), row.readCount !== null && row.readCount !== undefined ? h('span', null, `阅读量 ${row.readCount}${row.readCountScope ? ` · ${row.readCountScope}` : ''}`) : null, h('span', null, `采集 ${fmt(row.retrievedAt)}`)),
        h('div', { className: 'sr-evidence-actions' }, safeSourceUrl(row.sourceUrl) ? h('a', { href: safeSourceUrl(row.sourceUrl), target: '_blank', rel: 'noreferrer' }, '查看原文', h(IconRightUpOutlineRegular, { size: 14 })) : null, h('button', { type: 'button', className: 'sr-link', onClick: event => { evidenceTrigger.current = event.currentTarget; setDetailId(row.evidenceId) } }, '查看证据'), h('button', { type: 'button', className: 'sr-link', onClick: () => onSelect(row) }, '加入业务分析'))))),
      detailId ? h('section', { className: 'sr-section sr-detail' },
        h('div', { className: 'sr-section-heading' }, h('h2', { ref: detailHeading, tabIndex: -1 }, '证据详情'), h('button', { type: 'button', className: 'sr-link', onClick: returnToEvidence }, '返回证据列表')),
        detail ? h(React.Fragment, null, h(Status, { value: detail.reviewStatus }),
        h('h3', null, detail.title || '未命名证据'), h('p', null, detail.summary || detail.description || '未提供摘要'),
        h('p', { className: 'sr-footnote' }, `主体 ${detail.supplierName || detail.supplierId} · 来源 ${detail.platform || detail.source || '未知'} · 发布时间 ${fmt(detail.exposedAt || detail.occurredAt)} · 采集时间 ${fmt(detail.retrievedAt)}`),
        safeSourceUrl(detail.sourceUrl) ? h('a', { href: safeSourceUrl(detail.sourceUrl), target: '_blank', rel: 'noreferrer' }, '打开来源') : null,
        h('div', { className: 'sr-evidence-actions' }, h('button', { type: 'button', className: 'sr-button sr-secondary', onClick: () => onSelect(detail) }, '评估这条证据的业务影响')),
        h('h3', null, '核验轨迹'), detail.reviews?.length ? h('ul', null, ...detail.reviews.map(review => h('li', { key: review.reviewId }, `${{ CONFIRMED: '已确认', REJECTED: '已排除' }[review.decision] || '已处理'} · ${review.reasonCode} · ${fmt(review.createdAt)}`))) : h('p', { className: 'sr-muted' }, '尚无人工核验记录。'),
        kind === 'media' && detail.eventId && detail.reviewStatus === 'PENDING_REVIEW' ? h('div', { className: 'sr-review-box' }, h('label', { className: 'sr-field' }, h('span', null, '核验原因'), h('input', { value: reviewReason, onChange: event => setReviewReason(event.target.value), placeholder: '例如：主体与来源已交叉核实', maxLength: 256 })), h('div', { className: 'sr-review-actions' }, h('button', { type: 'button', className: 'sr-button', disabled: reviewPending || !reviewReason.trim(), onClick: () => submitReview('CONFIRMED') }, '确认事件'), h('button', { type: 'button', className: 'sr-button sr-secondary', disabled: reviewPending || !reviewReason.trim(), onClick: () => submitReview('REJECTED') }, '排除事件')), reviewNote ? h('p', { className: 'sr-success', role: 'status' }, `${reviewNote}${reviewRun?.pollError ? ' 任务状态读取失败，正在重试，请勿重复提交。' : reviewRun?.terminal ? (reviewRun.status === 'succeeded' ? ' 核验已完成。' : ' 核验未完成，请检查后重试。') : reviewRunId ? ' 正在核验，请勿重复提交。' : ''}`) : null) : null) : h(Loading, { state: detailState })) : null,
      !detailId && data ? h(Pagination, { page, pageSize: 20, total: data.total, onChange: setPage }) : null) : null)
}

function Pagination({ page, pageSize, total, onChange }) {
  const pages = Math.max(1, Math.ceil((total || 0) / pageSize))
  return h('div', { className: 'sr-pagination' }, h('span', null, `${total || 0} 条 · 第 ${page} / ${pages} 页`), h('div', null,
    h('button', { type: 'button', disabled: page <= 1, onClick: () => onChange(page - 1) }, '上一页'),
    h('button', { type: 'button', disabled: page >= pages, onClick: () => onChange(page + 1) }, '下一页')))
}

function useRun(runId) {
  const [state, setState] = useState({ id: '', run: null })
  useEffect(() => {
    if (!runId) return undefined
    let active = true, timer
    const controller = new AbortController()
    const poll = async () => {
      try {
        const data = await api('supply_chain_run_get', { runId }, controller.signal)
        const next = data?.run || data
        if (!active) return
        setState({ id: runId, run: next })
        if (next?.terminal !== true) timer = setTimeout(poll, Math.max(1500, (next?.pollAfterSeconds || 2) * 1000))
      } catch {
        if (active) {
          setState({ id: runId, run: { terminal: false, pollError: true } })
          timer = setTimeout(poll, 5000)
        }
      }
    }
    void poll()
    return () => { active = false; clearTimeout(timer); controller.abort() }
  }, [runId])
  return state.id === runId ? state.run : null
}

function runStatus(run) {
  if (run?.pollError) return '任务状态暂时无法读取，正在重试；请勿重复提交'
  return { succeeded: '已完成', completed: '已完成', failed: '处理失败', running: '处理中', pending: '等待处理', queued: '排队中', cancelled: '已取消' }[run?.status] || '正在确认任务状态'
}

function Business({ revision, setError, onScopeReady }) {
  const [supplierId, setSupplierId] = useState(selectedSupplier)
  const [form, setForm] = useRemembered(`business-form:${supplierId}`, null)
  const [analysis, setAnalysis] = useRemembered(`business-analysis:${supplierId}`, { dimension: 'other', externalSignal: '', possibleImpact: '', assumptions: '', informationGaps: '', suggestedActions: '', kind: 'human' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [agentBusy, setAgentBusy] = useState(false)
  const [mode, setMode] = useRemembered(`business-mode:${supplierId}`, selectedEvidence ? 'analysis' : 'context')
  useEffect(() => { if (selectedEvidence) setMode('analysis') }, [selectedEvidence])
  const supplierState = useLoad(signal => onScopeReady ? loadSupplierOptions(signal) : Promise.resolve(null), [onScopeReady], () => {})
  const state = useLoad(() => (onScopeReady && supplierId ? Promise.all([
    api('supply_chain_business_context_get', { supplierId }),
    api('supply_chain_business_analysis_list', { supplierId, page: 1, pageSize: 20 }),
    Promise.resolve(null),
    selectedEvidence ? api('supply_chain_workbench_evidence_get', { kind: selectedEvidenceKind, evidenceId: selectedEvidence }) : Promise.resolve(null),
  ]) : Promise.resolve(null)), [supplierId, revision, selectedEvidence, selectedEvidenceKind], setError)
  const context = state.data?.[0]
  const analyses = state.data?.[1]
  const supplier = supplierState.data?.find(item => item.supplierId === supplierId)
  const selectedEvidenceDetail = state.data?.[3]?.evidence
  useEffect(() => {
    if (context) setForm(current => current ?? ({ _baseVersion: context.version, category: '', criticalMaterials: [], inventoryDays: '', inTransitOrders: '', alternatives: '', alternativeCapacity: '', procurementOwner: '', logisticsOwner: '', sqeOwner: '', impactAnalysis: '', ...(context.context?.fields || {}) }))
  }, [context, form === null])
  const setField = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const saveContext = async event => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const { _baseVersion, ...draftFields } = form
      const fields = { ...draftFields, inventoryDays: form.inventoryDays === '' ? null : Number(form.inventoryDays), criticalMaterials: Array.isArray(form.criticalMaterials) ? form.criticalMaterials : String(form.criticalMaterials || '').split(/[,，\n]/u).map(item => item.trim()).filter(Boolean) }
      const saved = await api('supply_chain_business_context_save', { supplierId, expectedVersion: _baseVersion ?? context.version, fields, idempotencyKey: crypto.randomUUID(), confirm: true })
      setForm({ ...form, _baseVersion: saved.version })
      setNotice('业务背景已保存。可继续评估业务影响。')
      setRevisionAfterSave()
    } catch (error) { setError(errorText(error)) } finally { setBusy(false) }
  }
  const saveAnalysis = async event => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const evidenceIds = selectedEvidence && supplierId === selectedSupplier ? [selectedEvidenceEventId || selectedEvidence] : []
      await api('supply_chain_business_analysis_save', { supplierId, expectedVersion: analyses.total ? analyses.items[0].version : 0, backgroundVersion: context.version, evidenceVersion: context.evidenceVersion, evidenceIds, fields: analysis, idempotencyKey: crypto.randomUUID(), confirm: true })
      setNotice('人工判断已保存，可在历史分析中查看。')
      setAnalysis(current => ({ ...current, externalSignal: '', possibleImpact: '', assumptions: '', informationGaps: '', suggestedActions: '' }))
      setRevisionAfterSave()
    } catch (error) { setError(errorText(error)) } finally { setBusy(false) }
  }
  if (!supplierId) return h('section', { className: 'sr-section sr-empty-panel' }, h('h2', null, '选择要评估的供应商'), h('p', { className: 'sr-muted' }, '选择供应商后，补充业务背景或评估风险对交付与经营的影响。'),
    supplierState.data?.length ? Field('供应商', h('select', { value: '', onChange: event => { const row = supplierState.data.find(item => item.supplierId === event.target.value); if (row) { setSelected(row.supplierId, row.displayName); setSupplierId(row.supplierId) } } }, h('option', { value: '' }, '请选择供应商'), ...supplierState.data.map(row => h('option', { key: row.supplierId, value: row.supplierId }, row.displayName || '未命名供应商')))) : supplierState.data?.length === 0 ? h('p', { className: 'sr-muted', role: 'status' }, '暂无供应商，请先在台账中新增或导入。') : h(Loading, { state: supplierState }),
    h('button', { type: 'button', className: 'sr-button sr-secondary', onClick: () => window.dispatchEvent(new CustomEvent('supplier-risk:open-suppliers')) }, '浏览供应商台账'))
  if (!context || !form) return h(Loading, { state })
  return h(React.Fragment, null,
    h('div', { className: 'sr-toolbar' }, h('div', null, h('h2', null, supplier?.displayName || selectedSupplierName || '供应商详情'), h('p', { className: 'sr-muted' }, context.version ? '已保存业务背景 · 可补充或更新' : '尚未补充业务背景 · 可先填写已知信息')), h('button', { type: 'button', className: 'sr-link', onClick: () => { setSelected(''); setSupplierId('') } }, '更换供应商')),
    notice ? h('p', { className: 'sr-success', role: 'status' }, notice) : null,
    form._baseVersion !== undefined && form._baseVersion < context.version ? h('div', { className: 'sr-error', role: 'alert' }, '业务背景已在其他位置更新。当前草稿仍保留，请核对后重新填写。', h('button', { type: 'button', onClick: () => { if (window.confirm('放弃当前业务背景草稿，读取最新保存的内容？')) setForm(null) } }, '读取最新背景')) : null,
    h('div', { className: 'sr-mode-switch', 'aria-label': '业务评估步骤' }, ...[['context', '1 · 补充业务背景'], ['analysis', '2 · 评估业务影响']].map(([id, label]) => h('button', { type: 'button', key: id, 'aria-pressed': mode === id, onClick: () => setMode(id) }, label))),
    h('div', { className: 'sr-business-grid' },
      h('form', { className: 'sr-section sr-form', hidden: mode !== 'context', onSubmit: saveContext }, h('h3', null, '业务背景'), h('p', { className: 'sr-muted' }, '只保存采购、物流和质量团队提供的背景，不会改写外部证据。'),
        Field('关键物料', h('textarea', { placeholder: '填写物料名称，多个物料用逗号分隔', value: Array.isArray(form.criticalMaterials) ? form.criticalMaterials.join('，') : form.criticalMaterials, onChange: event => setField('criticalMaterials', event.target.value), rows: 2 })),
        Field('库存天数', h('input', { type: 'number', min: 0, step: 'any', placeholder: '例如：14（天），未知可留空', value: form.inventoryDays ?? '', onChange: event => setField('inventoryDays', event.target.value) })),
        Field('在途订单', h('textarea', { value: form.inTransitOrders || '', onChange: event => setField('inTransitOrders', event.target.value), rows: 2 })),
        h('details', { className: 'sr-disclosure' }, h('summary', null, '替代方案与经营影响（选填）'), Field('替代供应商', h('textarea', { value: form.alternatives || '', onChange: event => setField('alternatives', event.target.value), rows: 2 })),
        Field('替代产能', h('textarea', { value: form.alternativeCapacity || '', onChange: event => setField('alternativeCapacity', event.target.value), rows: 2 })),
        Field('经营影响', h('textarea', { value: form.impactAnalysis || '', onChange: event => setField('impactAnalysis', event.target.value), rows: 3 })),
        ), h('p', { className: 'sr-footnote' }, '切换页面会保留本次草稿。保存后才会用于 Agent 分析；退出或刷新应用前请保存。'), h('button', { type: 'submit', className: 'sr-button', disabled: busy }, busy ? '保存中…' : '保存业务背景')),
      h('section', { className: 'sr-section', hidden: mode !== 'analysis' }, h('h3', null, '业务影响评估'), h('p', { className: 'sr-muted' }, selectedEvidence ? '已关联下方证据。请区分事实、假设和可能影响。' : '从工商或媒体页面打开证据后，可在此关联分析。'),
        selectedEvidenceDetail ? h('article', { className: 'sr-selected-evidence' }, h(Status, { value: selectedEvidenceDetail.reviewStatus }), h('strong', null, selectedEvidenceDetail.title || '引用证据'), h('p', null, selectedEvidenceDetail.summary || selectedEvidenceDetail.description || '未提供摘要'), h('small', null, `来源 ${selectedEvidenceDetail.source || selectedEvidenceDetail.platform || '未知'} · 采集 ${fmt(selectedEvidenceDetail.retrievedAt)}`)) : null,
        h('form', { className: 'sr-form', onSubmit: saveAnalysis }, Field('风险维度', h('select', { value: analysis.dimension, onChange: event => setAnalysis({ ...analysis, dimension: event.target.value }) }, ...[['delivery', '交付'], ['capacity', '产能'], ['quality', '质量'], ['compliance', '合规'], ['finance', '财务'], ['other', '其他']].map(([id, name]) => h('option', { key: id, value: id }, name)))),
          Field('外部信号', textArea(analysis.externalSignal, value => setAnalysis({ ...analysis, externalSignal: value }))),
          Field('可能影响（必填）', textArea(analysis.possibleImpact, value => setAnalysis({ ...analysis, possibleImpact: value }))),
          h('details', { className: 'sr-disclosure' }, h('summary', null, '补充假设与待核实信息（选填）'), Field('假设', textArea(analysis.assumptions, value => setAnalysis({ ...analysis, assumptions: value }))),
          Field('信息缺口', textArea(analysis.informationGaps, value => setAnalysis({ ...analysis, informationGaps: value }))),
          ),
          Field('建议动作', textArea(analysis.suggestedActions, value => setAnalysis({ ...analysis, suggestedActions: value }))),
          h('button', { type: 'submit', className: 'sr-button', disabled: busy || !analysis.possibleImpact.trim() }, busy ? '保存中…' : '保存人工判断')),
        h('div', { className: 'sr-history' }, h('h3', null, '历史分析'), !analyses.items?.length ? h('p', { className: 'sr-muted' }, '暂无已保存判断。补充可能影响后保存，或交由 Agent 分析已保存的数据。') : null, ...(analyses.items || []).map(item => h('article', { key: item.id }, h('span', null, `版本 ${item.version} · ${fmt(item.createdAt)}`), item.stale ? h(Status, { value: 'STALE' }) : null, h('p', null, item.fields?.possibleImpact || '未填写影响描述')))),
        h('button', { type: 'button', className: 'sr-button sr-secondary', disabled: agentBusy || busy || state.loading, onClick: async () => { setAgentBusy(true); try { await sendSupplierAnalysis(supplierId, context, selectedEvidence) } finally { setAgentBusy(false) } } }, agentBusy ? '正在打开分析会话…' : '用已保存数据发起 Agent 分析')))
  )
}

function textArea(value, onChange) { return h('textarea', { rows: 2, value: value || '', onChange: event => onChange(event.target.value) }) }
function normalizeSupplierIds(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[,，\n]/u)
  return [...new Set(values.map(item => String(item).trim()).filter(Boolean))]
}
function Field(label, control) { return h('label', { className: 'sr-field' }, h('span', null, label), control) }
function setRevisionAfterSave() { window.dispatchEvent(new CustomEvent('supplier-risk:refresh')) }

async function sendSupplierAnalysis(supplierId, context, evidenceId) {
  try {
    const sessions = globalThis.__supplier_risk_sessions?.()
    if (!sessions) throw new Error('conversation_unavailable')
    const prompt = `请分析供应商 ${supplierId} 的供应风险。先读取当前工作台证据和业务背景，确认业务背景版本为 ${context.version}，证据版本为 ${context.evidenceVersion}${evidenceId ? `，重点查看证据 ${evidenceId}` : ''}。区分已确认事实、候选线索、人工背景、假设与信息缺口；不要把候选写成事实，不要自动发起外部采集或创建监控。给出交付、产能、质量、合规和财务影响以及可执行的核验建议。`
    await sessions.send(prompt)
    window.dispatchEvent(new CustomEvent('supplier-risk:show-agent'))
  } catch { window.dispatchEvent(new CustomEvent('supplier-risk:agent-error')) }
}

function Weekly({ revision, setError, onUnread, onScopeReady }) {
  const [reportId, setReportId] = useRemembered('weekly-report', '')
  const [historyPage, setHistoryPage] = useRemembered('weekly-history-page', 1)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [scopeQuery, setScopeQuery] = useState('')
  const [planFields, setPlanFields] = useRemembered('weekly-plan-draft', null)
  const reportHeading = useRef(null)
  const planState = useLoad(() => onScopeReady ? api('supply_chain_weekly_report_plan_get') : Promise.resolve(null), [revision, onScopeReady], setError)
  const reportsState = useLoad(() => onScopeReady ? api('supply_chain_weekly_reports_list', { page: historyPage, pageSize: 20 }) : Promise.resolve(null), [revision, historyPage, onScopeReady], setError)
  const supplierState = useLoad(signal => onScopeReady ? loadSupplierOptions(signal) : Promise.resolve(null), [revision, onScopeReady], () => {})
  const reportState = useLoad(() => onScopeReady && reportId ? api('supply_chain_weekly_report_get', { reportId }) : Promise.resolve(null), [revision, reportId, onScopeReady], () => {})
  const plan = planState.data?.plan
  const reports = reportsState.data
  const report = reportState.data?.report
  useEffect(() => { if (reportId) reportHeading.current?.focus() }, [reportId])
  const suppliers = supplierState.data || []
  const selectedIds = normalizeSupplierIds(planFields?.supplierIds)
  const unavailableIds = selectedIds.filter(id => !suppliers.some(supplier => supplier.supplierId === id))
  useEffect(() => { if (plan) setPlanFields(current => current ?? ({ ...plan, supplierIds: normalizeSupplierIds(plan.supplierIds) })) }, [plan])
  useEffect(() => { if (reports) onUnread(reports?.unreadCount || 0) }, [reports?.unreadCount])
  const savePlan = async event => {
    event.preventDefault(); setBusy(true); setNotice(''); setError('')
    try {
      const supplierIds = normalizeSupplierIds(planFields.supplierIds)
      const saved = await api('supply_chain_weekly_report_plan_save', { expectedVersion: planFields.version, fields: { enabled: planFields.enabled === true, weekday: 0, hour: 9, minute: 0, timezone: 'Asia/Shanghai', supplierIds, collectionBudget: Number(planFields.collectionBudget || 0) }, idempotencyKey: crypto.randomUUID(), confirm: true })
      if (saved?.plan) setPlanFields({ ...saved.plan })
      setNotice('周报计划已保存。')
      window.dispatchEvent(new CustomEvent('supplier-risk:refresh'))
    } catch (error) { setError(errorText(error)) } finally { setBusy(false) }
  }
  const mutateReport = async (tool, id) => {
    setBusy(true); setNotice(''); setError('')
    try {
      await api(tool, { reportId: id, confirm: true })
      setNotice(tool === 'supply_chain_weekly_report_mark_read' ? '周报已标为已读。' : '重试请求已提交，请稍后刷新查看。')
      setReportId(id); window.dispatchEvent(new CustomEvent('supplier-risk:refresh'))
    } catch (error) { setError(errorText(error)) } finally { setBusy(false) }
  }
  return h(React.Fragment, null,
    notice ? h('p', { className: 'sr-success', role: 'status' }, notice) : null,
    h('div', { className: 'sr-weekly-layout' },
      h('section', { className: 'sr-section' }, h('h2', null, '周报计划'), h('p', { className: 'sr-muted' }, '服务端每周一 09:00（Asia/Shanghai）汇总已保存事实，不会启动外部采集或模型调用。'),
        plan && planFields ? h('form', { className: 'sr-form', onSubmit: savePlan },
          planFields.version < plan.version ? h('div', { className: 'sr-error', role: 'alert' }, '计划已在其他位置更新，当前选择仍保留。', h('button', { type: 'button', onClick: () => { if (window.confirm('放弃当前计划草稿，读取最新保存的计划？')) setPlanFields({ ...plan, supplierIds: normalizeSupplierIds(plan.supplierIds) }) } }, '读取最新计划')) : null, h('label', { className: 'sr-toggle' }, h('input', { type: 'checkbox', checked: planFields.enabled === true, onChange: event => setPlanFields({ ...planFields, enabled: event.target.checked }) }), h('span', null, '启用每周风险周报')),
          h('fieldset', { className: 'sr-scope-picker', disabled: supplierState.loading || !supplierState.data },
            h('legend', null, '供应商范围'),
            h('p', { className: 'sr-footnote' }, selectedIds.length ? `已选择 ${selectedIds.length} 家供应商` : '全部供应商，包含后续新增'),
            h('label', { className: 'sr-search' }, h('input', { type: 'search', value: scopeQuery, onChange: event => setScopeQuery(event.target.value), placeholder: '搜索供应商名称', 'aria-label': '搜索周报供应商' })),
            selectedIds.length ? h('button', { type: 'button', className: 'sr-link', onClick: () => setPlanFields({ ...planFields, supplierIds: [] }) }, '改为全部供应商') : null,
            h('div', { className: 'sr-scope-options' }, ...suppliers.filter(supplier => (supplier.displayName || '').toLocaleLowerCase().includes(scopeQuery.trim().toLocaleLowerCase())).map(supplier => h('label', { key: supplier.supplierId, className: 'sr-toggle' }, h('input', { type: 'checkbox', checked: selectedIds.includes(supplier.supplierId), onChange: event => setPlanFields({ ...planFields, supplierIds: event.target.checked ? [...selectedIds, supplier.supplierId] : selectedIds.filter(id => id !== supplier.supplierId) }) }), h('span', null, supplier.displayName || '未命名供应商')))),
            scopeQuery && !suppliers.some(supplier => (supplier.displayName || '').toLocaleLowerCase().includes(scopeQuery.trim().toLocaleLowerCase())) ? h('p', { className: 'sr-muted', role: 'status' }, '没有匹配的供应商，请调整搜索词。') : null,
            unavailableIds.length ? h('p', { className: 'sr-footnote' }, `有 ${unavailableIds.length} 家已选供应商当前不可用，原选择仍保留。`) : null),
          h('small', { className: 'sr-field-hint', role: 'status' }, supplierState.loading ? '正在读取供应商台账…' : !supplierState.data ? '供应商台账读取失败，请刷新重试；已保存范围保留。' : suppliers.length ? '勾选限定范围；不勾选表示全部供应商。' : '当前团队暂无供应商，请先核对台账或历史数据迁移。'),
          h('details', { className: 'sr-disclosure' }, h('summary', null, '预算备注（选填）'), h('p', { className: 'sr-footnote' }, '仅记录预算，不会启动采集或限制支出。'), Field('采集预算记录', h('input', { type: 'number', min: 0, value: planFields.collectionBudget || 0, onChange: event => setPlanFields({ ...planFields, collectionBudget: event.target.value }) }))),
          h('p', { className: 'sr-footnote' }, `${plan.enabled ? `下次执行：${fmt(plan.nextRunAt)}` : '已保存计划：未启用'} · 当前任务：${plan.currentRunStatus ? runStatus({ status: plan.currentRunStatus }) : '无进行中的任务'}${plan.failureCode ? ' · 上次执行失败，请检查后重试' : ''}`),
          h('button', { type: 'submit', className: 'sr-button', disabled: busy }, busy ? '保存中…' : '保存计划')) : h(Loading, { state: planState })),
      h('section', { className: 'sr-section' }, h('div', { className: 'sr-section-heading' }, h('h2', null, '历史周报'), reports?.unreadCount ? h('span', { className: 'sr-unread-count' }, `未读 ${reports.unreadCount}`) : h('span', { className: 'sr-muted' }, reports?.items?.length ? '全部已读' : '暂无周报')),
        !reports ? h(Loading, { state: reportsState }) : reports.items.length ? h('div', { className: 'sr-list' }, ...reports.items.map(item => h('button', { type: 'button', className: 'sr-list-row', key: item.reportId, 'aria-pressed': reportId === item.reportId, onClick: () => setReportId(item.reportId) }, h('span', { className: 'sr-status' }, reportStatus(item)), h('span', null, h('strong', null, `${fmt(item.periodStart)} - ${fmt(item.periodEnd)}`), h('small', null, item.errorCode || item.summary || '查看报告详情')), h('time', null, fmt(item.generatedAt || item.createdAt))))) : h('p', { className: 'sr-muted' }, '暂无已生成周报。启用计划并保存后，将在下次执行时间生成首份周报。'), reports && reports.total > 20 ? h(Pagination, { page: historyPage, pageSize: 20, total: reports.total, onChange: setHistoryPage }) : null)),
    reportId ? h('section', { className: 'sr-section sr-report' }, h('div', { className: 'sr-section-heading' }, h('h2', { ref: reportHeading, tabIndex: -1 }, '周报详情'), h('div', null, h('button', { type: 'button', className: 'sr-link', onClick: () => setReportId('') }, '收起周报'), report?.status === 'failed' ? h('button', { type: 'button', className: 'sr-button sr-secondary', disabled: busy, onClick: () => mutateReport('supply_chain_weekly_report_retry', report.reportId) }, '重试原任务') : null, report?.status === 'succeeded' && !report.isRead ? h('button', { type: 'button', className: 'sr-button sr-secondary', disabled: busy, onClick: () => mutateReport('supply_chain_weekly_report_mark_read', report.reportId) }, '标为已读') : null)),
      report ? h(React.Fragment, null, h('p', { className: 'sr-muted' }, `${fmt(report.periodStart)} 至 ${fmt(report.periodEnd)} · ${report.sourcesChanged ? '来源事实已有更新，本快照保留生成时内容。' : '本报告为生成时的数据快照。'}`),
      report.content ? h(ReportContent, { content: report.content }) : h('p', { role: 'status' }, report.status === 'failed' ? '本期周报生成失败，请重试原任务。' : '周报正在生成，请稍后刷新。')) : h(Loading, { state: reportState })) : null)
}

function ReportContent({ content }) {
  return h(React.Fragment, null, h('p', { className: 'sr-report-summary' }, content.summary || '暂无摘要'),
    h('p', { className: 'sr-footnote' }, content.disclaimer || '仅展示已持久化事实与已保存判断。'),
    h('div', { className: 'sr-report-columns' }, ...[
      ['已确认风险', content.confirmedRisks], ['更新事项', content.updatedRisks], ['待核验媒体线索', content.pendingMediaClues],
    ].map(([title, rows]) => h('section', { key: title }, h('h3', null, title), rows?.length ? h('ul', null, ...rows.map((row, index) => h('li', { key: row.evidenceId || row.eventId || index }, h('strong', null, row.supplierName || row.supplierId), ` · ${row.title || row.summary || '未提供摘要'} · ${row.source || row.platform || '未知来源'} · ${fmt(row.retrievedAt)}`))) : h('p', { className: 'sr-muted' }, '本周期没有记录')))))
}

function apply(ctx) {
  ctx.effect(() => {
    const reset = () => { supplierNavigation().invalidate(); if (ctx.layout.panelInfo.getSnapshot().activePanelId === 'supplier-risk') ctx.layout.selectPanel(null) }
    window.addEventListener('sensteed:identity-changed', reset)
    return () => { window.removeEventListener('sensteed:identity-changed', reset); supplierNavigation().invalidate() }
  }, 'desktop context identity isolation')
  ctx.slots.inject('desktop.navigation.context', () => ctx.slots.register({ name: 'desktop.navigation.context', key: 'supplier-risk' }, supplierNavigation().Menu))
  const t = ctx.locale.bind('dofe.supplier-risk')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@dofe/dsh-sensteed-supplier-intelligence'
    style.textContent = css
    document.head.appendChild(style)
    return () => style.remove()
  }, 'supplier risk styles')
  ctx.effect(() => {
    globalThis.__supplier_risk_sessions = () => ({
      async send(prompt) {
        const sessions = ctx.get?.('sessions')
        const navigation = ctx.get?.('uiWorkspace')
        if (!sessions || !navigation) throw new Error('conversation_unavailable')
        const current = sessions.list.getSnapshot().ids.find(id => sessions.retainInfo(id).getSnapshot().retainedBy.mainView > 0)
        const id = current ?? await sessions.create()
        navigation.openSession(id)
        await sessions.using(id, { source: 'controllerOperation' }, async reference => {
          await reference.ready
          const scoped = sessions.scope(id)
          const conversation = scoped?.get('conversation')
          if (!conversation) throw new Error('conversation_unavailable')
          await conversation.send(prompt)
        })
      },
    })
    const onShowAgent = () => ctx.layout.selectPanel(null)
    window.addEventListener('supplier-risk:show-agent', onShowAgent)
    return () => {
      delete globalThis.__supplier_risk_sessions
      window.removeEventListener('supplier-risk:show-agent', onShowAgent)
    }
  }, 'supplier risk agent bridge')
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: 'dofe.supplier-risk' }, SupplierPage))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: PANEL_ID, order: 57, locale: 'dofe.supplier-risk', inject: () => ({ t, onOpen: () => ctx.layout.selectPanel(PANEL_ID) }) }, FooterButton))
  ctx.effect(() => ctx.locale.register('dofe.supplier-risk', { zh: { panel: '供应链管理' }, en: { panel: 'Supply chain' } }), 'supplier risk locale')
}

function FooterButton({ wide, t, onOpen }) {
  const { allowed } = supplierNavigation().useAccess(`${BASE}/access`, adoptScope)
  if (allowed === false) return null
  return h(Tooltip, { label: t('panel'), disabled: wide },
    h('button', { type: 'button', className: `sr-launcher${wide ? ' sr-wide' : ''}`, 'aria-label': t('panel'), 'aria-busy': allowed === null, onClick: onOpen },
      h(IconShieldOutlineRegular, { size: wide ? 14 : 18 }), wide ? h('span', null, t('panel')) : null))
}
exports.apply = apply
exports.inject = ['slots', 'locale', 'sessions', 'uiWorkspace', 'layout']

function SupplierPage() { const { allowed, epoch } = supplierNavigation().useAccess(`${BASE}/access`, adoptScope); return allowed !== false ? h(Workbench, { key: epoch }) : h('p', { role: 'status' }, '当前模块不可访问') }
