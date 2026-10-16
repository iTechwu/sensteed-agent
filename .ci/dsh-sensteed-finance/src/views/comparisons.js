function ComparisonsView({ ctx }) {
  const [mode, setMode] = useState(ctx.drillParams?.mode || 'monthly')
  const [targetYear, setTargetYear] = useState(String(Number(ctx.year) + 1))
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [dialog, setDialog] = useState(null)
  const action = useFinanceAction()
  const revision = `${ctx.revision}-${action.revision}`
  const versions = useFinanceResource(`/finance/budget/versions?year=${ctx.year}`, revision)
  const targetVersions = useFinanceResource(mode === 'yearly' ? `/finance/budget/versions?year=${targetYear}` : null, revision)
  const snapshots = useFinanceResource(mode === 'monthly' ? `/finance/budget-snapshots?year=${ctx.year}` : null, revision)
  const baseRows = mode === 'monthly' ? financeRows(snapshots.data).filter(row => row.status === 'ACTIVE') : financeRows(versions.data)
  const targetRows = mode === 'yearly' ? financeRows(targetVersions.data) : baseRows
  const validA = baseRows.some(row => row.id === a) ? a : ''
  const validB = targetRows.some(row => row.id === b) ? b : ''
  const path = validA && validB ? mode === 'monthly' ? `/finance/budget-snapshots/compare?snapshotAId=${validA}&snapshotBId=${validB}` : mode === 'versions' ? `/finance/budget-versions/detail-diff?baseVersionId=${validA}&targetVersionId=${validB}` : `/finance/budget/versions/diff?baseVersionId=${validA}&targetVersionId=${validB}` : null
  const comparison = useFinanceResource(path, revision)
  useEffect(() => { setA(''); setB(''); setDialog(null) }, [mode, ctx.year, targetYear])
  const versionLabel = row => mode === 'monthly' ? `${row.label} · ${row.frozenThroughMonth}+${12 - row.frozenThroughMonth}` : `${row.name} · ${financeDisplayValue(row.status, 'status')}${row.isPrimary ? ' · 主版本' : ''}`
  const selectedVersions = [baseRows.find(row => row.id === validA), targetRows.find(row => row.id === validB)]
  const trial = mode !== 'monthly' && selectedVersions.some(row => row?.status === 'DRAFT' || row?.status === 'CONFIRMED')
  const rows = financeRows(comparison.data)
  const comparable = mode === 'yearly' ? rows.filter(row => row.baseBudget !== 0 && row.targetBudget !== 0) : rows
  const oneSided = mode === 'yearly' ? rows.filter(row => row.baseBudget === 0 || row.targetBudget === 0) : []
  return h('div', { className: 'sf-stack' },
    mode === 'yearly' ? h(FormRow, { label: '对比年度' }, h(Select, { 'aria-label': '对比年度', value: targetYear, onChange: setTargetYear, options: yearOptions(targetYear) })) : null,
    h('div', { className: 'sf-row' },
      h(Select, { 'aria-label': '基准快照或版本', value: validA, onChange: setA, options: baseRows.map(row => [row.id, versionLabel(row)]), placeholder: '选择基准' }),
      h(Select, { 'aria-label': '对比快照或版本', value: validB, onChange: setB, options: targetRows.map(row => [row.id, versionLabel(row)]), placeholder: '选择对比' })),
    [versions, targetVersions, snapshots].filter(resource => resource.error).map((resource, i) => h(FinanceResource, { key: i, resource })),
    trial ? h('p', { className: 'sf-banner sf-banner-amber' }, '试算比较：含未正式发布的预算版本，不能作为正式同比结论。') : null,
    h('p', { className: 'sf-note' }, mode === 'monthly' ? 'B−A 为全年预计差额。已发生金额与剩余预测分列，不能把已发生误认为预算增加。' : '差异采用服务端结果。单侧缺失项目单独展示，不计入年度同比结论。'),
    h(Card, { title: '预算比较结果', unit: '元' }, !path ? h('p', null, '请选择两份快照或预算版本') : h(FinanceResource, { resource: comparison }, h(Table, { tableId: `finance-compare-${mode}`, rows: comparable, empty: '暂无可比较项目', columns: financeColumns(mode === 'monthly' ? [['orgName', '主体'], ['aForecast', 'A 全年预计'], ['bActual', 'B 已发生'], ['bRemaining', 'B 剩余预测'], ['bForecast', 'B 全年预计'], ['diff', '差额'], ['changeRate', '变化率']] : mode === 'versions' ? [['orgName', '主体'], ['departmentName', '部门'], ['costItemName', '费用项'], ['baseAmount', '基准金额'], ['targetAmount', '对比金额'], ['diff', '差额'], ['changeType', '变化类型']] : [['orgName', '主体'], ['expenseType', '费用类别'], ['baseBudget', '基准年度金额'], ['targetBudget', '对比年度金额'], ['diff', '差额']]) }))),
    oneSided.length ? h(Card, { title: '单侧缺失：不计入同比结论', unit: '元' }, h(Table, { tableId: 'finance-compare-one-sided', rows: oneSided, empty: '无单侧缺失', columns: financeColumns([['orgName', '主体'], ['expenseType', '费用类别'], ['baseBudget', '基准年度金额'], ['targetBudget', '对比年度金额']]) })) : null,
    mode === 'monthly' && comparison.data?.bUnsplitAmount ? h('p', { role: 'status' }, `B 版本未分月金额 ${formatNumber(comparison.data.bUnsplitAmount)} 元，仅计入全年预计。`) : null,
    mode === 'monthly' && ctx.financeWriter && ctx.permissions.includes('budget.version.publish') ? h(GhostButton, { onClick: () => setDialog({ title: '封存月结快照' }) }, '封存月结快照') : null,
    h(Notice, null, action.notice),
    dialog ? h(FinanceFormDialog, { title: dialog.title, fields: [{ key: 'versionId', label: '预算版本', options: financeRows(versions.data).map(row => [row.id, row.name]), required: true }, { key: 'month', label: '月结月份（0 为初始）', type: 'number', min: 0, max: 12, required: true }, { key: 'label', label: '快照名称' }, { key: 'note', label: '说明' }], onClose: () => setDialog(null), onSubmit: body => action.run('/finance/budget-snapshots', body) }) : null)
}
