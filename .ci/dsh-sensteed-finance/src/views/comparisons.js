function ComparisonsView({ ctx }) {
  const [mode, setMode] = useFinanceViewState(ctx, 'comparisonMode', ctx.drillParams?.mode || 'monthly')
  const [targetYear, setTargetYear] = useFinanceViewState(ctx, 'comparisonTargetYear', String(Number(ctx.year) + 1))
  const [a, setA] = useFinanceViewState(ctx, 'comparisonBase', '')
  const [b, setB] = useFinanceViewState(ctx, 'comparisonTarget', '')
  const [dialog, setDialog] = useState(null)
  const action = useFinanceAction()
  const revision = `${ctx.revision}-${action.revision}`
  const versions = useFinanceResource(`/finance/budget/versions?year=${ctx.year}`, revision)
  const targetVersions = useFinanceResource(mode === 'yearly' ? `/finance/budget/versions?year=${targetYear}` : null, revision)
  const snapshots = useFinanceResource(mode === 'monthly' ? `/finance/budget-snapshots?year=${ctx.year}` : null, revision)
  const baseRows = mode === 'monthly' ? financeRows(snapshots.data).filter(row => row.status === 'ACTIVE') : financeRows(versions.data)
  const targetRows = mode === 'yearly' ? financeRows(targetVersions.data) : baseRows
  const validA = baseRows.some(row => row.id === a) ? a : mode === 'monthly' ? baseRows[1]?.id || baseRows[0]?.id || '' : baseRows.find(row => row.isPrimary)?.id || baseRows.find(row => row.status === 'PUBLISHED')?.id || baseRows[0]?.id || ''
  const validB = targetRows.some(row => row.id === b) ? b : mode === 'yearly' ? targetRows.find(row => row.isPrimary)?.id || targetRows.find(row => row.status === 'PUBLISHED')?.id || targetRows[0]?.id || '' : targetRows.find(row => row.id !== validA)?.id || ''
  const path = validA && validB && validA !== validB ? mode === 'monthly' ? `/finance/budget-snapshots/compare?snapshotAId=${validA}&snapshotBId=${validB}` : mode === 'versions' ? `/finance/budget-versions/detail-diff?baseVersionId=${validA}&targetVersionId=${validB}` : `/finance/budget/versions/diff?baseVersionId=${validA}&targetVersionId=${validB}` : null
  const comparison = useFinanceResource(path, revision)
  const versionLabel = row => mode === 'monthly' ? `${row.label} · 已冻结${row.frozenThroughMonth}个月 / 剩余预测${12 - row.frozenThroughMonth}个月` : `${row.name} · ${financeDisplayValue(row.status, 'status')}${row.isPrimary ? ' · 主版本' : ''}`
  const selectedVersions = [baseRows.find(row => row.id === validA), targetRows.find(row => row.id === validB)]
  const trial = mode !== 'monthly' && selectedVersions.some(row => row?.status === 'DRAFT' || row?.status === 'CONFIRMED')
  const rows = financeRows(comparison.data)
  const comparable = mode === 'yearly' ? rows.filter(row => (row.basePresent ?? row.baseBudget !== 0) && (row.targetPresent ?? row.targetBudget !== 0)) : rows
  const oneSided = mode === 'yearly' ? rows.filter(row => !(row.basePresent ?? row.baseBudget !== 0) || !(row.targetPresent ?? row.targetBudget !== 0)) : []
  const baseTotal = comparable.reduce((sum, row) => sum + row.baseBudget, 0), targetTotal = comparable.reduce((sum, row) => sum + row.targetBudget, 0)
  const targetOrgs = new Set(rows.filter(row => row.targetPresent ?? row.targetBudget !== 0).map(row => row.orgId))
  const covered = [...targetOrgs].filter(orgId => rows.some(row => row.orgId === orgId && (row.basePresent ?? row.baseBudget !== 0))).length
  return h('div', { className: 'sf-stack' },
    mode === 'monthly' && snapshots.data && baseRows.length < 2 ? h('p', { role: 'status' }, baseRows.length ? '当前仅有一份有效快照，请封存另一份月结快照后比较。' : '当前尚无有效快照，请先封存初始或月结快照。') : null,
    mode === 'versions' ? h(FinanceVersionsPanel, { ctx, resource: versions, onChanged: action.invalidate }) : null,
    validA && validB && validA === validB ? h('p', { role: 'status' }, '请选择不同的快照或预算版本') : null,
    mode === 'yearly' ? h(FormRow, { label: '对比年度' }, h(Select, { 'aria-label': '对比年度', value: targetYear, onChange: value => { setTargetYear(value); setB('') }, options: yearOptions(targetYear) })) : null,
    h('div', { className: 'sf-row' },
      h(Select, { 'aria-label': '基准快照或版本', value: validA, onChange: setA, options: baseRows.map(row => [row.id, versionLabel(row)]), placeholder: '选择基准' }),
      h(Select, { 'aria-label': '对比快照或版本', value: validB, onChange: setB, options: targetRows.map(row => [row.id, versionLabel(row)]), placeholder: '选择对比' })),
    [versions, targetVersions, snapshots].filter(resource => resource.error).map((resource, i) => h(FinanceResource, { key: i, resource })),
    mode === 'yearly' && comparison.data ? h('div', { className: 'sf-kpis' }, h(KpiCard, { label: '可比预算变化', value: formatNumber(targetTotal - baseTotal) }), h(KpiCard, { label: '可比预算变化率', value: baseTotal ? `${formatNumber((targetTotal - baseTotal) / Math.abs(baseTotal) * 100)}%` : '—' }), h(KpiCard, { label: '主体覆盖率', value: targetOrgs.size ? `${formatNumber(covered / targetOrgs.size * 100)}%` : '—' })) : null,
    trial ? h('p', { className: 'sf-banner sf-banner-amber' }, '试算比较：含未正式发布的预算版本，不能作为正式同比结论。') : null,
    h('p', { className: 'sf-note' }, mode === 'monthly' ? 'B−A 为全年预计差额。已发生金额与剩余预测分列，不能把已发生误认为预算增加。' : '差异采用服务端结果。单侧缺失项目单独展示，不计入年度同比结论。'),
    h(Card, { title: '预算比较结果', unit: '元' }, !path ? h('p', null, '请选择两份快照或预算版本') : h(FinanceResource, { resource: comparison }, h(Table, { tableId: `finance-compare-${mode}`, rows: comparable, empty: '暂无可比较项目', onRowClick: mode === 'versions' ? row => ctx.onNavigate('budget', { year: ctx.year, view: 'lines', versionId: validB, orgId: row.orgId || '', unassigned: !row.orgId, ...(row.departmentId ? { departmentId: row.departmentId } : {}), ...(row.expenseType ? { expenseType: row.expenseType } : {}), ...(row.month ? { month: row.month } : {}) }) : undefined, columns: financeColumns(mode === 'monthly' ? [['orgName', '主体'], ['aForecast', 'A 全年预计'], ['bActual', 'B 已发生'], ['bRemaining', 'B 剩余预测'], ['bForecast', 'B 全年预计'], ['diff', '差额'], ['changeRate', '变化率']] : mode === 'versions' ? [['orgName', '主体'], ['departmentName', '部门'], ['costItemName', '费用项'], ['baseAmount', '基准金额'], ['targetAmount', '对比金额'], ['diff', '差额'], ['changeType', '变化类型']] : [['orgName', '主体'], ['expenseType', '费用类别'], ['baseBudget', '基准年度金额'], ['targetBudget', '对比年度金额'], ['diff', '差额']]) }))),
    oneSided.length ? h(Card, { title: '单侧缺失：不计入同比结论', unit: '元' }, h(Table, { tableId: 'finance-compare-one-sided', rows: oneSided, empty: '无单侧缺失', columns: financeColumns([['orgName', '主体'], ['expenseType', '费用类别'], ['baseBudget', '基准年度金额'], ['targetBudget', '对比年度金额']]) })) : null,
    mode === 'monthly' && comparison.data?.bUnsplitAmount ? h('p', { role: 'status' }, `B 版本未分月金额 ${formatNumber(comparison.data.bUnsplitAmount)} 元，仅计入全年预计。`) : null,
    mode === 'monthly' && ctx.financeWriter && ctx.permissions.includes('budget.version.publish') ? h(GhostButton, { onClick: () => setDialog({ title: '封存月结快照' }) }, '封存月结快照') : null,
    h(Notice, null, action.notice),
    dialog ? h(FinanceFormDialog, { title: dialog.title, fields: [{ key: 'versionId', label: '预算版本', options: financeRows(versions.data).map(row => [row.id, row.name]), required: true }, { key: 'month', label: '月结月份（0 为初始）', type: 'number', min: 0, max: 12, required: true }, { key: 'label', label: '快照名称' }, { key: 'note', label: '说明' }], onClose: () => setDialog(null), onSubmit: body => action.run('/finance/budget-snapshots', body) }) : null)
}

function FinanceVersionsPanel({ ctx, resource, onChanged }) {
  const [dialog, setDialog] = useState(null)
  const action = useFinanceAction()
  const canManage = ctx.financeWriter && ctx.permissions.includes('budget.version.manage')
  const canPublish = ctx.financeWriter && ctx.permissions.includes('budget.version.publish')
  const rows = financeRows(resource.data)
  const open = (kind, row) => setDialog({ kind, row })
  const labels = { create: '新建预算草稿', clone: '复制预算草稿', confirm: '确认预算版本', activate: '发布正式预算', lock: '锁定预算版本' }
  return h(Card, { title: `预算版本 · ${ctx.year} 年`, actions: canManage ? [h(GhostButton, { key: 'create', disabled: action.busy, onClick: () => open('create') }, labels.create)] : [] },
    h('p', { className: 'sf-note' }, '新建草稿 → 发起填报或编制 → 确认 → 发布 → 锁定。未发布版本只用于编制与试算。'),
    h(Notice, null, action.notice),
    h(FinanceResource, { resource }, h(Table, { tableId: 'finance-version-management', rows, empty: '该年度暂无版本，请先新建预算草稿，再发起预算填报活动。', columns: [
      ...financeColumns([['name', '版本名称'], ['status', '状态'], ['isPrimary', '主版本'], ['lineCount', '明细行数'], ['budgetTotal', '预算总额（元）']]),
      { key: 'actions', label: '操作', render: row => h('div', { className: 'sf-row' },
        h(GhostButton, { onClick: () => ctx.onNavigate('engine', { year: ctx.year, versionId: row.id }) }, '查看编制'),
        h(GhostButton, { onClick: () => ctx.onNavigate('budget', { year: ctx.year, orgId: '', view: 'lines', versionId: row.id }) }, '查看预算明细'),
        ...['clone', ...(row.status === 'DRAFT' ? ['confirm'] : row.status === 'CONFIRMED' ? ['activate'] : row.status === 'PUBLISHED' ? ['lock'] : [])].filter(kind => ['activate', 'lock'].includes(kind) ? canPublish : canManage).map(kind => h(GhostButton, { key: kind, disabled: action.busy, onClick: () => open(kind, row) }, labels[kind]))) },
    ] })),
    dialog ? h(FinanceFormDialog, { title: labels[dialog.kind], description: dialog.row ? `${dialog.row.name} · ${financeDisplayValue(dialog.row.status, 'status')} · ${dialog.row.lineCount} 行 · 预算 ${formatNumber(dialog.row.budgetTotal)} 元。发布将切换正式预算口径，锁定后不能继续修改。` : `${ctx.year} 年空白初始预算；创建后可在填报活动中选择。`, fields: ['create', 'clone'].includes(dialog.kind) ? [{ key: dialog.kind === 'create' ? 'name' : 'newName', label: '预算版本名称', required: true, maxLength: 150 }] : [], onClose: () => setDialog(null), onSubmit: async body => {
      if (dialog.kind === 'create') body = { year: Number(ctx.year), name: String(body.name || '').trim() }
      if (['create', 'clone'].includes(dialog.kind) && !String(body.name || body.newName || '').trim()) throw new Error('请填写预算版本名称')
      await action.run(dialog.kind === 'create' ? '/finance/budget/versions' : `/finance/budget/versions/${dialog.row.id}/${dialog.kind}`, body)
      onChanged()
    } }) : null)
}
