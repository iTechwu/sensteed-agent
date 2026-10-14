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
          { key: 'status', label: t('bomStatus'), render: row => t(`bomStatus${row.status}`) },
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
  const run = async (target, body) => { const result = await action.run(target, body); setReceipt(result); onChanged(); return result }
  const fields = (entries) => entries.map(([key, label, type, required]) => ({ key, label, type, required }))
  const nodeOptions = (detail?.nodes || []).map(node => [node.id, `${node.partNo || ''} ${node.name}`])
  const costFields = fields([['materialCost', '材料费（元）', 'number'], ['laborCost', '人工费（元）', 'number'], ['processCost', '加工费（元）', 'number'], ['otherCost', '其他费用（元）', 'number']])
  const status = detail?.package?.status
  const reviewActions = status === 'DRAFT' ? [['SUBMIT_REVIEW', '提交评审']] : status === 'IN_REVIEW' ? [['APPROVE', '批准'], ['REJECT', '驳回']] : status === 'APPROVED' ? [['OBSOLETE', '作废']] : []
  return h('div', { className: 'sf-stack' },
    action.notice ? h(Notice, null, action.notice) : null,
    writer ? h(Card, { title: '成本工程操作', unit: '元' }, h('div', { className: 'sf-row' },
      ...[['import', '逐行导入 BOM'], ['importJson', '批量导入 BOM'], ['estimate', '维护估算'], ['breakdown', '目标成本反算'], ['change', '模拟工程变更'], ['quote', '登记报价'], ['params', '新建参数版本'], ['export', '创建导出批次']].map(([kind, label]) => h(GhostButton, { key: kind, disabled: action.busy, onClick: () => setDialog({ kind, title: label }) }, label)),
      ...reviewActions.map(([reviewAction, title]) => h(GhostButton, { key: reviewAction, disabled: action.busy, onClick: () => setDialog({ kind: 'review', reviewAction, title }) }, title)))) : null,
    receipt ? h(Card, { title: '操作回执与模拟结果' }, h(FinanceEvidence, { value: receipt })) : null,
    breakdown ? h(Card, { title: '目标成本反算（服务端结果）', unit: '元' }, h(Table, { tableId: 'bom-breakdown', rows: breakdown.entries || [], empty: '暂无结果', columns: financeColumns([['nodeId', '物料节点'], ['estimateUnitCost', '估算单位成本'], ['targetUnitCost', '目标单位成本'], ['gap', '缺口']]) })) : null,
    h(Card, { title: '工程变更与模拟差异' }, h(FinanceResource, { resource: changes }, h(Table, { tableId: 'bom-changes', rows: financeRows(changes.data), empty: '暂无工程变更', columns: [
      ...financeColumns([['title', '变更名称'], ['status', '状态'], ['affectedCount', '影响节点'], ['payload', '模拟证据']]),
      { key: 'actions', label: '操作', sortable: false, render: row => writer && row.status === 'PROPOSED' ? h('div', { className: 'sf-row' }, ...[['apply', '确认落账'], ['cancel', '撤销提案']].map(([kind, title]) => h(GhostButton, { key: kind, disabled: action.busy, onClick: () => setDialog({ kind, title, id: row.id }) }, title))) : null },
    ] }))),
    ...[[quotes, '供应商报价', [['supplierName', '供应商'], ['partNo', '零件号'], ['price', '报价（元）'], ['currency', '币种'], ['batchNo', '报价批次']]],
      [params, '参数版本', [['version', '版本'], ['params', '参数'], ['note', '说明'], ['createdAt', '创建时间']]],
      [approvals, '审批与操作留痕', [['action', '操作'], ['actorName', '操作者'], ['note', '说明'], ['createdAt', '时间']]]].map(([resource, title, columns]) => h(Card, { key: title, title }, h(FinanceResource, { resource }, h(Table, { tableId: `bom-${title}`, rows: financeRows(resource.data), columns: financeColumns(columns), empty: '暂无记录' })))),
    pendingExport ? h(Card, { title: '导出批次回写' }, h('p', null, `批次 ${pendingExport}`), h(GhostButton, { disabled: action.busy, onClick: () => setDialog({ kind: 'completeExport', title: '回写导出结果' }) }, '回写结果')) : null,
    dialog?.kind === 'import' ? h(FinanceRowsDialog, { title: dialog.title, fields: fields([['partNo', '零件号'], ['name', '物料名称', 'text', true], ['parentPartNo', '父级零件号'], ['level', '层级', 'number'], ['qty', '用量', 'number', true]]), initial: [{ qty: 1 }], onClose: () => setDialog(null), onSubmit: nodes => run(`${path}/nodes`, { nodes: nodes.map(node => ({ ...node, partNo: node.partNo || null, parentPartNo: node.parentPartNo || null })) }) }) : null,
    dialog && dialog.kind !== 'import' ? h(FinanceFormDialog, { title: dialog.title, onClose: () => setDialog(null),
      fields: dialog.kind === 'importJson' ? [{ key: 'nodesJson', label: 'BOM 行（JSON 数组，最多 200 行）', type: 'textarea', maxLength: 200000, required: true }] : dialog.kind === 'estimate' ? [{ key: 'nodeId', label: '物料节点', options: nodeOptions, required: true }, ...costFields, { key: 'paramVersionId', label: '参数版本', options: financeRows(params.data).map(row => [row.id, row.version]) }, { key: 'sourceRef', label: '来源引用' }]
        : dialog.kind === 'change' ? [{ key: 'title', label: '变更名称', required: true }, { key: 'nodeId', label: '物料节点', options: nodeOptions, required: true }, { key: 'qty', label: '新用量', type: 'number', min: 0.000001 }, ...costFields.map(field => ({ ...field, key: `estimate.${field.key}` }))]
        : dialog.kind === 'quote' ? fields([['supplierName', '供应商', 'text', true], ['partNo', '零件号'], ['price', '单价（元）', 'number', true], ['currency', '币种'], ['batchNo', '报价批次']])
        : dialog.kind === 'params' ? fields([['version', '版本号', 'text', true], ['params.laborRate', '人工费率', 'number'], ['params.overheadRate', '制造费率', 'number'], ['note', '说明']]).concat([{ key: 'paramsJson', label: '扩展业务参数（JSON 对象，可选）', type: 'textarea', maxLength: 32000 }])
        : dialog.kind === 'breakdown' ? [{ key: 'targetCost', label: '目标成本（元）', type: 'number', min: 0.000001 }]
        : dialog.kind === 'export' ? [{ key: 'target', label: '目标系统', required: true }]
        : dialog.kind === 'completeExport' ? [{ key: 'fileRef', label: '文件引用' }, { key: 'success', label: '导出结果', options: [['true', '成功'], ['false', '失败']], required: true }]
        : dialog.kind === 'apply' ? [] : [{ key: 'note', label: '说明', type: 'textarea' }],
      initial: dialog.kind === 'export' ? { target: 'SAP' } : dialog.kind === 'params' ? { version: 'P1' } : {},
      onSubmit: async body => {
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
        if (dialog.kind === 'quote') return run(`${path}/quotes`, body)
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
