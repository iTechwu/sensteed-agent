// 成本 BOM 工作台：复用 CE 契约，金额为元，汇总只采用服务端成本树正算结果。
function BomView({ ctx, t }) {
  const [createOpen, setCreateOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null)
  const [packages, setPackages] = useState(null)
  const [listError, setListError] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailError, setDetailError] = useState(null)
  const [rollup, setRollup] = useState(null)
  const [rollupError, setRollupError] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    setPackages(null); setListError(null)
    api(`/bom/packages?page=${page}&limit=${PAGE_SIZE}`)
      .then(result => { if (!cancelled) setPackages(result.data) })
      .catch(error => { if (!cancelled) setListError(error.message) })
    return () => { cancelled = true }
  }, [page, ctx.revision, retry])

  useEffect(() => {
    let cancelled = false
    setDetail(null); setDetailError(null); setRollup(null); setRollupError(false)
    if (!selected) return undefined
    const path = `/bom/packages/${encodeURIComponent(selected)}`
    void api(path).then(result => { if (!cancelled) setDetail(result.data) })
      .catch(error => { if (!cancelled) setDetailError(error.message) })
    void api(`${path}/rollup`).then(result => { if (!cancelled) setRollup(result.data) })
      .catch(() => { if (!cancelled) setRollupError(true) })
    return () => { cancelled = true }
  }, [selected, ctx.revision, retry])

  const amount = value => formatNumber(value) ?? t('dash')
  const errorBlock = message => h('div', { role: 'alert', className: 'sf-fatal' }, h('strong', null, t('loadError')), h('span', null, message), h(GhostButton, { onClick: () => setRetry(value => value + 1) }, t('retry')))
  const loading = h('div', { className: 'sf-loading', role: 'status' }, t('loading'))
  const entries = new Map((rollup?.entries || []).map(entry => [entry.nodeId, entry]))
  return h('div', null,
    h('p', { className: 'sf-desc' }, t('bomScope')),
    ctx.financeWriter ? h(GhostButton, { onClick: () => setCreateOpen(true) }, '新建成本包') : null,
    createOpen ? h(FinanceFormDialog, { title: '新建成本包', fields: [
      { key: 'name', label: '项目 / 车型名称', required: true }, { key: 'version', label: '版本', required: true },
      { key: 'modelCode', label: '车型编码' }, { key: 'targetPrice', label: '目标售价（元）', type: 'number', min: 0 },
      { key: 'targetCost', label: '目标成本（元）', type: 'number', min: 0 }, { key: 'profitTarget', label: '目标利润', type: 'number' }, { key: 'note', label: '说明' },
    ], initial: { version: 'V1' }, onClose: () => setCreateOpen(false), onSubmit: async body => { const result = await financeRest('/ce/packages', 'POST', body); setSelected(result.data.id); setRetry(value => value + 1) } }) : null,
    h(Card, { title: t('bomPackages'), unit: t('unitYuan') },
      listError ? errorBlock(listError) : !packages ? loading : h(React.Fragment, null,
        h(Table, { tableId: 'bom-packages', rows: packages.list || [], empty: t('empty'), columns: [
          { key: 'name', label: t('bomPackages'), render: row => h(GhostButton, { onClick: () => setSelected(row.id), 'aria-pressed': row.id === selected }, row.name) },
          { key: 'modelCode', label: t('bomModel') },
          { key: 'version', label: t('bomVersion') },
          { key: 'status', label: t('bomStatus'), render: row => financeEnumLabel(row.status, t, { DRAFT: 'bomStatusDRAFT', IN_REVIEW: 'bomStatusIN_REVIEW', APPROVED: 'bomStatusAPPROVED', OBSOLETE: 'bomStatusOBSOLETE' }) },
          { key: 'targetCost', label: `${t('bomTarget')} (${t('unitYuan')})`, render: row => amount(row.targetCost) },
        ] }),
        h(Pager, { page, total: packages.total, limit: PAGE_SIZE, onPage: setPage }))),
    selected ? h(Card, { title: detail?.package?.name || t('bomDetail'), unit: t('unitYuan') },
      detailError ? errorBlock(detailError) : !detail ? loading : h(React.Fragment, null,
        h('div', { className: 'sf-kpis' },
          h(KpiCard, { label: t('bomTotal'), value: amount(detail.totalCost) }),
          h(KpiCard, { label: t('bomTarget'), value: amount(detail.targetCost) }),
          h(KpiCard, { label: t('bomNodeCount'), value: detail.nodeCount }),
          h(KpiCard, { label: t('bomLeafCount'), value: detail.leafCount })),
        rollupError ? h('p', { role: 'alert' }, t('bomRollupError'), ' ', h(GhostButton, { onClick: () => setRetry(value => value + 1) }, t('retry'))) : null,
        h(Table, { tableId: 'bom-nodes', rows: detail.nodes || [], empty: t('empty'), columns: [
          { key: 'partNo', label: t('bomPart') },
          { key: 'name', label: t('bomName') },
          { key: 'level', label: t('bomLevel') },
          { key: 'qty', label: t('bomQty') },
          { key: 'unitCost', label: `${t('bomUnit')} (${t('unitYuan')})`, render: row => amount(row.unitCost) },
          { key: 'extendedCost', label: `${t('bomExtended')} (${t('unitYuan')})`, sortValue: row => entries.get(row.id)?.extendedCost, render: row => amount(entries.get(row.id)?.extendedCost) },
        ] }))) : h('p', { className: 'sf-desc' }, t('bomSelect')),
    selected ? h(BomControls, { key: selected, packageId: selected, detail, writer: ctx.financeWriter, onChanged: () => setRetry(value => value + 1) }) : null)
}

function BomControls({ packageId, detail, writer, onChanged }) {
  const action = useFinanceAction()
  const [dialog, setDialog] = useState(null)
  const [breakdown, setBreakdown] = useState(null)
  const [pendingExport, setPendingExport] = useState(null)
  const [receipt, setReceipt] = useState(null)
  const path = `/ce/packages/${encodeURIComponent(packageId)}`
  const changes = useFinanceResource(`${path}/changes`, action.revision)
  const quotes = useFinanceResource(`${path}/quotes`, action.revision)
  const params = useFinanceResource(`${path}/param-versions`, action.revision)
  const approvals = useFinanceResource(`${path}/approvals`, action.revision)
  const run = async (target, body, method) => { const result = await action.run(target, body, method); setReceipt(result); onChanged(); return result }
  const fields = (entries) => entries.map(([key, label, type, required]) => ({ key, label, type, required, ...(type === 'number' ? { min: 0, max: 999999999999.9999 } : {}) }))
  const nodeOptions = (dialog?.node ? [dialog.node] : detail?.nodes || []).map(node => [node.id, `${node.partNo || ''} ${node.name}`])
  const costFields = fields([['materialCost', '材料费（元）', 'number'], ['laborCost', '人工费（元）', 'number'], ['processCost', '加工费（元）', 'number'], ['otherCost', '其他费用（元）', 'number']])
  const status = detail?.package?.status
  const reviewActions = status === 'DRAFT' ? [['SUBMIT_REVIEW', '提交评审']] : status === 'IN_REVIEW' ? [['APPROVE', '批准'], ['REJECT', '驳回']] : status === 'APPROVED' ? [['OBSOLETE', '作废']] : []
  return h('div', { className: 'sf-stack' },
    action.notice ? h(Notice, null, action.notice) : null,
    writer && status === 'DRAFT' ? h(FinanceEbomExcel, { packageId, onChanged }) : null,
    writer ? h(Card, { title: '成本工程操作', unit: '元' }, h('div', { className: 'sf-row' },
      ...[['import', '逐行导入 BOM'], ['importJson', '批量导入 BOM'], ['estimate', '维护估算'], ['breakdown', '目标成本反算'], ['change', '模拟工程变更'], ['quote', '登记报价'], ['params', '新建参数版本'], ['download', '下载成本预测Excel'], ['export', '创建系统导出批次']].map(([kind, label]) => h(GhostButton, { key: kind, disabled: action.busy || (status !== 'DRAFT' && !['download', 'export', 'breakdown'].includes(kind)), onClick: () => setDialog({ kind, title: label }) }, label)),
      ...reviewActions.map(([reviewAction, title]) => h(GhostButton, { key: reviewAction, disabled: action.busy, onClick: () => setDialog({ kind: 'review', reviewAction, title }) }, title)))) : null,
    writer && status === 'DRAFT' ? h(Card, { title: '装配位置维护（目标与预测分别保存）' }, h(Table, { tableId: 'finance-ce-node-actions', rows: detail?.nodes || [], empty: '请先导入 EBOM', columns: [...financeColumns([['partNo', '零件号'], ['name', '名称']]), { key: 'actions', label: '操作', render: node => h('div', { className: 'sf-row' }, ...[['pricing', '成本预测'], ['acTarget', '单件AC目标'], ['procurement', 'SOR与货源']].map(([kind, title]) => h(GhostButton, { key: kind, disabled: action.busy || (kind === 'pricing' && Boolean(node.coveredBy)), onClick: () => setDialog({ kind, title, node }) }, title))) }] })) : null,
    receipt ? h(Card, { title: '操作回执与模拟结果' }, h(FinanceEvidence, { value: receipt })) : null,
    breakdown ? h(Card, { title: '目标成本反算（服务端结果）', unit: '元' }, h(Table, { tableId: 'bom-breakdown', rows: breakdown.entries || [], empty: '暂无结果', columns: financeColumns([['nodeId', '物料节点'], ['estimateUnitCost', '估算单位成本'], ['targetUnitCost', '目标单位成本'], ['gap', '缺口']]) })) : null,
    h(Card, { title: '工程变更与模拟差异' }, h(FinanceResource, { resource: changes }, h(Table, { tableId: 'bom-changes', rows: financeRows(changes.data), empty: '暂无工程变更', columns: [
      ...financeColumns([['title', '变更名称'], ['status', '状态'], ['affectedCount', '影响节点'], ['payload', '模拟证据']]),
      { key: 'actions', label: '操作', sortable: false, render: row => writer && row.status === 'PROPOSED' ? h('div', { className: 'sf-row' }, ...[['apply', '确认落账'], ['cancel', '撤销提案']].map(([kind, title]) => h(GhostButton, { key: kind, disabled: action.busy, onClick: () => setDialog({ kind, title, id: row.id }) }, title))) : null },
    ] }))),
    ...[[quotes, '供应商报价', [['supplierName', '供应商'], ['partNo', '零件号'], ['price', '报价（元）'], ['currency', '币种'], ['batchNo', '报价批次']]],
      [params, '参数版本', [['version', '版本'], ['params', '参数'], ['note', '说明'], ['createdAt', '创建时间']]],
      [approvals, '审批与操作留痕', [['action', '操作'], ['actorName', '操作者'], ['note', '说明'], ['createdAt', '时间']]]].map(([resource, title, columns]) => h(Card, { key: title, title }, h(FinanceResource, { resource }, h(Table, { tableId: `bom-${title}`, rows: financeRows(resource.data), columns: [...financeColumns(columns), ...(resource === quotes && writer && status === 'DRAFT' ? [{ key: 'actions', label: '操作', render: row => h(GhostButton, { onClick: () => setDialog({ kind: 'quoteApply', quote: row }) }, '预览并采用报价') }] : [])], empty: '暂无记录' })))),
    pendingExport ? h(Card, { title: '导出批次回写' }, h('p', null, `批次 ${pendingExport}`), h(GhostButton, { disabled: action.busy, onClick: () => setDialog({ kind: 'completeExport', title: '回写导出结果' }) }, '回写结果')) : null,
    dialog?.kind === 'import' ? h(FinanceRowsDialog, { title: dialog.title, fields: fields([['partNo', '零件号'], ['name', '物料名称', 'text', true], ['parentPartNo', '父级零件号'], ['level', '层级', 'number'], ['qty', '用量', 'number', true]]), initial: [{ qty: 1 }], onClose: () => setDialog(null), onSubmit: nodes => run(`${path}/nodes`, { nodes: nodes.map(node => ({ ...node, partNo: node.partNo || null, parentPartNo: node.parentPartNo || null })) }) }) : null,
    dialog?.kind === 'quoteApply' ? h(FinanceQuoteApply, { packageId, quote: dialog.quote, nodes: detail?.nodes || [], onClose: () => setDialog(null), onChanged }) : null,
    dialog && !['import', 'quoteApply'].includes(dialog.kind) ? h(FinanceFormDialog, { title: dialog.title, description: dialog.node ? `${dialog.node.partNo || ''} ${dialog.node.name} · 装配位置 ${dialog.node.sourceKey || dialog.node.id}。仅保存当前表单对应的数据，AC目标和成本预测相互独立。` : undefined, onClose: () => setDialog(null),
      fields: dialog.kind === 'acTarget' ? [{ key: 'nodeId', label: '装配位置', options: nodeOptions, required: true }, { key: 'unitCost', label: '单件AC目标（元）', type: 'number', min: 0, max: 999999999999.9999, required: true }, { key: 'source', label: '目标来源', maxLength: 200, required: true }]
        : dialog.kind === 'procurement' ? [{ key: 'nodeId', label: '装配位置', options: nodeOptions, required: true }, { key: 'sorNo', label: 'SOR编号（留空清除）', maxLength: 200 }, { key: 'sourcing', label: '货源（留空清除）', maxLength: 200 }]
        : dialog.kind === 'pricing' ? [{ key: 'nodeId', label: '装配位置', options: nodeOptions, required: true }, { key: 'pricing.acUnitPrice', label: '预测AC单价（元）', type: 'number', min: 0, max: 999999999999.9999, required: true }, { key: 'pricing.acSource', label: 'AC价格来源', maxLength: 200, required: true }, { key: 'pricing.pricingMode', label: '计价口径', options: [['OWN', '仅自身费用'], ['PACKAGE', '总成包价（覆盖子件）']], required: true }, { key: 'allocation', label: '成本分项口径', options: [['UNALLOCATED', '保持待拆分'], ['MATERIAL', '全部计入直接材料'], ['CUSTOM', '手工分项']], required: true }, ...[['directMaterial', '直接材料'], ['directLabor', '直接人工'], ['otherManufacturing', '其他制造成本']].map(([key, label]) => ({ key: `pricing.costBreakdown.${key}`, label, type: 'number', min: 0, max: 999999999999.9999, required: true, when: values => values.allocation === 'CUSTOM' })), { key: 'pricing.nominatedPrice', label: '定点价格（元，可空）', type: 'number', min: 0 }, { key: 'pricing.minimumPrice', label: '最低价格（元，可空）', type: 'number', min: 0 }, { key: 'pricing.annualReductionRate', label: '年降率（0—1）', type: 'number', min: 0, max: 1 }, { key: 'pricing.reductionYears', label: '年降年数', type: 'number', min: 0, max: 30 }, { key: 'pricing.supplierName', label: '供应商', maxLength: 200 }, { key: 'nominated', label: '是否定点', options: [['false', '未定点'], ['true', '已定点']] }, { key: 'samePart', label: '更新范围', options: [['false', '仅当前位置'], ['true', '同零件号全部未覆盖位置']] }]
        : dialog.kind === 'download' ? [{ key: 'targetCost', label: '目标成本（元，可选）', type: 'number', min: 0.0001 }]
        : dialog.kind === 'importJson' ? [{ key: 'nodesJson', label: 'BOM 行（JSON 数组，最多 200 行）', type: 'textarea', maxLength: 200000, required: true }] : dialog.kind === 'estimate' ? [{ key: 'nodeId', label: '物料节点', options: nodeOptions, required: true }, ...costFields, { key: 'paramVersionId', label: '参数版本', options: financeRows(params.data).map(row => [row.id, row.version]) }, { key: 'sourceRef', label: '来源引用' }]
        : dialog.kind === 'change' ? [{ key: 'title', label: '变更名称', required: true }, { key: 'nodeId', label: '物料节点', options: nodeOptions, required: true }, { key: 'qty', label: '新用量', type: 'number', min: 0.000001 }, ...costFields.map(field => ({ ...field, key: `estimate.${field.key}` }))]
        : dialog.kind === 'quote' ? [{ key: 'supplierName', label: '供应商', required: true, maxLength: 200 }, { key: 'partNo', label: '零件号', maxLength: 100 }, { key: 'price', label: '报价单价（元）', type: 'number', min: 0.0001, max: 999999999999.9999, required: true }, { key: 'currency', label: '币种（大写三字母）', required: true, maxLength: 3 }, { key: 'batchNo', label: '报价批次', maxLength: 100 }, { key: 'validUntil', label: '有效期', type: 'datetime-local' }]
        : dialog.kind === 'params' ? fields([['version', '版本号', 'text', true], ['params.laborRate', '人工费率', 'number'], ['params.overheadRate', '制造费率', 'number'], ['note', '说明']]).concat([{ key: 'paramsJson', label: '扩展业务参数（JSON 对象，可选）', type: 'textarea', maxLength: 32000 }])
        : dialog.kind === 'breakdown' ? [{ key: 'targetCost', label: '目标成本（元）', type: 'number', min: 0.000001 }]
        : dialog.kind === 'export' ? [{ key: 'target', label: '目标系统', required: true }]
        : dialog.kind === 'completeExport' ? [{ key: 'fileRef', label: '文件引用' }, { key: 'success', label: '导出结果', options: [['true', '成功'], ['false', '失败']], required: true }]
        : dialog.kind === 'apply' ? [] : [{ key: 'note', label: '说明', type: 'textarea' }],
      initial: dialog.node ? dialog.kind === 'pricing' ? { nodeId: dialog.node.id, pricing: dialog.node.estimate?.pricing || { acUnitPrice: '', acSource: '', pricingMode: 'OWN', annualReductionRate: 0, reductionYears: 0 }, allocation: dialog.node.estimate?.pricing?.costBreakdown ? 'CUSTOM' : 'UNALLOCATED', nominated: dialog.node.estimate?.pricing?.isNominated ? 'true' : 'false', samePart: 'false' } : dialog.kind === 'acTarget' ? { nodeId: dialog.node.id, unitCost: dialog.node.acTarget?.unitCost ?? '', source: dialog.node.acTarget?.source || '' } : { nodeId: dialog.node.id, sorNo: dialog.node.procurement?.sorNo ?? dialog.node.sourceData?.['SOR编号'] ?? dialog.node.sourceData?.['SOR号'] ?? '', sourcing: dialog.node.procurement?.sourcing ?? dialog.node.sourceData?.['货源'] ?? '' } : dialog.kind === 'quote' ? { currency: 'CNY' } : dialog.kind === 'pricing' ? { pricing: { pricingMode: 'OWN', annualReductionRate: 0, reductionYears: 0 }, allocation: 'UNALLOCATED', nominated: 'false', samePart: 'false' } : dialog.kind === 'export' ? { target: 'SAP' } : dialog.kind === 'params' ? { version: 'P1' } : {},
      onSubmit: async body => {
        if (dialog.kind === 'download') { const result = await financeRest(`${path}/cost-excel`, 'POST', body); financeDownloadBudgetTemplate(result.data); return }
        if (dialog.kind === 'acTarget') return run(`/ce/nodes/${body.nodeId}/ac-target`, { unitCost: body.unitCost, source: body.source.trim() }, 'PUT')
        if (dialog.kind === 'procurement') return run(`/ce/nodes/${body.nodeId}/procurement`, { sorNo: (body.sorNo || '').trim(), sourcing: (body.sourcing || '').trim() }, 'PATCH')
        if (dialog.kind === 'pricing') {
          const pricing = { ...body.pricing, isNominated: body.nominated === 'true' }
          if (!Number.isInteger(pricing.reductionYears)) throw new Error('年降年数必须为整数')
          if (body.allocation === 'MATERIAL') pricing.costBreakdown = { directMaterial: pricing.acUnitPrice, directLabor: 0, otherManufacturing: 0 }
          if (body.allocation === 'CUSTOM' && Math.abs(Object.values(pricing.costBreakdown || {}).reduce((sum, value) => sum + value, 0) - pricing.acUnitPrice) > 0.00005) throw new Error('分项之和必须等于预测AC单价')
          return run(`/ce/nodes/${body.nodeId}/estimate`, { nodeId: body.nodeId, algo: 'BOTTOM_UP', pricing, applyToSamePart: body.samePart === 'true' })
        }
        if (dialog.kind === 'importJson') {
          let nodes
          try { nodes = JSON.parse(body.nodesJson) } catch { throw new Error('BOM 行必须是合法 JSON 数组') }
          if (!Array.isArray(nodes) || !nodes.length || nodes.length > 200 || nodes.some(node => !node || Array.isArray(node) || typeof node !== 'object' || !node.name)) throw new Error('请提供 1—200 行带物料名称的 BOM 记录')
          return run(`${path}/nodes`, { nodes: nodes.map(node => ({ ...node, partNo: node.partNo || null, parentPartNo: node.parentPartNo || null })) })
        }
        if (dialog.kind === 'estimate') return run(`/ce/nodes/${body.nodeId}/estimate`, { ...body, algo: 'BOTTOM_UP' })
        if (dialog.kind === 'change') {
          if (!body.estimate && body.qty === undefined) throw new Error('请填写新用量或至少一项估算金额')
          const { title, ...change } = body
          return run(`${path}/changes`, { title, changes: [change] })
        }
        if (dialog.kind === 'breakdown') { setBreakdown(await run(`${path}/breakdown`, body)); return }
        if (dialog.kind === 'quote') {
          body.currency = String(body.currency || '').trim().toUpperCase()
          if (!/^[A-Z]{3}$/.test(body.currency) || !(body.price > 0) || Math.abs(body.price * 10000 - Math.round(body.price * 10000)) > 0.0001) throw new Error('币种须为三位大写字母，报价须大于0且最多四位小数')
          return run(`${path}/quotes`, body)
        }
        if (dialog.kind === 'params') {
          let extra = {}
          if (body.paramsJson) {
            try { extra = JSON.parse(body.paramsJson) } catch { throw new Error('扩展业务参数必须是合法 JSON 对象') }
            if (!extra || Array.isArray(extra) || typeof extra !== 'object') throw new Error('扩展业务参数必须是 JSON 对象')
          }
          return run(`${path}/param-versions`, { version: body.version, note: body.note, params: { ...extra, ...body.params } })
        }
        if (dialog.kind === 'review') return run(`${path}/review`, { ...body, action: dialog.reviewAction })
        if (dialog.kind === 'apply' || dialog.kind === 'cancel') return run(`/ce/changes/${dialog.id}/${dialog.kind}`, body)
        if (dialog.kind === 'export') { const result = await run(`${path}/exports`, body); setPendingExport(result.id); return }
        if (dialog.kind === 'completeExport') { await run(`/ce/exports/${pendingExport}/complete`, { fileRef: body.fileRef || null, success: body.success === 'true' }); setPendingExport(null) }
      } }) : null)
}

function FinanceEbomExcel({ packageId, onChanged }) {
  const [preview, setPreview] = useState(null), [page, setPage] = useState(1), [keyword, setKeyword] = useState('')
  const [acknowledged, setAcknowledged] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const lock = useRef(false)
  const run = async operation => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await operation() } catch (cause) { setError(cause.message); setPreview(null) }
    finally { lock.current = false; setBusy(false) }
  }
  const filtered = (preview?.nodes || []).filter(row => `${row.partNo || ''} ${row.name}`.toLowerCase().includes(keyword.trim().toLowerCase()))
  return h(Card, { title: 'EBOM Excel 导入' },
    h('p', { className: 'sf-note' }, '上传非空、8 MB 以内的 .xlsx；先核对结构和原始字段，再确认导入。已有装配位置会跳过，不覆盖价格与结构。'),
    h('input', { type: 'file', accept: '.xlsx', 'aria-label': '上传 EBOM Excel 并预览', disabled: busy, onChange: event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; void run(async () => {
      setPreview(null); setAcknowledged(false); setPage(1); setKeyword('')
      if (!/\.xlsx$/i.test(file.name) || !file.size || file.size > 8 * 1024 * 1024 || file.name.length > 255) throw new Error('请选择非空、8 MB 以内的 .xlsx 文件，文件名最多 255 字')
      const contentBase64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('读取文件失败')); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.readAsDataURL(file) })
      const result = await financeRest(`/ce/packages/${packageId}/ebom/preview`, 'POST', { fileName: file.name, contentBase64 }); setPreview(result.data)
    }) } }),
    busy ? h('p', { role: 'status' }, '正在处理 EBOM…') : null,
    error ? h('p', { role: 'alert' }, error) : null,
    notice ? h('p', { role: 'status' }, notice) : null,
    preview ? h('div', { className: 'sf-stack' },
      h('p', null, `预览 ${preview.rowCount} 条 · 预计新增 ${preview.newCount ?? '待核对'} 条 · 已有位置 ${preview.existingCount ?? preview.duplicateCount} 条`),
      ...preview.warnings.map((warning, key) => h('p', { key, className: 'sf-note' }, warning)),
      h(Field, { value: keyword, onChange: value => { setKeyword(value); setPage(1) }, 'aria-label': '搜索预览零件', placeholder: '按零件号或名称核对预览' }),
      h(Table, { tableId: 'finance-ebom-preview', rows: filtered.slice((page - 1) * 20, page * 20), columns: [
        ...financeColumns([['partNo', '零件号'], ['name', '名称'], ['level', '级别'], ['parentPartNo', '父总成'], ['qty', '对父件用量']]),
        { key: 'sourceData', label: '原始字段', render: row => h('details', null, h('summary', null, '查看原始字段'), h(FinanceEvidence, { value: row.sourceData })) },
      ], empty: '无匹配零件' }), h(Pager, { page, total: filtered.length, limit: 20, onPage: setPage }),
      h('label', null, h('input', { type: 'checkbox', checked: acknowledged, disabled: busy, onChange: event => setAcknowledged(event.target.checked) }), '已核对结构、用量及提示，确认导入当前成本包'),
      h(PrimaryButton, { busy, disabled: !acknowledged || !preview.nodes.length, onClick: () => run(async () => { const result = await financeRest(`/ce/packages/${packageId}/nodes`, 'POST', { nodes: preview.nodes }); setPreview(null); setNotice(`导入完成：新增 ${result.data.created}，已有装配位置跳过 ${result.data.skipped}`); onChanged() }) }, '确认导入 EBOM')) : null)
}
function FinanceQuoteApply({ packageId, quote, nodes, onClose, onChanged }) {
  const [nodeId, setNodeId] = useState(''), [mode, setMode] = useState(''), [allocation, setAllocation] = useState('')
  const [parts, setParts] = useState({ directMaterial: '', directLabor: '', otherManufacturing: '' })
  const [preview, setPreview] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const lock = useRef(false)
  const change = operation => { operation(); setPreview(null); setError('') }
  const matches = nodes.filter(node => node.partNo?.trim() === quote.partNo?.trim() && !node.coveredBy)
  const run = async apply => {
    if (lock.current) return
    if (!matches.some(row => row.id === nodeId) || !['PACKAGE', 'OWN'].includes(mode) || !allocation) { setError('请选择装配位置、计价及分项口径'); return }
    const breakdown = allocation === 'MATERIAL' ? { directMaterial: quote.price, directLabor: 0, otherManufacturing: 0 } : allocation === 'CUSTOM' ? Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, value.trim() ? Number(value) : NaN])) : undefined
    if (breakdown && (Object.values(breakdown).some(value => !Number.isFinite(value) || value < 0 || Math.abs(value * 10000 - Math.round(value * 10000)) > 0.0001) || Math.abs(Object.values(breakdown).reduce((sum, value) => sum + value, 0) - quote.price) > 0.00005)) { setError('请完整填写最多四位小数的非负分项，分项之和须等于报价'); return }
    if (apply && !preview) return
    lock.current = true; setBusy(true); setError('')
    try {
      const body = { nodeId, pricingMode: mode, ...(breakdown ? { costBreakdown: breakdown } : {}) }
      const result = await financeRest(`/ce/packages/${packageId}/quotes/${quote.id}/${apply ? 'apply' : 'preview'}`, 'POST', apply ? { ...body, baseline: preview.baseline } : body)
      if (apply) { onChanged(); onClose() } else setPreview(result.data)
    } catch (cause) { setError(cause.message); setPreview(null) }
    finally { lock.current = false; setBusy(false) }
  }
  return h(Dialog, { title: '预览并采用供应商报价', dismissDisabled: busy, onClose: busy ? undefined : onClose },
    h('div', { className: 'sf-stack' },
      h('p', null, `${quote.supplierName} · ${quote.partNo || '未指定零件'} · ${formatNumber(quote.price)} ${quote.currency}；仅 CNY 报价可用于成本预测。`),
      h(SearchSelect, { 'aria-label': '报价装配位置', value: nodeId, disabled: busy, options: matches.map(row => [row.id, `${row.partNo} ${row.name} · ${row.sourceKey || row.id}`]), placeholder: '选择装配位置', onChange: value => change(() => setNodeId(value)) }),
      h(Select, { 'aria-label': '报价计价口径', value: mode, disabled: busy, options: [['OWN', '仅当前位置自身成本'], ['PACKAGE', '总成包价（覆盖子件）']], placeholder: '选择计价口径', onChange: value => change(() => setMode(value)) }),
      h(Select, { 'aria-label': '报价分项口径', value: allocation, disabled: busy, options: [['UNALLOCATED', '保持待拆分'], ['MATERIAL', '全部计入直接材料'], ['CUSTOM', '手工分项']], placeholder: '选择分项口径', onChange: value => change(() => setAllocation(value)) }),
      allocation === 'CUSTOM' ? Object.entries({ directMaterial: '直接材料', directLabor: '直接人工', otherManufacturing: '其他制造成本' }).map(([key, label]) => h(FormRow, { key, label }, h(Field, { type: 'number', min: 0, step: '0.0001', disabled: busy, value: parts[key], onChange: value => change(() => setParts(current => ({ ...current, [key]: value }))) }))) : null,
      preview ? h('div', null, h('p', null, `正算总额：${formatNumber(preview.beforeTotal)} → ${formatNumber(preview.afterTotal)} 元；差额 ${formatNumber(preview.totalDelta)} 元`), h(Table, { tableId: 'finance-quote-cost-impact', rows: [['directMaterial', '直接材料'], ['directLabor', '直接人工'], ['otherManufacturing', '其他制造成本'], ['unallocated', '待拆分']].map(([key, label]) => ({ label, before: preview.beforeComposition?.[key], after: preview.afterComposition?.[key] })), columns: [{ key: 'label', label: '成本分项' }, { key: 'before', label: '采用前（元）', render: row => formatNumber(row.before) ?? '—' }, { key: 'after', label: '采用后（元）', render: row => formatNumber(row.after) ?? '—' }] }), h('p', { className: 'sf-note' }, `缺失单价位置：${preview.beforeMissingPriceCount ?? '—'} → ${preview.afterMissingPriceCount ?? '—'}。确认后更新成本预测，不改变独立AC目标。`)) : null,
      error ? h('p', { role: 'alert' }, error) : null,
      h('div', { className: 'sf-row' }, h(GhostButton, { disabled: busy || quote.currency !== 'CNY', onClick: () => run(false) }, '预览成本影响'), h(PrimaryButton, { busy, disabled: !preview || quote.currency !== 'CNY', onClick: () => run(true) }, '确认采用此报价'))))
}
