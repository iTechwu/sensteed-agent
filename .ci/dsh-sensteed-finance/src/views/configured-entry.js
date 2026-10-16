// Datasource 2027 年度配置录入：仅使用已导入的部门/费用映射，不能回退自由选科目。
function BudgetSaveReceipt({ line, onNavigate }) {
  if (!line?.id) return null
  return h('section', { className: 'sf-banner sf-banner-green sf-stack', role: 'status', 'aria-label': '预算保存回执' },
    h('strong', null, `预算行已保存并生效 · ${line.year} 年`),
    h('span', null, [line.orgName, line.departmentName, line.costItemName, line.month ? `${line.month}月` : '年度（不分月）', line.budgetAmount == null ? null : `${Number(line.budgetAmount).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元`].filter(Boolean).join(' · ')),
    h('span', null, `记录编号：${line.code || line.id}`),
    onNavigate ? h('div', { className: 'sf-row' },
      h(LinkButton, { onClick: () => onNavigate('budget', { view: 'lines', year: String(line.year), lineId: line.id }) }, '查看刚保存的预算行'),
      h(LinkButton, { onClick: () => onNavigate('budget', { view: 'lines', year: String(line.year) }) }, `查看 ${line.year} 年全部预算明细`)) : null)
}

function BudgetSavedRecordView({ ctx, t }) {
  const record = useFinanceResource(`/finance/budget/lines?year=${ctx.year}&lineId=${encodeURIComponent(ctx.drillParams.lineId)}&limit=1`, ctx.revision)
  return h('div', { className: 'sf-stack' },
    h(LinkButton, { onClick: () => ctx.onNavigate('budget', { view: 'lines', year: ctx.year }) }, `查看 ${ctx.year} 年全部预算明细`),
    h(FinanceResource, { resource: record },
      h(Card, { title: '刚保存的预算行' }, h(Table, { tableId: 'finance-saved-budget-line', rows: financeRows(record.data).filter(row => row.id === ctx.drillParams.lineId), empty: '未找到该记录或当前账号没有查看权限；请核对年度与记录编号。', columns: [
        ...financeColumns([['code', '记录编号'], ['orgName', '主体'], ['departmentName', '部门'], ['costItemName', '费用科目']]),
        { key: 'year', label: '年度', render: row => `${row.year}年` },
        { key: 'month', label: '月份', render: row => row.month ? `${row.month}月` : '年度（不分月）' },
        { key: 'budgetAmount', label: '预算金额（元）', render: row => Number(row.budgetAmount).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
        ...financeColumns([['note', '备注']]),
      ] }))))
}

function ConfiguredBudgetEntry({ year, orgId, orgs, t, onSaved, onBusyChange, onNavigate }) {
  const config = useFinanceResource(`/finance/budget-configuration?year=${year}`, 0)
  const versions = useFinanceResource(`/finance/budget/versions?year=${year}`, 0)
  const [subject, setSubject] = useState(orgId || orgs.find(org => org.type === 'COMPANY')?.id || orgs[0]?.id || '')
  const [parent, setParent] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [level1, setLevel1] = useState('')
  const [mappingCode, setMappingCode] = useState('')
  const [month, setMonth] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [failure, setFailure] = useState('')
  const [saved, setSaved] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const departments = config.data?.departments || []
  const departmentMappings = (config.data?.mappings || []).filter(mapping => mapping.departmentId === departmentId)
  const selected = departmentMappings.find(mapping => mapping.code === mappingCode && mapping.level1Name === level1)
  const department = departments.find(department => department.id === departmentId && department.parentName === parent)
  const primary = financeRows(versions.data).find(version => version.isPrimary && Number(version.year) === Number(year))
  const configured = config.data?.imported && Number(config.data.year) === Number(year) && !config.error
  const ready = Boolean(configured && primary && !versions.error && selected && department && orgs.some(org => org.id === subject))
  const unique = values => [...new Set(values)].map(value => [value, value])
  const submit = async event => {
    event.preventDefault()
    if (lock.current || !ready) return
    if (!amount.trim() || !Number.isFinite(Number(amount)) || Number(amount) <= 0 ||
      (month && (!Number.isInteger(Number(month)) || Number(month) < 1 || Number(month) > 12))) {
      setFailure(t('entryInvalid')); return
    }
    lock.current = true; setBusy(true); onBusyChange?.(true); setFailure(''); setSaved(false)
    try {
      const result = await financeRest('/finance/budget/lines', 'POST', {
        orgId: subject, year: Number(year), departmentId,
        expenseMappingCode: selected.code, costItemId: selected.costItemId, expenseType: selected.expenseType,
        budgetAmount: Number(amount), ...(month ? { month: Number(month) } : {}), ...(note.trim() ? { note: note.trim() } : {}),
      })
      setReceipt(result?.data?.id ? result.data : null)
      setParent(''); setDepartmentId(''); setLevel1(''); setMappingCode(''); setMonth(''); setAmount(''); setNote(''); setSaved(true)
      onSaved?.()
    } catch (error) { setFailure(error.message) }
    finally { lock.current = false; setBusy(false); onBusyChange?.(false) }
  }
  const retry = () => { config.retry(); versions.retry() }
  const status = config.loading || versions.loading ? '正在加载年度预算配置…'
    : config.error || versions.error ? '年度预算配置或版本加载失败，请重试。'
      : !configured ? `${year} 年度配置尚未导入，请联系财务负责人。`
        : !primary ? `${year} 年度暂无已发布主版本，请先完成预算编制与发布。`
          : `${year} 年度 · 已发布主版本：${primary.name}`
  return h('form', { onSubmit: submit, className: 'sf-stack' },
    h(BudgetSaveReceipt, { line: receipt, onNavigate }),
    h('div', { className: 'sf-banner', role: config.error || versions.error ? 'alert' : 'status' }, status,
      !config.loading && !versions.loading && (!configured || !primary || config.error || versions.error) ? h(LinkButton, { onClick: retry, disabled: busy }, t('retry')) : null),
    h('fieldset', { disabled: busy || !configured, 'aria-busy': busy, className: 'sf-fieldset sf-form sf-entry-form' },
      h(FormRow, { label: `${t('org')} *`, wide: true }, h(SearchSelect, { buttonTrigger: true, value: subject, onChange: setSubject, options: orgs.map(org => [org.id, org.name]), placeholder: t('org') })),
      h(FormRow, { label: '一级部门 *' }, h(SearchSelect, { buttonTrigger: true, value: parent, options: unique(departments.map(department => department.parentName)), placeholder: '选择一级部门', onChange: value => { setParent(value); setDepartmentId(''); setLevel1(''); setMappingCode(''); setSaved(false) } })),
      h(FormRow, { label: '二级部门 *' }, h(SearchSelect, { buttonTrigger: true, value: departmentId, disabled: !parent, options: departments.filter(department => department.parentName === parent).map(department => [department.id, department.name]), placeholder: '选择二级部门', onChange: value => { setDepartmentId(value); setLevel1(''); setMappingCode(''); setSaved(false) } })),
      h(FormRow, { label: '一级费用类别 *' }, h(SearchSelect, { buttonTrigger: true, value: level1, disabled: !departmentId, options: unique(departmentMappings.map(mapping => mapping.level1Name)), placeholder: '选择一级费用类别', onChange: value => { setLevel1(value); setMappingCode(''); setSaved(false) } })),
      h(FormRow, { label: `${t('costItem')} *` }, h(SearchSelect, { buttonTrigger: true, value: mappingCode, disabled: !level1, options: departmentMappings.filter(mapping => mapping.level1Name === level1).map(mapping => [mapping.code, `${mapping.level2Name} · ${t(EXPENSE_LABELS[mapping.expenseType])}（${mapping.sourceCode}）`]), placeholder: '选择费用科目', onChange: setMappingCode })),
      h(FormRow, { label: '三类费用（自动带出）' }, h(Field, { readOnly: true, value: selected ? t(EXPENSE_LABELS[selected.expenseType]) : '' })),
      h(FormRow, { label: t('month') }, h(Select, { value: month, onChange: setMonth, options: [['', t('entryAnnual')], ...Array.from({ length: 12 }, (_, index) => [String(index + 1), `${index + 1}月`])] })),
      departmentId && !departmentMappings.length ? h('p', { className: 'sf-note sf-entry-wide', role: 'status' }, '该部门暂无完整的费用映射，请先补全配置。') : null,
      h(FormRow, { label: `${t('budgetEntryAmount')}（${t('unitYuan')}） *`, wide: true }, h(Field, { type: 'number', min: 0.01, step: '0.01', required: true, value: amount, onChange: setAmount })),
      h(FormRow, { label: t('note'), wide: true }, h(Field, { maxLength: 500, value: note, onChange: setNote })),
      h('div', { className: 'sf-form-actions sf-entry-wide' }, h(PrimaryButton, { type: 'submit', busy, disabled: !ready }, busy ? t('running') : t('entrySaveAction')))),
    failure ? h('p', { role: 'alert', className: 'sf-neg' }, failure) : null,
    saved ? h('p', { role: 'status' }, t('entryBudgetSaved')) : null,
    config.data?.issues?.length ? h('p', { className: 'sf-note' }, `${config.data.issues.length} 条费用配置待补全，暂未纳入可选项。`) : null)
}
