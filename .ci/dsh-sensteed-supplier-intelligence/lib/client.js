window.__ModuleLoader__.load({
  id: "@dofe/dsh-sensteed-supplier-intelligence",
  factory: (require) => { var module = { exports: {} }; var exports = module.exports;
    const React = require('react')
    const { createElement: h, useEffect, useState } = React
    const { Tooltip, IconShieldOutlineRegular, IconRefreshOutlineRegular, IconSearchOutlineRegular, IconRightUpOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')

    const PANEL_ID = 'supplier-risk'
    const BASE = '/api/desktop/sensteed/supplier-risk'
    const TABS = [
      ['overview', '风险总览'], ['suppliers', '供应商台账'], ['enterprise', '工商与司法'],
      ['media', '媒体舆情'], ['business', '业务影响'], ['weekly', '风险周报'],
    ]
    let selectedSupplier = ''
    let selectedEvidence = ''
    let selectedEvidenceKind = ''
    let selectedEvidenceEventId = ''
    let currentScopeId = ''
    const panelMemory = Object.create(null)

    function adoptScope(scopeId) {
      if (typeof scopeId !== 'string' || !scopeId || scopeId === currentScopeId) return
      const hadScope = Boolean(currentScopeId)
      currentScopeId = scopeId
      selectedSupplier = ''
      selectedEvidence = ''
      selectedEvidenceKind = ''
      selectedEvidenceEventId = ''
      for (const key of Object.keys(panelMemory)) delete panelMemory[key]
      if (hadScope) window.dispatchEvent(new CustomEvent('supplier-risk:scope-changed'))
    }

    async function api(action, args = {}, signal) {
      const response = await fetch(`${BASE}/call`, {
        method: 'POST', credentials: 'same-origin', redirect: 'error',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, args }),
        signal: signal || AbortSignal.timeout(30000),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || body?.ok !== true) throw new Error(body?.error || `http_${response.status}`)
      adoptScope(body.scopeId)
      return body.data
    }

    function useRemembered(key, initial) {
      const storageKey = `${currentScopeId}:${key}`
      const [state, setState] = useState(() => ({
        key: storageKey,
        value: Object.hasOwn(panelMemory, storageKey) ? panelMemory[storageKey] : initial,
      }))
      const value = state.key === storageKey
        ? state.value
        : Object.hasOwn(panelMemory, storageKey) ? panelMemory[storageKey] : initial
      useEffect(() => {
        setState({ key: storageKey, value })
      }, [storageKey])
      const update = next => setState(previousState => {
        const previous = previousState.key === storageKey
          ? previousState.value
          : Object.hasOwn(panelMemory, storageKey) ? panelMemory[storageKey] : initial
        const value = typeof next === 'function' ? next(previous) : next
        panelMemory[storageKey] = value
        return { key: storageKey, value }
      })
      useEffect(() => { panelMemory[storageKey] = value }, [storageKey, value])
      return [value, update]
    }

    function fmt(value) {
      if (!value) return '时间未记录'
      const date = new Date(value)
      return Number.isNaN(date.valueOf()) ? String(value) : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    }

    function errorText(error) {
      const map = {
        credential_unavailable: '本机 Models 凭据不可用，请检查 Sensteed 登录状态。',
        gateway_request_failed: '供应链服务暂不可用。', supplier_mcp_request_failed: '供应链服务暂不可用。',
        VERSION_CONFLICT: '记录已被其他操作更新，请刷新后重试。', STALE_EVIDENCE: '证据已变化，请刷新后重新保存。',
        SUPPLIER_NOT_FOUND: '该供应商当前不可用。', REPORT_NOT_READY: '周报尚未生成完成。',
      }
      return map[error?.message] || `加载或保存失败（${error?.message || '未知错误'}）`
    }

    const css = `
    .sr-launcher{box-sizing:border-box;display:flex;width:36px;height:36px;align-items:center;justify-content:center;gap:8px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}.sr-launcher:hover{background:var(--dsw-alias-interactive-bg-hover)}.sr-launcher:focus-visible{outline:2px solid var(--dsw-alias-brand-primary)}.sr-launcher.sr-wide{width:100%;height:34px;justify-content:flex-start;padding:0 10px;font-size:13px}

    .sr-page{height:100%;min-height:0;overflow:auto;background:var(--dsh-surface,#fff);color:var(--dsh-foreground,#202421);padding:24px clamp(16px,3vw,40px);font:14px/1.5 var(--dsh-font-sans,system-ui,sans-serif)}
    .sr-header{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid var(--dsh-border,#dfe4df);padding:4px 0 20px}.sr-header h1{margin:2px 0;font-size:24px;line-height:1.2}.sr-header p{margin:0}.sr-eyebrow{color:#4a785c;font-size:11px;font-weight:700}.sr-subtitle,.sr-muted{color:var(--dsh-muted-foreground,#69716b)}.sr-tabs{display:flex;overflow:auto;gap:4px;border-bottom:1px solid var(--dsh-border,#dfe4df);margin-bottom:22px}.sr-tabs button{flex:0 0 auto;padding:12px 14px;border:0;border-bottom:2px solid transparent;background:transparent;color:inherit;font:inherit;cursor:pointer}.sr-tabs button[aria-current=page]{border-bottom-color:#27754a;color:#1f6840;font-weight:650}.sr-icon-button{display:grid;place-items:center;width:36px;height:36px;border:1px solid var(--dsh-border,#dfe4df);border-radius:6px;background:transparent;color:inherit;cursor:pointer}.sr-unread,.sr-unread-count{display:inline-grid;place-items:center;min-width:20px;height:20px;margin-left:7px;padding:0 5px;border-radius:10px;background:#b43c39;color:#fff;font-size:11px}.sr-content{max-width:1320px;margin:auto}.sr-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:22px}.sr-metric{display:grid;gap:4px;min-height:104px;align-content:center;padding:15px 18px;border:1px solid var(--dsh-border,#dfe4df);border-left:3px solid #43835a;border-radius:5px}.sr-metric span,.sr-metric small{color:var(--dsh-muted-foreground,#69716b)}.sr-metric strong{font-size:25px;font-variant-numeric:tabular-nums}.sr-metric small{font-size:11px}.sr-columns{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(280px,.8fr);gap:16px}.sr-section{min-width:0;padding:18px;border:1px solid var(--dsh-border,#dfe4df);border-radius:6px}.sr-section h2,.sr-section h3{margin:0;font-size:16px}.sr-list{display:grid;margin-top:12px}.sr-list-row{display:grid;grid-template-columns:auto minmax(0,1fr) minmax(110px,auto);align-items:center;gap:12px;width:100%;padding:12px 4px;border:0;border-bottom:1px solid var(--dsh-border,#e6e9e6);background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}.sr-list-row>span:nth-child(2){display:grid;min-width:0}.sr-list-row small{overflow:hidden;color:var(--dsh-muted-foreground,#69716b);text-overflow:ellipsis;white-space:nowrap}.sr-list-row time,.sr-evidence time{color:var(--dsh-muted-foreground,#69716b);font-size:11px}.sr-status{display:inline-flex;width:max-content;align-items:center;padding:2px 7px;border:1px solid #c9d5ca;border-radius:4px;color:#3c6649;font-size:11px;white-space:nowrap}.sr-status[data-tone=candidate]{border-color:#e5d2a4;color:#84621b}.sr-source{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 12px;padding:12px 0;border-bottom:1px solid var(--dsh-border,#e6e9e6)}.sr-source small{grid-column:1/-1;color:var(--dsh-muted-foreground,#69716b)}.sr-source-note,.sr-footnote{color:var(--dsh-muted-foreground,#69716b);font-size:12px}.sr-toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:0 0 14px}.sr-toolbar h2{margin:0;font-size:17px}.sr-toolbar p{margin:3px 0}.sr-toolbar form{display:flex;gap:8px}.sr-search{display:flex;align-items:center;gap:8px;width:min(520px,50vw);padding:0 10px;border:1px solid var(--dsh-border,#dfe4df);border-radius:5px}.sr-search input{width:100%;min-width:0;height:36px;border:0;outline:0;background:transparent;color:inherit;font:inherit}.sr-button{min-height:36px;padding:7px 14px;border:1px solid #27754a;border-radius:5px;background:#27754a;color:#fff;font:inherit;font-weight:600;cursor:pointer}.sr-button:disabled{opacity:.55;cursor:wait}.sr-secondary{border-color:var(--dsh-border,#ccd4cd);background:transparent;color:inherit}.sr-link{padding:4px 7px;border:0;background:transparent;color:#176a40;font:inherit;cursor:pointer}.sr-select-label{display:flex;align-items:center;gap:8px;color:var(--dsh-muted-foreground,#69716b)}.sr-select-label select,.sr-field input,.sr-field textarea,.sr-field select{width:100%;min-width:0;padding:8px;border:1px solid var(--dsh-border,#dfe4df);border-radius:4px;background:var(--dsh-surface,#fff);color:inherit;font:inherit}.sr-table-wrap{overflow:auto;border:1px solid var(--dsh-border,#dfe4df);border-radius:5px}.sr-table{width:100%;border-collapse:collapse;white-space:nowrap}.sr-table th,.sr-table td{padding:10px 12px;border-bottom:1px solid var(--dsh-border,#e6e9e6);text-align:left}.sr-table th{background:var(--dsh-muted,#f5f7f5);color:var(--dsh-muted-foreground,#69716b);font-size:11px;font-weight:600}.sr-table tbody tr:last-child td{border-bottom:0}.sr-evidence-list{display:grid;gap:10px}.sr-evidence{padding:15px;border:1px solid var(--dsh-border,#dfe4df);border-radius:5px}.sr-evidence-head,.sr-evidence-meta,.sr-evidence-actions{display:flex;align-items:center;flex-wrap:wrap;gap:10px}.sr-evidence-head{justify-content:space-between}.sr-evidence h3{margin:11px 0 4px;font-size:15px}.sr-evidence p{margin:0;color:var(--dsh-muted-foreground,#69716b)}.sr-evidence-meta{margin-top:12px;color:var(--dsh-muted-foreground,#69716b);font-size:12px}.sr-evidence-actions{justify-content:flex-end;margin-top:8px}.sr-evidence-actions a{display:inline-flex;align-items:center;gap:4px;color:#176a40;text-decoration:none}.sr-pagination{display:flex;justify-content:space-between;align-items:center;margin-top:14px;color:var(--dsh-muted-foreground,#69716b);font-size:12px}.sr-pagination div{display:flex;gap:6px}.sr-pagination button{padding:6px 10px;border:1px solid var(--dsh-border,#dfe4df);border-radius:4px;background:transparent;color:inherit;font:inherit;cursor:pointer}.sr-pagination button:disabled{opacity:.4;cursor:default}.sr-business-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start;gap:14px}.sr-form{display:grid;gap:12px}.sr-form>h3{margin:0}.sr-field{display:grid;gap:5px;font-size:12px;font-weight:600}.sr-field input,.sr-field select{height:36px}.sr-field textarea{resize:vertical;min-height:72px;font-weight:400}.sr-history{display:grid;gap:10px;margin-top:18px;padding-top:14px;border-top:1px solid var(--dsh-border,#dfe4df)}.sr-history h3{font-size:14px}.sr-history article{padding:10px;background:var(--dsh-muted,#f5f7f5);border-radius:4px}.sr-history article p{margin:4px 0}.sr-empty-panel{padding:30px}.sr-weekly-layout{display:grid;grid-template-columns:minmax(280px,.75fr) minmax(0,1.25fr);align-items:start;gap:14px}.sr-toggle{display:flex;align-items:center;gap:9px}.sr-toggle input{width:16px;height:16px;accent-color:#27754a}.sr-section-heading{display:flex;align-items:center;justify-content:space-between;gap:10px}.sr-section-heading>div{display:flex;gap:8px}.sr-report{margin-top:14px}.sr-report-summary{font-size:17px}.sr-report-columns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.sr-report-columns section{padding:12px;background:var(--dsh-muted,#f5f7f5);border-radius:4px}.sr-report-columns h3{font-size:13px}.sr-report-columns ul{padding-left:18px}.sr-report-columns li{margin:8px 0;overflow-wrap:anywhere}.sr-success{color:#27754a}.sr-error{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;padding:10px 12px;border-left:3px solid #b43c39;background:#fff6f5;color:#8c2f2d}.sr-error button{border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer}.sr-page button:focus-visible,.sr-page a:focus-visible,.sr-page input:focus-visible,.sr-page select:focus-visible,.sr-page textarea:focus-visible{outline:2px solid #387b58;outline-offset:2px}
    .sr-field select.sr-multi-select{height:auto;min-height:112px;line-height:1.7}.sr-field-hint{color:var(--dsh-muted-foreground,#69716b);font-size:11px;font-weight:400}
    @media(max-width:900px){.sr-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.sr-columns,.sr-business-grid,.sr-weekly-layout{grid-template-columns:1fr}.sr-report-columns{grid-template-columns:1fr}.sr-page{padding:18px 14px}.sr-toolbar{align-items:flex-start;flex-direction:column}.sr-search{width:min(520px,70vw)}}
    @media(prefers-color-scheme:dark){.sr-status[data-tone=confirmed]{border-color:#557c60;color:#a2d4ac}.sr-status[data-tone=candidate]{border-color:#8d7845;color:#e7ce84}.sr-tabs button[aria-current=page]{color:#91d3a4}.sr-link,.sr-evidence-actions a{color:#91d3a4}.sr-error{background:#371f1e;color:#f0b5b0}.sr-source-note,.sr-report-columns section,.sr-history article{background:var(--dsh-muted,#242824)}}
    `

    function Workbench() {
      const [tab, setTab] = useRemembered('active-tab', 'overview')
      const [revision, setRevision] = useState(0)
      const [error, setError] = useState('')
      const [access, setAccess] = useState(null)
      const [accessReason, setAccessReason] = useState('')
      const [scopeReady, setScopeReady] = useState(false)
      const [unread, setUnread] = useState(0)
      const retryAccess = () => {
        setAccess(null)
        setAccessReason('')
        fetch(`${BASE}/access`, { credentials: 'same-origin', redirect: 'error' })
          .then(response => response.json())
          .then(body => { adoptScope(body?.scopeId); setScopeReady(Boolean(body?.scopeId)); setAccessReason(body?.reason || 'unavailable'); setAccess(body?.allowed === true) })
          .catch(() => { setAccessReason('connection_unavailable'); setAccess(false) })
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
      useEffect(() => { retryAccess() }, [])
      const refresh = () => { setError(''); setRevision(value => value + 1) }
      if (access === null) return h('main', { className: 'sr-page', role: 'status' }, '正在连接供应链工作台…')
      if (!access) return h('main', { className: 'sr-page' }, h('h1', null, '供应商风险'), h('p', null, accessMessage(accessReason)), h('button', { type: 'button', className: 'sr-button sr-secondary', onClick: retryAccess }, '重新连接'))
      return h('main', { className: 'sr-page' },
        h('header', { className: 'sr-header' },
          h('div', null, h('p', { className: 'sr-eyebrow' }, 'SUPPLIER INTELLIGENCE'), h('h1', null, '供应商风险'), h('p', { className: 'sr-subtitle' }, '已归集事实、待核验线索与业务判断分开展示。')),
          h('button', { type: 'button', className: 'sr-icon-button', 'aria-label': '刷新数据', title: '刷新数据', onClick: refresh }, h(IconRefreshOutlineRegular, { size: 18 }))),
        h('nav', { className: 'sr-tabs', 'aria-label': '供应商风险页面' }, ...TABS.map(([id, label]) => h('button', {
          key: id, type: 'button', 'aria-current': tab === id ? 'page' : undefined,
          onClick: () => { setError(''); setTab(id) },
        }, label, id === 'weekly' && unread > 0 ? h('span', { className: 'sr-unread' }, unread) : null))),
        error ? h('div', { className: 'sr-error', role: 'alert' }, error, h('button', { type: 'button', onClick: refresh }, '重试')) : null,
        h('section', { className: 'sr-content', 'aria-busy': false },
          tab === 'overview' ? h(Overview, { revision, setError, onUnread: setUnread, onOpen: id => { setSelected(id); setTab('business') } }) : null,
          tab === 'suppliers' ? h(Suppliers, { revision, setError, onSelect: id => { setSelected(id); setTab('business') }, onImported: refresh }) : null,
          tab === 'enterprise' ? h(Evidence, { kind: 'enterprise', revision, setError, onSelect: row => { setEvidence(row.evidenceId, 'enterprise', row.eventId); setSelected(row.supplierId); setTab('business') } }) : null,
          tab === 'media' ? h(Evidence, { kind: 'media', revision, setError, onSelect: row => { setEvidence(row.evidenceId, 'media', row.eventId); setSelected(row.supplierId); setTab('business') } }) : null,
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

    function setSelected(value) { selectedSupplier = value }
    function setEvidence(value, kind = '', eventId = '') { selectedEvidence = value; selectedEvidenceKind = kind; selectedEvidenceEventId = eventId }

    function useLoad(loader, deps, setError) {
      const [state, setState] = useState({ loading: true, data: null })
      useEffect(() => {
        const controller = new AbortController()
        let active = true
        setState(value => ({ ...value, loading: true }))
        loader(controller.signal).then(data => { if (active) setState({ loading: false, data }) })
          .catch(error => { if (active) { setState({ loading: false, data: null }); setError(errorText(error)) } })
        return () => { active = false; controller.abort() }
      }, deps)
      return state
    }

    function Loading({ state, empty }) {
      if (state.loading && !state.data) return h('p', { className: 'sr-muted', role: 'status' }, '正在读取已归集数据…')
      if (!state.data) return h('p', { className: 'sr-muted' }, empty || '暂无可显示的数据。')
      return null
    }

    function Metric({ label, value, hint }) {
      return h('div', { className: 'sr-metric' }, h('span', null, label), h('strong', null, value ?? '—'), hint ? h('small', null, hint) : null)
    }

    function Overview({ revision, setError, onUnread, onOpen }) {
      const state = useLoad(() => api('supply_chain_workbench_overview_get'), [revision], setError)
      const value = state.data
      if (!value) return h(Loading, { state })
      const counts = value.counts || {}
      const changes = value.changes || []
      const sourceGapCount = (value.sources || []).filter(source => source.status !== 'available' || source.stale).length
      return h(React.Fragment, null,
        h('div', { className: 'sr-metrics' },
          h(Metric, { label: '供应商', value: counts.suppliers ?? 0, hint: '当前租户台账' }),
          h(Metric, { label: '高优先级事项', value: counts.priorityItems ?? 0, hint: '已确认风险' }),
          h(Metric, { label: '待核验线索', value: counts.pendingClues ?? 0 }),
          h(Metric, { label: '来源缺口', value: sourceGapCount, hint: `统计于 ${fmt(value.statisticsAt)}` })),
        h('div', { className: 'sr-columns' },
          h('section', { className: 'sr-section' }, h('h2', null, '近期变化'),
            changes.length ? h('div', { className: 'sr-list' }, ...changes.slice(0, 10).map((item, index) => h('button', { type: 'button', className: 'sr-list-row', key: item.evidenceId || item.eventId || index, onClick: () => onOpen(item.supplierId) },
              h('span', { className: 'sr-status', 'data-tone': item.isConfirmed ? 'confirmed' : 'candidate' }, item.isConfirmed ? '已确认' : '待核验'),
              h('span', null, h('strong', null, item.supplierName || item.supplierId), h('small', null, item.title || item.summary || '证据摘要未提供')),
              h('time', null, fmt(item.riskPromptedAt || item.retrievedAt))))) : h('p', { className: 'sr-muted' }, '当前数据库范围内没有近期变化。')),
          h('section', { className: 'sr-section' }, h('h2', null, '来源覆盖'),
            ...(value.sources || []).map(source => h('div', { className: 'sr-source', key: source.sourceId || source.source || source.name },
              h('span', null, source.name || source.platform || source.sourceId || source.source || '未命名来源'),
              h('span', { className: 'sr-status', 'data-tone': source.status === 'available' && !source.stale ? 'confirmed' : 'candidate' }, source.stale ? '数据滞后' : source.status || '未知'),
              h('small', null, source.lastSuccessAt ? `最近成功 ${fmt(source.lastSuccessAt)}` : source.reason || '暂无成功记录'))),
            h('p', { className: 'sr-source-note' }, '页面只读取已保存数据，不触发外部采集。'))),
        h('p', { className: 'sr-footnote' }, `数据来源：${value.dataSource || 'database'} · 未发起外部调用`))
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
      return h(React.Fragment, null,
        h('div', { className: 'sr-toolbar' }, h('form', { onSubmit: event => { event.preventDefault(); setPage(1); setSubmitted(query.trim()) } }, h('label', { className: 'sr-search' }, h(IconSearchOutlineRegular, { size: 16 }), h('input', { value: query, onChange: event => setQuery(event.target.value), placeholder: '搜索供应商名称或统一社会信用代码', 'aria-label': '搜索供应商' })), h('button', { type: 'submit', className: 'sr-button' }, '搜索')),
          h('div', { className: 'sr-toolbar-actions' }, h('span', { className: 'sr-muted' }, `${data?.total ?? '—'} 家供应商`), h('button', { type: 'button', className: 'sr-button sr-secondary', onClick: () => setShowAdd(!showAdd) }, showAdd ? '收起新增' : '新增 / 导入'))),
        showAdd ? h(SupplierIntake, { newName, setNewName, importText, setImportText, busy, setBusy, setError, onDone: () => { setPage(1); setSubmitted(''); onImported?.(); window.dispatchEvent(new CustomEvent('supplier-risk:refresh')) } }) : null,
        h(Loading, { state }), data ? h(React.Fragment, null,
          h('div', { className: 'sr-table-wrap' }, h('table', { className: 'sr-table' }, h('thead', null, h('tr', null, ...['供应商', '统一社会信用代码', '类别', '主体核验', '监控范围', '来源覆盖', '更新时间', ''].map(label => h('th', { key: label }, label)))), h('tbody', null,
            ...data.items.map(row => h('tr', { key: row.supplierId }, h('td', null, h('strong', null, row.displayName)), h('td', null, row.creditCode || '未关联'), h('td', null, row.category || '未分类'), h('td', null, h(Status, { value: row.verificationStatus })), h('td', null, row.monitoringScope || '未设置'), h('td', null, row.coverage?.status === 'partial' ? '部分来源' : '待接入'), h('td', null, fmt(row.updatedAt)), h('td', null, h('button', { type: 'button', className: 'sr-link', onClick: () => onSelect(row.supplierId) }, '业务影响'))))))),
          h(Pagination, { page, pageSize: 20, total: data.total, onChange: setPage })) : null)
    }

    function SupplierIntake({ newName, setNewName, importText, setImportText, busy, setBusy, setError, onDone }) {
      const [result, setResult] = useState('')
      const [runId, setRunId] = useRemembered('supplier-intake-run', '')
      const [category, setCategory] = useRemembered('supplier-add-category', '')
      const [monitoringScope, setMonitoringScope] = useRemembered('supplier-add-scope', 'LEGAL_ENTITY_ONLY')
      const run = useRun(runId)
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
        h('form', { className: 'sr-section sr-form', onSubmit: add }, h('h3', null, '新增供应商'), h('p', { className: 'sr-muted' }, '新记录进入待核验状态；关联登记主体前不会扩展企业监控。'), Field('供应商名称', h('input', { required: true, maxLength: 256, value: newName, onChange: event => setNewName(event.target.value) })), Field('供应商类别', h('input', { maxLength: 256, value: category, onChange: event => setCategory(event.target.value), placeholder: '可选' })), Field('监控范围', h('select', { value: monitoringScope, onChange: event => setMonitoringScope(event.target.value) }, h('option', { value: 'LEGAL_ENTITY_ONLY' }, '仅法人主体'), h('option', { value: 'LEGAL_ENTITY_AND_SUBSIDIARIES' }, '法人及子公司'), h('option', { value: 'LEGAL_ENTITY_AND_SUBSIDIARIES_AND_INVESTMENTS' }, '法人、子公司及投资企业'))), h('button', { type: 'submit', className: 'sr-button', disabled: busy || !newName.trim() }, '确认新增')),
        h('form', { className: 'sr-section sr-form', onSubmit: importCsv }, h('h3', null, '批量导入映射'), h('p', { className: 'sr-muted' }, 'CSV 表头：supplier_name、country_region、monitoring_scope、seed_source。'), Field('CSV 内容', h('textarea', { rows: 5, maxLength: 20000, value: importText, onChange: event => setImportText(event.target.value), placeholder: 'supplier_name,country_region,monitoring_scope,seed_source' })), h('button', { type: 'submit', className: 'sr-button sr-secondary', disabled: busy || !importText.trim() }, '确认导入')),
        result ? h('div', { className: 'sr-intake-result', role: 'status' }, h('p', { className: 'sr-success' }, result), run ? h('p', null, `状态：${run.status}${run.result?.created !== undefined ? ` · 新增 ${run.result.created} · 重复 ${run.result.duplicates || 0} · 错误 ${run.result.errorCount || 0}` : ''}${run.error?.code ? ` · ${run.error.code}` : ''}`) : runId ? h('p', null, `任务 ${runId} 正在确认…`) : null, run?.result?.errorsTruncated ? h('p', { className: 'sr-muted' }, '仅显示前 100 条行错误。') : null, run?.result?.rowErrors?.length ? h('ul', null, ...run.result.rowErrors.map(error => h('li', { key: `${error.row}-${error.errorCode}` }, `第 ${error.row} 行：${error.errorCode === 'INVALID_SUPPLIER_INPUT' ? '字段格式无效' : '该行未能导入'}`))) : null) : null)
    }

    function Status({ value }) {
      const confirmed = ['CONFIRMED', 'VERIFIED', 'APPROVED', 'available'].includes(value)
      const label = { CONFIRMED: '已确认', VERIFIED: '已核验', APPROVED: '已通过', PENDING_REVIEW: '待核验', CANDIDATE: '候选', available: '可用' }[value] || value || '未知'
      return h('span', { className: 'sr-status', 'data-tone': confirmed ? 'confirmed' : 'candidate' }, label)
    }

    function Evidence({ kind, revision, setError, onSelect }) {
      const [page, setPage] = useRemembered(`${kind}-page`, 1)
      const [status, setStatus] = useRemembered(`${kind}-status`, '')
      const [detailId, setDetailId] = useRemembered(`${kind}-detail`, '')
      const [reviewReason, setReviewReason] = useRemembered(`${kind}-review-reason`, '')
      const [reviewNote, setReviewNote] = useState('')
      const [reviewRunId, setReviewRunId] = useRemembered(`${kind}-review-run`, '')
      const reviewRun = useRun(reviewRunId)
      const [reviewBusy, setReviewBusy] = useState(false)
      const state = useLoad(() => api('supply_chain_workbench_evidence_list', { kind, page, pageSize: 20, ...(status ? { reviewStatus: status } : {}) }), [kind, page, status, revision], setError)
      const detailState = useLoad(() => detailId ? api('supply_chain_workbench_evidence_get', { kind, evidenceId: detailId }) : Promise.resolve(null), [kind, detailId, revision], setError)
      const data = state.data
      const detail = detailState.data?.evidence
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
        h('div', { className: 'sr-toolbar' }, h('div', null, h('h2', null, kind === 'enterprise' ? '工商与司法风险' : '媒体舆情线索'), h('p', { className: 'sr-muted' }, kind === 'enterprise' ? '仅展示已持久化风险事件和来源时间。' : '媒体命中属于候选线索，主体匹配不等同于事实核验。')),
          h('label', { className: 'sr-select-label' }, '核验状态', h('select', { value: status, onChange: event => { setPage(1); setStatus(event.target.value) }, 'aria-label': '按核验状态筛选' }, h('option', { value: '' }, '全部'), h('option', { value: 'PENDING_REVIEW' }, '待核验'), h('option', { value: 'CONFIRMED' }, '已确认'), h('option', { value: 'REJECTED' }, '已排除')))),
        h(Loading, { state }), data ? h(React.Fragment, null,
          h('div', { className: 'sr-evidence-list' }, ...data.items.map(row => h('article', { className: 'sr-evidence', key: row.evidenceId },
            h('div', { className: 'sr-evidence-head' }, h(Status, { value: row.reviewStatus }), h('span', null, row.supplierName || row.supplierId), h('time', null, fmt(row.occurredAt || row.exposedAt || row.riskPromptedAt || row.retrievedAt))),
            h('h3', null, row.title || row.category || '未命名证据'), h('p', null, row.summary || row.description || '未提供摘要'),
            h('div', { className: 'sr-evidence-meta' }, h('span', null, `来源 ${row.platform || row.source || '未知'}`), row.readCount !== null && row.readCount !== undefined ? h('span', null, `阅读量 ${row.readCount}${row.readCountScope ? ` · ${row.readCountScope}` : ''}`) : null, h('span', null, `采集 ${fmt(row.retrievedAt)}`)),
            h('div', { className: 'sr-evidence-actions' }, row.sourceUrl ? h('a', { href: row.sourceUrl, target: '_blank', rel: 'noreferrer' }, '查看原文', h(IconRightUpOutlineRegular, { size: 14 })) : null, h('button', { type: 'button', className: 'sr-link', onClick: () => setDetailId(row.evidenceId) }, '查看证据'), h('button', { type: 'button', className: 'sr-link', onClick: () => onSelect(row) }, '加入业务分析'))))),
          detailId ? h('section', { className: 'sr-section sr-detail' }, detail ? h(React.Fragment, null,
            h('div', { className: 'sr-section-heading' }, h('h2', null, '证据详情'), h('button', { type: 'button', className: 'sr-link', onClick: () => setDetailId('') }, '关闭')),
            h('h3', null, detail.title || '未命名证据'), h('p', null, detail.summary || detail.description || '未提供摘要'),
            h('p', { className: 'sr-footnote' }, `主体 ${detail.supplierName || detail.supplierId} · 来源 ${detail.platform || detail.source || '未知'} · 发布时间 ${fmt(detail.exposedAt || detail.occurredAt)} · 采集时间 ${fmt(detail.retrievedAt)}`),
            detail.sourceUrl ? h('a', { href: detail.sourceUrl, target: '_blank', rel: 'noreferrer' }, '打开来源') : null,
            h('h3', null, '核验轨迹'), detail.reviews?.length ? h('ul', null, ...detail.reviews.map(review => h('li', { key: review.reviewId }, `${review.decision} · ${review.reasonCode} · ${fmt(review.createdAt)}`))) : h('p', { className: 'sr-muted' }, '尚无人工核验记录。'),
            kind === 'media' && detail.eventId && detail.reviewStatus === 'PENDING_REVIEW' ? h('div', { className: 'sr-review-box' }, h('label', { className: 'sr-field' }, h('span', null, '核验原因'), h('input', { value: reviewReason, onChange: event => setReviewReason(event.target.value), placeholder: '例如：主体与来源已交叉核实', maxLength: 256 })), h('div', { className: 'sr-review-actions' }, h('button', { type: 'button', className: 'sr-button', disabled: reviewBusy || !reviewReason.trim(), onClick: () => submitReview('CONFIRMED') }, '确认事件'), h('button', { type: 'button', className: 'sr-button sr-secondary', disabled: reviewBusy || !reviewReason.trim(), onClick: () => submitReview('REJECTED') }, '排除事件')), reviewNote ? h('p', { className: 'sr-success', role: 'status' }, `${reviewNote}${reviewRun ? ` 状态：${reviewRun.status}` : reviewRunId ? ` 任务 ${reviewRunId} 处理中` : ''}`) : null) : null) : h(Loading, { state: detailState })) : null,
          h(Pagination, { page, pageSize: 20, total: data.total, onChange: setPage })) : null)
    }

    function Pagination({ page, pageSize, total, onChange }) {
      const pages = Math.max(1, Math.ceil((total || 0) / pageSize))
      return h('div', { className: 'sr-pagination' }, h('span', null, `${total || 0} 条 · 第 ${page} / ${pages} 页`), h('div', null,
        h('button', { type: 'button', disabled: page <= 1, onClick: () => onChange(page - 1) }, '上一页'),
        h('button', { type: 'button', disabled: page >= pages, onClick: () => onChange(page + 1) }, '下一页')))
    }

    function useRun(runId) {
      const [run, setRun] = useState(null)
      useEffect(() => {
        if (!runId) { setRun(null); return undefined }
        let active = true
        let timer
        const poll = async () => {
          try {
            const data = await api('supply_chain_run_get', { runId })
            const next = data?.run || data
            if (!active) return
            setRun(next)
            if (next?.terminal !== true) timer = setTimeout(poll, Math.max(1500, (next?.pollAfterSeconds || 2) * 1000))
          } catch { if (active) timer = setTimeout(poll, 5000) }
        }
        void poll()
        return () => { active = false; clearTimeout(timer) }
      }, [runId])
      return run
    }

    function Business({ revision, setError, onScopeReady }) {
      const [supplierId, setSupplierId] = useState(selectedSupplier)
      const [form, setForm] = useRemembered(`business-form:${supplierId}`, null)
      const [analysis, setAnalysis] = useRemembered(`business-analysis:${supplierId}`, { dimension: 'other', externalSignal: '', possibleImpact: '', assumptions: '', informationGaps: '', suggestedActions: '', kind: 'human' })
      const [busy, setBusy] = useState(false)
      const state = useLoad(() => (onScopeReady && supplierId ? Promise.all([
        api('supply_chain_business_context_get', { supplierId }),
        api('supply_chain_business_analysis_list', { supplierId, page: 1, pageSize: 20 }),
        api('supply_chain_workbench_suppliers_list', { page: 1, pageSize: 100, query: supplierId }),
        selectedEvidence ? api('supply_chain_workbench_evidence_get', { kind: selectedEvidenceKind, evidenceId: selectedEvidence }) : Promise.resolve(null),
      ]) : Promise.resolve(null)), [supplierId, revision, selectedEvidence, selectedEvidenceKind], setError)
      const context = state.data?.[0]
      const analyses = state.data?.[1]
      const supplier = state.data?.[2]?.items?.find(item => item.supplierId === supplierId)
      const selectedEvidenceDetail = state.data?.[3]?.evidence
      useEffect(() => {
        if (context) setForm(current => current ?? ({ category: '', criticalMaterials: [], inventoryDays: '', inTransitOrders: '', alternatives: '', alternativeCapacity: '', procurementOwner: '', logisticsOwner: '', sqeOwner: '', impactAnalysis: '', ...(context.context?.fields || {}) }))
      }, [context])
      const setField = (key, value) => setForm(current => ({ ...current, [key]: value }))
      const saveContext = async event => {
        event.preventDefault(); setBusy(true); setError('')
        try {
          const fields = { ...form, inventoryDays: form.inventoryDays === '' ? null : Number(form.inventoryDays), criticalMaterials: Array.isArray(form.criticalMaterials) ? form.criticalMaterials : String(form.criticalMaterials || '').split(/[,，\n]/u).map(item => item.trim()).filter(Boolean) }
          await api('supply_chain_business_context_save', { supplierId, expectedVersion: context.version, fields, idempotencyKey: crypto.randomUUID(), confirm: true })
          setRevisionAfterSave()
        } catch (error) { setError(errorText(error)) } finally { setBusy(false) }
      }
      const saveAnalysis = async event => {
        event.preventDefault(); setBusy(true); setError('')
        try {
          const evidenceIds = selectedEvidence && supplierId === selectedSupplier ? [selectedEvidenceEventId || selectedEvidence] : []
          await api('supply_chain_business_analysis_save', { supplierId, expectedVersion: analyses.total ? analyses.items[0].version : 0, backgroundVersion: context.version, evidenceVersion: context.evidenceVersion, evidenceIds, fields: analysis, idempotencyKey: crypto.randomUUID(), confirm: true })
          setAnalysis(current => ({ ...current, externalSignal: '', possibleImpact: '', assumptions: '', informationGaps: '', suggestedActions: '' }))
          setRevisionAfterSave()
        } catch (error) { setError(errorText(error)) } finally { setBusy(false) }
      }
      if (!supplierId) return h('section', { className: 'sr-section sr-empty-panel' }, h('h2', null, '选择供应商'), h('p', { className: 'sr-muted' }, '从供应商台账打开一家供应商，补充库存、订单、替代产能和业务影响。'), h('button', { type: 'button', className: 'sr-button', onClick: () => window.dispatchEvent(new CustomEvent('supplier-risk:open-suppliers')) }, '浏览供应商台账'))
      if (!context || !form) return h(Loading, { state })
      return h(React.Fragment, null,
        h('div', { className: 'sr-toolbar' }, h('div', null, h('h2', null, supplier?.displayName || supplierId), h('p', { className: 'sr-muted' }, `背景版本 ${context.version} · 证据版本 ${String(context.evidenceVersion).slice(0, 12)}`)), h('button', { type: 'button', className: 'sr-link', onClick: () => { setSelected(''); setSupplierId('') } }, '更换供应商')),
        h('div', { className: 'sr-business-grid' },
          h('form', { className: 'sr-section sr-form', onSubmit: saveContext }, h('h3', null, '业务背景'), h('p', { className: 'sr-muted' }, '只保存采购、物流和质量团队提供的背景，不会改写外部证据。'),
            Field('关键物料', h('textarea', { value: Array.isArray(form.criticalMaterials) ? form.criticalMaterials.join('，') : form.criticalMaterials, onChange: event => setField('criticalMaterials', event.target.value), rows: 2 })),
            Field('库存天数', h('input', { type: 'number', min: 0, step: 'any', value: form.inventoryDays ?? '', onChange: event => setField('inventoryDays', event.target.value) })),
            Field('在途订单', h('textarea', { value: form.inTransitOrders || '', onChange: event => setField('inTransitOrders', event.target.value), rows: 2 })),
            Field('替代供应商', h('textarea', { value: form.alternatives || '', onChange: event => setField('alternatives', event.target.value), rows: 2 })),
            Field('替代产能', h('textarea', { value: form.alternativeCapacity || '', onChange: event => setField('alternativeCapacity', event.target.value), rows: 2 })),
            Field('经营影响', h('textarea', { value: form.impactAnalysis || '', onChange: event => setField('impactAnalysis', event.target.value), rows: 3 })),
            h('button', { type: 'submit', className: 'sr-button', disabled: busy }, busy ? '保存中…' : '保存业务背景')),
          h('section', { className: 'sr-section' }, h('h3', null, '人工判断'), h('p', { className: 'sr-muted' }, selectedEvidence ? `引用证据 ${selectedEvidence}` : '从工商或媒体页面打开证据后，可在此关联分析。'),
            selectedEvidenceDetail ? h('article', { className: 'sr-selected-evidence' }, h(Status, { value: selectedEvidenceDetail.reviewStatus }), h('strong', null, selectedEvidenceDetail.title || '引用证据'), h('p', null, selectedEvidenceDetail.summary || selectedEvidenceDetail.description || '未提供摘要'), h('small', null, `来源 ${selectedEvidenceDetail.source || selectedEvidenceDetail.platform || '未知'} · 采集 ${fmt(selectedEvidenceDetail.retrievedAt)}`)) : null,
            h('form', { className: 'sr-form', onSubmit: saveAnalysis }, Field('风险维度', h('select', { value: analysis.dimension, onChange: event => setAnalysis({ ...analysis, dimension: event.target.value }) }, ...[['delivery', '交付'], ['capacity', '产能'], ['quality', '质量'], ['compliance', '合规'], ['finance', '财务'], ['other', '其他']].map(([id, name]) => h('option', { key: id, value: id }, name)))),
              Field('外部信号', textArea(analysis.externalSignal, value => setAnalysis({ ...analysis, externalSignal: value }))),
              Field('可能影响', textArea(analysis.possibleImpact, value => setAnalysis({ ...analysis, possibleImpact: value }))),
              Field('假设', textArea(analysis.assumptions, value => setAnalysis({ ...analysis, assumptions: value }))),
              Field('信息缺口', textArea(analysis.informationGaps, value => setAnalysis({ ...analysis, informationGaps: value }))),
              Field('建议动作', textArea(analysis.suggestedActions, value => setAnalysis({ ...analysis, suggestedActions: value }))),
              h('button', { type: 'submit', className: 'sr-button', disabled: busy }, '保存人工判断')),
            h('div', { className: 'sr-history' }, h('h3', null, '历史分析'), ...(analyses.items || []).map(item => h('article', { key: item.id }, h('span', null, `版本 ${item.version} · ${fmt(item.createdAt)}`), item.stale ? h(Status, { value: 'STALE' }) : null, h('p', null, item.fields?.possibleImpact || '未填写影响描述')))),
            h('button', { type: 'button', className: 'sr-button sr-secondary', onClick: () => sendSupplierAnalysis(supplierId, context, selectedEvidence) }, '交由 Agent 分析')))
      )
    }

    function textArea(value, onChange) { return h('textarea', { rows: 3, value: value || '', onChange: event => onChange(event.target.value) }) }
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
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState('')
      const [planFields, setPlanFields] = useRemembered('weekly-plan-draft', null)
      const state = useLoad(() => (onScopeReady ? Promise.all([
        api('supply_chain_weekly_report_plan_get'),
        api('supply_chain_weekly_reports_list', { page: 1, pageSize: 20 }),
        reportId ? api('supply_chain_weekly_report_get', { reportId }) : Promise.resolve(null),
        api('supply_chain_workbench_suppliers_list', { page: 1, pageSize: 500 }),
      ]) : Promise.resolve(null)), [revision, reportId], setError)
      const plan = state.data?.[0]?.plan
      const reports = state.data?.[1]
      const report = state.data?.[2]?.report
      const suppliers = state.data?.[3]?.items || []
      useEffect(() => { if (plan) setPlanFields(current => current ?? ({ ...plan, supplierIds: normalizeSupplierIds(plan.supplierIds) })) }, [plan])
      useEffect(() => { if (reports) onUnread(reports.unreadCount || 0) }, [reports?.unreadCount])
      const savePlan = async event => {
        event.preventDefault(); setBusy(true); setNotice('')
        try {
          const supplierIds = normalizeSupplierIds(planFields.supplierIds)
          const saved = await api('supply_chain_weekly_report_plan_save', { expectedVersion: planFields.version, fields: { enabled: planFields.enabled === true, weekday: 0, hour: 9, minute: 0, timezone: 'Asia/Shanghai', supplierIds, collectionBudget: Number(planFields.collectionBudget || 0) }, idempotencyKey: crypto.randomUUID(), confirm: true })
          if (saved?.plan) setPlanFields({ ...saved.plan })
          setNotice('周报计划已保存。')
          window.dispatchEvent(new CustomEvent('supplier-risk:refresh'))
        } catch (error) { setError(errorText(error)) } finally { setBusy(false) }
      }
      const mutateReport = async (tool, id) => {
        setBusy(true); setNotice('')
        try {
          await api(tool, { reportId: id, confirm: true })
          setReportId(id); window.dispatchEvent(new CustomEvent('supplier-risk:refresh'))
        } catch (error) { setError(errorText(error)) } finally { setBusy(false) }
      }
      if (!planFields || !reports || !state.data?.[3]) return h(Loading, { state })
      return h(React.Fragment, null,
        h('div', { className: 'sr-weekly-layout' },
          h('section', { className: 'sr-section' }, h('h2', null, '周报计划'), h('p', { className: 'sr-muted' }, '服务端每周一 09:00（Asia/Shanghai）汇总已保存事实，不会启动外部采集或模型调用。'),
            h('form', { className: 'sr-form', onSubmit: savePlan }, h('label', { className: 'sr-toggle' }, h('input', { type: 'checkbox', checked: planFields.enabled === true, onChange: event => setPlanFields({ ...planFields, enabled: event.target.checked }) }), h('span', null, '启用每周风险周报')),
              Field('供应商范围', h(React.Fragment, null,
                h('select', {
                  className: 'sr-multi-select', multiple: true, size: Math.min(Math.max(suppliers.length, 3), 8),
                  value: normalizeSupplierIds(planFields.supplierIds),
                  onChange: event => setPlanFields({ ...planFields, supplierIds: Array.from(event.target.selectedOptions, option => option.value) }),
                  'aria-label': '选择周报供应商',
                }, suppliers.map(supplier => h('option', { key: supplier.supplierId, value: supplier.supplierId }, supplier.displayName || supplier.supplierId))),
                h('small', { className: 'sr-field-hint' }, suppliers.length ? `已录入 ${suppliers.length} 家供应商，可按住 Command 或 Ctrl 多选。` : '暂无已录入供应商。'))),
              Field('采集预算记录', h('input', { type: 'number', min: 0, value: planFields.collectionBudget || 0, onChange: event => setPlanFields({ ...planFields, collectionBudget: event.target.value }) })),
              h('p', { className: 'sr-footnote' }, `下次执行：${fmt(plan.nextRunAt)} · 当前运行：${plan.currentRunStatus || '无'}${plan.failureCode ? ` · ${plan.failureCode}` : ''}`),
              h('button', { type: 'submit', className: 'sr-button', disabled: busy }, busy ? '保存中…' : '保存计划'))),
          h('section', { className: 'sr-section' }, h('div', { className: 'sr-section-heading' }, h('h2', null, '历史周报'), h('span', { className: 'sr-unread-count' }, `未读 ${reports.unreadCount || 0}`)),
            reports.items.length ? h('div', { className: 'sr-list' }, ...reports.items.map(item => h('button', { type: 'button', className: 'sr-list-row', key: item.reportId, onClick: () => setReportId(item.reportId) }, h(Status, { value: item.status === 'succeeded' ? (item.isRead ? 'CONFIRMED' : 'PENDING_REVIEW') : item.status }), h('span', null, h('strong', null, `${fmt(item.periodStart)} - ${fmt(item.periodEnd)}`), h('small', null, item.errorCode || item.summary || '查看报告详情')), h('time', null, fmt(item.generatedAt || item.createdAt))))) : h('p', { className: 'sr-muted' }, '暂无已生成周报。'))),
        report ? h('section', { className: 'sr-section sr-report' }, h('div', { className: 'sr-section-heading' }, h('h2', null, '周报详情'), h('div', null, report.status === 'failed' ? h('button', { type: 'button', className: 'sr-button sr-secondary', disabled: busy, onClick: () => mutateReport('supply_chain_weekly_report_retry', report.reportId) }, '重试原任务') : null, report.status === 'succeeded' && !report.isRead ? h('button', { type: 'button', className: 'sr-button sr-secondary', disabled: busy, onClick: () => mutateReport('supply_chain_weekly_report_mark_read', report.reportId) }, '标为已读') : null)),
          h('p', { className: 'sr-muted' }, `${fmt(report.periodStart)} 至 ${fmt(report.periodEnd)} · ${report.sourcesChanged ? '来源事实已有更新，本快照保留生成时内容。' : '本报告为生成时的数据快照。'}`),
          report.content ? h(ReportContent, { content: report.content }) : h('p', { role: 'status' }, report.errorCode || report.status)) : null,
        notice ? h('p', { className: 'sr-success', role: 'status' }, notice) : null)
    }

    function ReportContent({ content }) {
      return h(React.Fragment, null, h('p', { className: 'sr-report-summary' }, content.summary || '暂无摘要'),
        h('p', { className: 'sr-footnote' }, content.disclaimer || '仅展示已持久化事实与已保存判断。'),
        h('div', { className: 'sr-report-columns' }, ...[
          ['已确认风险', content.confirmedRisks], ['更新事项', content.updatedRisks], ['待核验媒体线索', content.pendingMediaClues],
        ].map(([title, rows]) => h('section', { key: title }, h('h3', null, title), rows?.length ? h('ul', null, ...rows.map((row, index) => h('li', { key: row.evidenceId || row.eventId || index }, h('strong', null, row.supplierName || row.supplierId), ` · ${row.title || row.summary || '未提供摘要'} · ${row.source || row.platform || '未知来源'} · ${fmt(row.retrievedAt)}`))) : h('p', { className: 'sr-muted' }, '本周期没有记录')))))
    }

    function apply(ctx) {
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
        const onAgentError = () => window.dispatchEvent(new CustomEvent('supplier-risk:refresh'))
        window.addEventListener('supplier-risk:show-agent', onShowAgent)
        window.addEventListener('supplier-risk:agent-error', onAgentError)
        return () => {
          delete globalThis.__supplier_risk_sessions
          window.removeEventListener('supplier-risk:show-agent', onShowAgent)
          window.removeEventListener('supplier-risk:agent-error', onAgentError)
        }
      }, 'supplier risk agent bridge')
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: 'dofe.supplier-risk' }, Workbench))
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: PANEL_ID, order: 57, locale: 'dofe.supplier-risk', inject: () => ({ t, onOpen: () => ctx.layout.selectPanel(PANEL_ID) }) }, FooterButton))
      ctx.effect(() => ctx.locale.register('dofe.supplier-risk', { zh: { panel: '供应链管理' }, en: { panel: 'Supply chain' } }), 'supplier risk locale')
    }

    function FooterButton({ wide, t, onOpen }) {
      return h(Tooltip, { label: t('panel'), disabled: wide },
        h('button', { type: 'button', className: `sr-launcher${wide ? ' sr-wide' : ''}`, 'aria-label': t('panel'), onClick: onOpen },
          h(IconShieldOutlineRegular, { size: wide ? 14 : 18 }), wide ? h('span', null, t('panel')) : null))
    }
    exports.apply = apply
    exports.inject = ['slots', 'locale', 'sessions', 'uiWorkspace', 'layout']

    exports.apply = apply; exports.inject = ['slots', 'locale', 'sessions', 'uiWorkspace', 'layout']; return module.exports; },
});
