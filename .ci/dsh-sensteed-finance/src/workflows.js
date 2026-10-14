// 与 Datasource 同一公开契约；此处只负责编排交互，不重算服务端财务指标。
function financeRest(path, method = 'GET', body) {
  return method === 'GET' ? api(`/rest${path}`) : financeWrite(path, method, body)
}
function financeWrite(path, method, body = {}) {
  const key = JSON.stringify([method, path, body])
  if (pendingWrites.has(key)) return pendingWrites.get(key)
  const operation = api(`/rest${path}`, { method, body: JSON.stringify(body) }).finally(() => pendingWrites.delete(key))
  pendingWrites.set(key, operation)
  return operation
}
function useFinanceResource(path, revision) {
  const [state, setState] = useState({ path: null, data: null, error: null })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let cancelled = false
    setState({ path, data: null, error: null })
    if (path) void financeRest(path).then(result => {
      if (!cancelled) setState({ path, data: result.data, error: null })
    }).catch(error => { if (!cancelled) setState({ path, data: null, error: error.message }) })
    return () => { cancelled = true }
  }, [path, revision, retry])
  const current = state.path === path ? state : { data: null, error: null }
  return { ...current, loading: Boolean(path) && current.data === null && !current.error, retry: () => setRetry(value => value + 1) }
}
function FinanceResource({ resource, children }) {
  return resource.error ? h('div', { role: 'alert', className: 'sf-fatal' }, resource.error, h(GhostButton, { onClick: resource.retry }, '重试加载'))
    : resource.loading ? h('div', { role: 'status', className: 'sf-loading' }, '加载中…') : children
}
function useFinanceAction() {
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [revision, setRevision] = useState(0)
  const run = async (path, body = {}, method = 'POST') => {
    if (lock.current) return null
    lock.current = true; setBusy(true); setNotice(null)
    try {
      const result = await financeRest(path, method, body)
      setNotice('操作成功'); setRevision(value => value + 1)
      window.dispatchEvent(new Event('sf:permissions-refresh'))
      return result.data
    } catch (error) { setNotice(error.message); throw error }
    finally { lock.current = false; setBusy(false) }
  }
  return { busy, notice, revision, run, invalidate: () => setRevision(value => value + 1), report: setNotice }
}
function financeRows(data) { return Array.isArray(data) ? data : data?.list || data?.rows || [] }
function financeColumns(fields) {
  return fields.map(([key, label]) => ({ key, label, render: row => {
    const value = key === 'taskTitle' ? row.taskTitle || row.task?.title : key === 'kind' ? BUDGET_OUTPUT_LABELS[row.kind] || row.kind : row[key]
    if (value === null || value === undefined) return '—'
    if (typeof value === 'number') return formatNumber(value)
    if (key === 'changeRate') return `${formatNumber(Number(value) * 100)}%`
    if (['status', 'scope', 'changeType', 'action', 'expenseType', 'planType', 'type', 'kind', 'category', 'bizSystem', 'docType', 'transport', 'dataset', 'stage', 'severity', 'formulaVersion'].includes(key)) return financeLabel(value)
    if (/At$/.test(key)) return new Date(value).toLocaleString('zh-CN', { hour12: false })
    if (typeof value === 'object') return h(FinanceEvidence, { value })
    return String(value)
  } }))
}
function FinanceEvidence({ value }) {
  if (value === null || value === undefined) return h('span', null, '—')
  if (typeof value !== 'object') return h('span', null, financeLabel(value))
  return h('div', { className: 'sf-evidence' }, ...Object.entries(value).map(([key, item]) =>
    h('div', { key, className: 'sf-evidence-item' }, h('small', null, FINANCE_FIELD_LABELS[key] || key), h(FinanceEvidence, { value: item }))))
}
const FINANCE_VALUE_LABELS = {
  GLOBAL: '全域', ORG: '指定主体', DEPARTMENT: '指定部门', SELF: '本人', HEADQUARTERS: '总部', HEZHONG: '合众',
  DRAFT: '草稿', CONFIRMED: '已确认', PUBLISHED: '已发布', LOCKED: '已锁定', OPEN: '开放中', CLOSED: '已关闭',
  PENDING: '待处理', SUBMITTED: '已提交', REJECTED: '已退回', VOIDED: '已作废', SUCCESS: '成功', FAILED: '失败', RUNNING: '处理中',
  APPROVED: '已批准', IN_REVIEW: '评审中', OBSOLETE: '已作废', PROPOSED: '待落账', APPLIED: '已落账', CANCELLED: '已撤销',
  ADDED: '新增', REMOVED: '移除', INCREASED: '调增', DECREASED: '调减', MOVED: '转移', SUBMIT_REVIEW: '提交评审', APPROVE: '批准', REJECT: '驳回',
  PURCHASE: '采购', REIMBURSEMENT: '报销', INCOME: '收入', PAYROLL: '薪酬', TAX: '税费', OTHER: '其他',
  PR_PAYMENT: 'PR付款', NEW_RETAIL: '新零售', DIRECT_PARTS: '直采零件', PROJECT_OPERATION: '项目运营', FIXED_OPERATION: '固定运营', MODEL_SPECIFIC: '模型专项', NON_PROJECT: '非项目',
  BUDGET: '预算', PAYMENT_PLAN: '付款计划', REVENUE_PLAN: '收入计划', BUDGET_LINE: '预算明细', CASH_SUMMARY: '资金汇总',
  FINANCE_PLAN: '财务计划', OA: 'OA系统', NC: 'NC系统', ERP: 'ERP系统', TREASURY: '资金系统', DSS: 'DSS', FEISHU: '飞书',
  FEISHU_RAW_SNAPSHOT: '飞书原始快照', FEISHU_CSV_SNAPSHOT: '飞书 CSV 快照', FETCH: '采集', NORMALIZE: '标准化', VALIDATE: '校验', PERSIST: '入库',
  INFO: '提示', WARN: '警告', CRITICAL: '重大', ACTIVE: '已生效',
}
function financeLabel(value) { return value === null || value === undefined || value === '' ? '—' : FINANCE_VALUE_LABELS[value] || String(value) }
const FINANCE_FIELD_LABELS = { scopeType: '数据范围', yearFrom: '起始年度', yearTo: '截止年度', openingBalance: '期初余额', safetyLine: '现金安全线', linkedCePackageId: '关联成本包', monthlyOutflows: '月度支出假设', tax: '税费假设', outputRate: '销项税率', inputRate: '进项税率', workingCapital: '营运资金假设', payableMonths: '应付账期（月）', inventoryDays: '存货周转（天）', labor: '人工假设', hoursPerUnit: '单台人工时', ratePerHour: '人工费率', overhead: '制造费用假设', kwhPerUnit: '单台电耗', pricePerKwh: '综合电价', otherPerUnit: '其他单台费用', materialCost: '材料费', laborCost: '人工费', processCost: '加工费', otherCost: '其他费用', year: '年度', month: '月份', note: '说明', title: '名称', rows: '明细', plannedAmount: '计划金额', actualAmount: '实际金额', costItemId: '费用项目', description: '业务说明', task: '活动', taskId: '活动记录', departmentId: '部门记录', orgId: '主体记录', reason: '原因', submittedAt: '提交时间', createdAt: '创建时间', submissionNo: '提交版本', submittedByName: '提交人', changes: '变更明细', payload: '审计证据', laborRate: '人工费率', overheadRate: '制造费率', committed: '已确认', failed: '失败', accepted: '已接收', rejected: '异常行', error: '错误', id: '记录', totalAmount: '金额（元）', totalDelta: '总成本差额（元）', amount: '金额（元）', count: '条数', field: '字段', before: '变更前', after: '变更后', nodeId: '物料节点', diff: '差额', total: '总计', run: '计算批次', status: '状态', created: '新建', skipped: '跳过', results: '逐条回执', outputs: '输出', sourceRef: '来源引用', totalCost: '总成本', qty: '数量', estimate: '估算' }
function financeFieldValue(values, key) { return key.split('.').reduce((value, part) => value?.[part], values) }
function financeSetField(values, key, value) {
  const next = { ...values }; const parts = key.split('.'); let target = next
  parts.slice(0, -1).forEach(part => { target[part] = { ...target[part] }; target = target[part] })
  target[parts.at(-1)] = value; return next
}
function financeFormBody(fields, values) {
  return fields.reduce((body, field) => {
    if (field.when && !field.when(values)) return body
    const value = financeFieldValue(values, field.key)
    if (value === '' || value === undefined || value === null) return body
    if (field.type === 'number' && !Number.isFinite(Number(value))) throw new Error(`${field.label}须为有效数字`)
    const converted = field.type === 'number' ? Number(value) : field.type === 'datetime-local' ? new Date(value).toISOString() : value
    return financeSetField(body, field.key, converted)
  }, {})
}
function FinanceFormDialog({ title, fields, initial = {}, onSubmit, onClose }) {
  const [values, setValues] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const lock = useRef(false)
  const submit = async event => {
    event.preventDefault()
    if (lock.current) return
    lock.current = true; setBusy(true); setError(null)
    try { await onSubmit(financeFormBody(fields, values)); onClose() }
    catch (failure) { setError(failure.message) }
    finally { lock.current = false; setBusy(false) }
  }
  return h(Dialog, { title, onClose: busy ? undefined : onClose },
    h('form', { onSubmit: submit, className: 'sf-stack' },
      ...fields.filter(field => !field.when || field.when(values)).map(field => h(FormRow, { key: field.key, label: field.label },
        field.options ? h(Select, { 'aria-label': field.label, value: financeFieldValue(values, field.key) ?? '', onChange: value => setValues(current => financeSetField(current, field.key, value)), options: field.options, placeholder: '请选择', required: field.required, disabled: busy })
          : h(field.type === 'textarea' ? Textarea : Field, { 'aria-label': field.label, value: financeFieldValue(values, field.key) ?? '', onChange: value => setValues(current => financeSetField(current, field.key, value)), type: field.type || 'text', required: field.required, min: field.min, max: field.max, maxLength: field.maxLength || 500, step: field.type === 'number' ? 'any' : undefined, disabled: busy }))),
      error ? h('p', { role: 'alert', className: 'sf-neg' }, error) : null,
      h('div', { className: 'sf-row' }, h(PrimaryButton, { type: 'submit', busy }, '确认'), h(GhostButton, { disabled: busy, onClick: onClose }, '取消'))))
}
function FinanceRowsDialog({ title, fields, initial = [{}], maxRows = 200, onSubmit, onClose }) {
  const [rows, setRows] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const lock = useRef(false)
  const submit = async event => {
    event.preventDefault()
    if (lock.current) return
    lock.current = true; setBusy(true); setError(null)
    try { await onSubmit(rows.map(row => financeFormBody(fields, row))); onClose() }
    catch (failure) { setError(failure.message) }
    finally { lock.current = false; setBusy(false) }
  }
  return h(Dialog, { title, width: 'lg', onClose: busy ? undefined : onClose }, h('form', { onSubmit: submit, className: 'sf-stack' },
    ...rows.map((row, index) => h('fieldset', { key: index, disabled: busy, className: 'sf-stack' }, h('legend', null, `第 ${index + 1} 行`),
      ...fields.map(field => h(FormRow, { key: field.key, label: field.label }, field.options
        ? h(Select, { 'aria-label': `${field.label} ${index + 1}`, value: row[field.key] ?? '', options: field.options, placeholder: '请选择', required: field.required, onChange: value => setRows(current => current.map((item, i) => i === index ? { ...item, [field.key]: value } : item)) })
        : h(Field, { 'aria-label': `${field.label} ${index + 1}`, value: row[field.key] ?? '', type: field.type || 'text', required: field.required, min: field.min, max: field.max, step: 'any', onChange: value => setRows(current => current.map((item, i) => i === index ? { ...item, [field.key]: value } : item)) }))),
      rows.length > 1 ? h(GhostButton, { onClick: () => setRows(current => current.filter((_, i) => i !== index)) }, '移除此行') : null)),
    h(GhostButton, { disabled: busy || rows.length >= maxRows, onClick: () => setRows(current => [...current, {}]) }, '添加一行'),
    error ? h('p', { role: 'alert', className: 'sf-neg' }, error) : null, h(PrimaryButton, { type: 'submit', busy }, '确认提交')))
}

function useFinanceCapabilities() {
  const [identity, setIdentity] = useState({ permissions: null, role: null, fullAccess: false })
  useEffect(() => {
    let cancelled = false
    let checking = false
    let timer
    const check = async () => {
      if (cancelled || checking) return
      checking = true; clearTimeout(timer)
      try {
        const results = await Promise.allSettled([financeRest('/finance/permissions/me'), financeRest('/finance/members/me')])
        if (cancelled) return
        setIdentity(current => {
          let next = current
          const permissions = results[0]
          const me = results[1]
          if (permissions.status === 'fulfilled' && Array.isArray(permissions.value.data?.permissions)) next = { ...next, permissions: permissions.value.data.permissions }
          else if (permissions.status === 'rejected' && [401, 403].includes(permissions.reason.status)) next = { ...next, permissions: [], role: null, fullAccess: false }
          if (me.status === 'fulfilled') next = { ...next, ...me.value.data }
          else if (me.status === 'rejected' && [401, 403].includes(me.reason.status)) next = { ...next, role: null, fullAccess: false }
          return next
        })
      } finally { checking = false; if (!cancelled) timer = setTimeout(check, 15000) }
    }
    const refresh = () => { void check() }
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    refresh()
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh); window.addEventListener('sf:permissions-refresh', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => { cancelled = true; clearTimeout(timer); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); window.removeEventListener('sf:permissions-refresh', refresh); document.removeEventListener('visibilitychange', onVisible) }
  }, [])
  return identity
}
const FINANCE_SECTION_PERMISSIONS = {
  budget: 'budget.execution.read', operations: 'budget.execution.read', cash: 'cash.plan.read', alerts: 'finance.source.review',
  datacenter: 'finance.source.review', sources: 'finance.source.review', facts: 'finance.source.review', analyze: 'finance.assistant.read', bom: 'cost.engineering.read',
  engine: 'budget.activity.read', comparisons: 'budget.compare.read', review: 'budget.submission.verify',
}
function financeSectionAllowed(section, identity) {
  const permission = FINANCE_SECTION_PERMISSIONS[section]
  if (section === 'facts') return Boolean(identity.permissions?.some(code => ['budget.execution.read', 'cash.plan.read', 'finance.source.review'].includes(code)))
  if (permission && !identity.permissions?.includes(permission)) return false
  if (section === 'review' && !identity.financeWriter) return false
  return true
}
