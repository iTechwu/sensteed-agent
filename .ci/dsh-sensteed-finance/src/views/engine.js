const BUDGET_OUTPUT_LABELS = { REVENUE: '收入', RECEIPT: '回款', CASH_BALANCE: '月末现金', FUNDING_GAP: '资金缺口', TAX: '应缴税费', PAYMENT: '实际付款', INVENTORY_HOLDING: '存货占用', LABOR_COST: '人工成本', OVERHEAD_COST: '制造费用' }
function EngineView({ ctx }) {
  const [versionId, setVersionId] = useState('')
  const [paramId, setParamId] = useState('')
  const [runId, setRunId] = useState('')
  const [baseRunId, setBaseRunId] = useState('')
  const [dialog, setDialog] = useState(null)
  const [receipt, setReceipt] = useState(null)
  const action = useFinanceAction()
  const revision = `${ctx.revision}-${action.revision}`
  const versions = useFinanceResource(`/finance/budget/versions?year=${ctx.year}`, revision)
  const rows = financeRows(versions.data)
  const version = rows.find(row => row.id === versionId)
  const validId = version?.id
  const draft = version?.status === 'DRAFT'
  const path = validId ? `/budget-engine/versions/${validId}` : null
  const params = useFinanceResource(path ? `${path}/params` : null, revision)
  const inputs = useFinanceResource(path ? `${path}/sales-inputs` : null, revision)
  const runs = useFinanceResource(path ? `${path}/runs` : null, revision)
  const ce = useFinanceResource(ctx.permissions.includes('cost.engineering.read') ? '/ce/packages?limit=50' : null, ctx.revision)
  const runRows = financeRows(runs.data)
  const validRun = runRows.some(row => row.id === runId) ? runId : ''
  const validBase = runRows.some(row => row.id === baseRunId) ? baseRunId : ''
  const outputs = useFinanceResource(validRun ? `/budget-engine/runs/${validRun}/outputs` : null, revision)
  const statements = useFinanceResource(validRun ? `/budget-engine/runs/${validRun}/statements` : null, revision)
  const diff = useFinanceResource(validRun && validBase ? `/budget-engine/runs/diff?baseRunId=${validBase}&targetRunId=${validRun}` : null, revision)
  const selectedParams = financeRows(params.data).find(row => row.id === paramId)
  useEffect(() => { setVersionId(''); setParamId(''); setRunId(''); setBaseRunId(''); setDialog(null) }, [ctx.year])
  const selectVersion = value => { setVersionId(value); setParamId(''); setRunId(''); setBaseRunId(''); setReceipt(null); setDialog(null) }
  const canEdit = ctx.financeWriter && ctx.permissions.includes('budget.version.manage')
  const canPublish = ctx.financeWriter && ctx.permissions.includes('budget.version.publish')
  const resultTable = (resource, title, columns) => h(Card, { title, unit: '元' }, h(FinanceResource, { resource }, h(Table, { tableId: `engine-${title}`, rows: financeRows(resource.data), empty: validId ? '暂无记录' : '请选择预算版本', columns: financeColumns(columns) })))
  const run = async (target, body, method) => { const result = await action.run(target, body, method); setReceipt(result); return result }
  return h('div', { className: 'sf-stack' },
    h(FinanceResource, { resource: versions }, h(FormRow, { label: '预算版本' }, h(Select, { 'aria-label': '编制预算版本', value: validId || '', options: rows.map(row => [row.id, `${row.name} · ${financeLabel(row.status)}${row.isPrimary ? ' · 主版本' : ''}`]), placeholder: '选择预算版本', onChange: selectVersion }))),
    h(Notice, null, action.notice),
    version ? h('p', { className: 'sf-note' }, `${financeLabel(version.status)} · ${version.lineCount ?? 0} 行。草稿可编辑；确认、发布和锁定以服务端状态与发布检查为准。`) : null,
    validId && (canEdit || canPublish) ? h('div', { className: 'sf-row' },
      canEdit ? h(GhostButton, { disabled: action.busy, onClick: () => setDialog({ kind: 'roll', title: '创建滚动预测草稿' }) }, '创建滚动草稿') : null,
      draft && canEdit ? h(GhostButton, { disabled: action.busy, onClick: () => setDialog({ kind: 'params', title: '新建/更新预算参数' }) }, '维护预算参数') : null,
      draft && canEdit && selectedParams ? h(GhostButton, { disabled: action.busy, onClick: () => setDialog({ kind: 'outflows', title: '维护月度支出假设' }) }, '维护月度支出') : null,
      draft && canEdit ? h(GhostButton, { disabled: action.busy, onClick: () => setDialog({ kind: 'sales', title: '导入销量输入' }) }, '导入销量输入') : null,
      draft && canEdit ? h(GhostButton, { disabled: action.busy || !selectedParams, onClick: () => setDialog({ kind: 'calc', title: '确认按参数批次计算' }) }, '计算预算') : null,
      draft && canEdit ? h(GhostButton, { disabled: action.busy, onClick: () => setDialog({ kind: 'confirm', title: '确认预算版本' }) }, '确认版本') : null,
      canPublish && version.status === 'CONFIRMED' ? h(GhostButton, { disabled: action.busy, onClick: () => setDialog({ kind: 'activate', title: '发布正式预算版本' }) }, '发布版本') : null,
      canPublish && version.status === 'PUBLISHED' ? h(GhostButton, { disabled: action.busy, onClick: () => setDialog({ kind: 'lock', title: '锁定正式预算版本' }) }, '锁定版本') : null) : null,
    validId ? h(FormRow, { label: '计算使用的参数版本' }, h(Select, { 'aria-label': '预算参数版本', value: selectedParams?.id || '', onChange: setParamId, options: financeRows(params.data).map(row => [row.id, `${row.version} · ${row.sourceRef || '无来源引用'}`]), placeholder: '选择参数版本' })) : null,
    resultTable(params, '预算参数版本', [['version', '参数版本'], ['params', '业务假设'], ['sourceRef', '来源'], ['note', '说明'], ['createdAt', '时间']]),
    h(Card, { title: '销量输入' }, h(FinanceResource, { resource: inputs }, h(Table, { tableId: 'engine-sales', rows: financeRows(inputs.data), empty: '暂无输入', columns: [
      ...financeColumns([['product', '产品'], ['orgId', '主体'], ['year', '年度'], ['month', '月份'], ['quantity', '数量'], ['unitPrice', '单价（元）'], ['receiptRate', '回款率']]),
      { key: 'actions', label: '操作', sortable: false, render: row => canEdit && draft && canEdit ? h(GhostButton, { disabled: action.busy, onClick: () => setDialog({ kind: 'remove', title: '移除草稿销量输入', row }) }, '移除输入') : null },
    ] }))),
    resultTable(runs, '计算批次历史', [['formulaVersion', '公式版本'], ['status', '状态'], ['paramVersionId', '参数版本'], ['startedAt', '计算时间'], ['errorSummary', '失败原因']]),
    h('div', { className: 'sf-row' }, h(Select, { 'aria-label': '计算结果批次', value: validRun, onChange: setRunId, options: runRows.map(row => [row.id, `${row.formulaVersion} ${row.startedAt} ${financeLabel(row.status)}`]), placeholder: '选择计算结果' }), h(Select, { 'aria-label': '差异基准批次', value: validBase, onChange: setBaseRunId, options: runRows.map(row => [row.id, `${row.formulaVersion} ${row.startedAt}`]), placeholder: '选择差异基准' })),
    resultTable(outputs, '计算结果', [['kind', '指标'], ['year', '年度'], ['month', '月份'], ['amount', '金额']]),
    resultTable(diff, '计算批次差异', [['kind', '指标'], ['year', '年度'], ['month', '月份'], ['before', '基准'], ['after', '对比'], ['delta', '差额']]),
    h(FinanceResource, { resource: statements }, ...[['income', '管理利润表', [['revenue', '收入'], ['expense', '费用'], ['tax', '税费'], ['profit', '利润']]], ['cashflow', '管理现金流量表', [['inflow', '流入'], ['outflow', '流出'], ['endingBalance', '月末余额']]], ['balance', '简化资产负债表', [['cash', '现金'], ['receivable', '应收'], ['payable', '应付'], ['inventory', '存货'], ['equity', '权益']]]].map(([key, title, columns]) => h(Card, { key, title, unit: '元' }, h(Table, { tableId: `engine-${key}`, rows: statements.data?.[key] || [], columns: financeColumns([['year', '年度'], ['month', '月份'], ...columns]), empty: '请选择计算结果批次' })))),
    receipt ? h(Card, { title: '操作回执与异常行' }, h(FinanceEvidence, { value: receipt })) : null,
    dialog?.kind === 'sales' ? h(FinanceRowsDialog, { title: dialog.title, maxRows: 500, fields: [{ key: 'orgId', label: '主体', options: ctx.orgs.map(row => [row.id, row.name]), required: true }, { key: 'product', label: '产品', required: true }, ...[['year', '年度', 2000, 2100], ['month', '月份', 1, 12], ['quantity', '数量', 0.000001], ['unitPrice', '单价（元）', 0.000001], ['receiptRate', '回款率（0—1）', 0, 1]].map(([key, label, min, max]) => ({ key, label, type: 'number', required: true, min, max }))], initial: [{ year: ctx.year, month: 1, receiptRate: 0.6 }], onClose: () => setDialog(null), onSubmit: rows => run(`${path}/sales-inputs`, { rows }) }) : null,
    dialog?.kind === 'outflows' ? h(FinanceRowsDialog, { title: dialog.title, maxRows: 120, fields: [{ key: 'year', label: '年度', type: 'number', required: true }, { key: 'month', label: '月份', type: 'number', min: 1, max: 12, required: true }, { key: 'amount', label: '支出（元）', type: 'number', required: true }], initial: selectedParams.params.monthlyOutflows?.length ? selectedParams.params.monthlyOutflows : [{ year: ctx.year, month: 1, amount: 0 }], onClose: () => setDialog(null), onSubmit: rows => run(`${path}/params`, { version: selectedParams.version, params: { ...selectedParams.params, monthlyOutflows: rows }, sourceRef: selectedParams.sourceRef || undefined }, 'PUT') }) : null,
    dialog && !['sales', 'outflows'].includes(dialog.kind) ? h(FinanceFormDialog, { title: dialog.title, onClose: () => setDialog(null), initial: dialog.kind === 'params' ? { version: 'P1', params: { openingBalance: 0, safetyLine: 0 } } : dialog.kind === 'roll' ? { frozenThroughMonth: 0 } : {}, fields: dialog.kind === 'params' ? [
      { key: 'version', label: '参数版本号', required: true }, { key: 'params.openingBalance', label: '期初余额（元）', type: 'number', required: true }, { key: 'params.safetyLine', label: '现金安全线（元）', type: 'number', min: 0, required: true },
      { key: 'params.linkedCePackageId', label: '关联已批准成本包', options: financeRows(ce.data).filter(row => row.status === 'APPROVED').map(row => [row.id, `${row.name} · ${row.version}`]) },
      ...[['params.tax.outputRate', '销项税率', 0, 1], ['params.tax.inputRate', '进项税率', 0, 1], ['params.workingCapital.payableMonths', '应付账期（月）', 0, 6], ['params.workingCapital.inventoryDays', '存货周转（天）', 0, 365], ['params.labor.hoursPerUnit', '单台人工时', 0], ['params.labor.ratePerHour', '人工费率', 0], ['params.overhead.kwhPerUnit', '单台电耗', 0], ['params.overhead.pricePerKwh', '综合电价', 0], ['params.overhead.otherPerUnit', '其他单台制造费用', 0]].map(([key, label, min, max]) => ({ key, label, type: 'number', min, max })),
      { key: 'sourceRef', label: '来源引用' }, { key: 'note', label: '说明' },
    ] : dialog.kind === 'roll' ? [{ key: 'frozenThroughMonth', label: '冻结截至月份（0—12）', type: 'number', min: 0, max: 12, required: true }] : [],
    onSubmit: async body => {
      if (dialog.kind === 'params') {
        for (const [group, required] of [['tax', ['outputRate', 'inputRate']], ['labor', ['hoursPerUnit', 'ratePerHour']], ['overhead', ['kwhPerUnit', 'pricePerKwh']]]) if (body.params[group] && required.some(key => body.params[group][key] === undefined)) throw new Error('请完整填写对应税费、人工或制造参数')
        return run(`${path}/params`, body, 'PUT')
      }
      if (dialog.kind === 'calc') { const result = await run(`${path}/calc`, { paramVersionId: selectedParams.id }); setRunId(result.run.id); return }
      if (dialog.kind === 'roll') { const result = await run(`${path}/rollforward`, body); selectVersion(result.newVersionId); return }
      if (dialog.kind === 'remove') return run(`${path}/sales-inputs/${dialog.row.id}/remove`, {})
      return run(`/finance/budget/versions/${validId}/${dialog.kind}`, {})
    } }) : null)
}
