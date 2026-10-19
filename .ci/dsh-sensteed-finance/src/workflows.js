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
    if (FINANCE_ENUM_FIELDS.has(key) || ['currency', 'error', 'errorSummary'].includes(key)) return financeDisplayValue(value, key)
    if (/At$/.test(key)) return new Date(value).toLocaleString('zh-CN', { hour12: false })
    if (typeof value === 'object') return h(FinanceEvidence, { value })
    return typeof value === 'boolean' ? (value ? '是' : '否') : String(value)
  } }))
}
function FinanceEvidence({ value, field }) {
  if (value === null || value === undefined) return h('span', null, '—')
  if (typeof value !== 'object') return h('span', null, financeDisplayValue(value, field))
  return h('div', { className: 'sf-evidence' }, ...Object.entries(value).map(([key, item]) =>
    h('div', { key, className: 'sf-evidence-item' }, h('small', { title: key }, Array.isArray(value) ? `第 ${Number(key) + 1} 项` : financeFieldLabel(key)), h(FinanceEvidence, { value: item, field: Array.isArray(value) ? field : key }))))
}
const FINANCE_VALUE_LABELS = {
  GLOBAL: '全域', ORG: '指定主体', DEPARTMENT: '指定部门', SELF: '本人', HEADQUARTERS: '总部', HEZHONG: '合众',
  DRAFT: '草稿', CONFIRMED: '已确认', PUBLISHED: '已发布', LOCKED: '已锁定', OPEN: '开放中', CLOSED: '已关闭',
  PENDING: '待处理', SUBMITTED: '已提交', REJECTED: '已退回', VOIDED: '已作废', SUCCESS: '成功', FAILED: '失败', RUNNING: '处理中',
  APPROVED: '已批准', IN_REVIEW: '评审中', OBSOLETE: '已作废', PROPOSED: '待落账', APPLIED: '已落账', CANCELLED: '已撤销',
  ADDED: '新增', REMOVED: '移除', INCREASED: '调增', DECREASED: '调减', MOVED: '转移', SUBMIT_REVIEW: '提交评审', APPROVE: '批准', REJECT: '驳回',
  PURCHASE: '采购', REIMBURSEMENT: '报销', INCOME: '收入', PAYROLL: '薪酬', TAX: '税费', OTHER: '其他',
  PR_PAYMENT: 'PR 付款', NEW_RETAIL: '新零售', DIRECT_PARTS: '直采零部件', PROJECT_OPERATION: '项目运营成本', FIXED_OPERATION: '固定运营成本', MODEL_SPECIFIC: '车型专属成本', NON_PROJECT: '非项目类', AUTOMOTIVE_PARTS: '汽车零部件',
  BUDGET: '预算', PAYMENT_PLAN: '付款计划', REVENUE_PLAN: '收入计划', BUDGET_LINE: '预算明细', CASH_SUMMARY: '资金汇总',
  FINANCE_PLAN: '财务计划', OA: 'OA系统', NC: 'NC系统', ERP: 'ERP系统', TREASURY: '资金系统', DSS: 'DSS', FEISHU: '飞书',
  FEISHU_RAW_SNAPSHOT: '飞书原始快照', FEISHU_CSV_SNAPSHOT: '飞书 CSV 快照', FETCH: '采集', NORMALIZE: '标准化', VALIDATE: '校验', PERSIST: '入库',
  INFO: '提示', WARN: '警告', CRITICAL: '重大', ACTIVE: '已生效',
  POSTED: '已过账', IN_APPROVAL: '审批中', PARTIAL: '部分支付', PAID: '已支付', PENDING_REVIEW: '待核对',
  COMPLETED: '已完成', DONE: '已完成', EXPIRED: '已失效', SUPERSEDED: '已被替代', RETIRED: '已停用',
  ACKNOWLEDGED: '已确认', RESOLVED: '已解决', MUTED: '已静默', IGNORED: '已忽略',
  BUDGET_OVERRUN: '预算超支', EXECUTION_SLOW: '执行滞后', CASH_GAP: '资金缺口', DATA_QUALITY: '数据质量',
  INITIAL: '初始预算', ADJUSTED: '调整预算', ROLLING: '滚动预测', MERGED: '合并预算',
  NEW_BUDGET: '新增预算', TRANSFER_SAME_DEPT: '同部门调拨', TRANSFER_CROSS_DEPT: '跨部门调拨', REDUCE: '追减',
  FULL: '全额结转', PERCENT: '比例结转', EXPIRE: '过期清零', IN: '调入', OUT: '调出',
  HIGH: '高', MEDIUM: '中', LOW: '低', GROUP: '集团', COMPANY: '公司', BUSINESS_LINE: '业务线',
  DEPT_FILLER: '部门填报人', DEPT_LEADER: '部门负责人', DEPT_COLLABORATOR: '信息协同人', BOSS: '老板',
  FINANCE_STAFF: '财务专员', FINANCE_OWNER: '财务负责人', MANAGEMENT: '管理层',
  PAYMENT_REQUEST: '采购申请', ESTIMATED: '预计采购', IMPORTED: '导入口径', PUBLISHED_FACTS: '已发布事实口径',
  ACTION_REQUIRED: '待我处理', RELATED_TO_ME: '与我相关', SYSTEM: '系统通知',
  FILING: '填报', FACT_BATCH: '事实批次', BUDGET_ADJUSTMENT: '预算调整', PLAN_ADJUSTMENT: '计划调整',
  CREATE: '创建', UPDATE: '更新', SUBMIT: '提交', CONFIRM: '确认', PUBLISH: '发布', ACTIVATE: '生效',
  POST: '过账', CANCEL: '撤销', REOPEN: '重开', LOCK: '锁定', CLONE: '复制', VOID: '作废',
  BOTTOM_UP: '自下而上估算', TOP_DOWN: '目标成本反算', QUOTE: '报价估算',
  REVENUE: '收入', RECEIPT: '回款', CASH_BALANCE: '月末现金', FUNDING_GAP: '资金缺口', PAYMENT: '实际付款',
  INVENTORY_HOLDING: '存货占用', LABOR_COST: '人工成本', OVERHEAD_COST: '制造费用',
  DSS_NOT_CONFIGURED: 'DSS 未配置', DSS_NO_DATA: 'DSS 无数据', DSS_CALL_FAILED: 'DSS 调用失败',
  UNKNOWN: '待核查', RAW_STAGED: '原始数据已暂存，未发布', FETCHED_UNMAPPED: '已采集，待配置字段映射',
  NORMALIZED_STAGED: '标准记录已暂存，未发布', NO_DATA: '本次无数据',
  'formula-v1': '第 1 版公式', 'formula-v2': '第 2 版公式', 'formula-v3': '第 3 版公式',
}
function financeLabel(value, fallback) {
  if (value === null || value === undefined || value === '') return '—'
  const raw = String(value)
  const key = Object.hasOwn(FINANCE_VALUE_LABELS, raw) ? raw : raw.toUpperCase()
  return Object.hasOwn(FINANCE_VALUE_LABELS, key) ? FINANCE_VALUE_LABELS[key] : fallback ?? raw
}
const FINANCE_FIELD_LABELS = { scopeType: '数据范围', yearFrom: '起始年度', yearTo: '截止年度', openingBalance: '期初余额', safetyLine: '现金安全线', linkedCePackageId: '关联成本包', monthlyOutflows: '月度支出假设', tax: '税费假设', outputRate: '销项税率', inputRate: '进项税率', workingCapital: '营运资金假设', payableMonths: '应付账期（月）', inventoryDays: '存货周转（天）', labor: '人工假设', hoursPerUnit: '单台人工时', ratePerHour: '人工费率', overhead: '制造费用假设', kwhPerUnit: '单台电耗', pricePerKwh: '综合电价', otherPerUnit: '其他单台费用', materialCost: '材料费', laborCost: '人工费', processCost: '加工费', otherCost: '其他费用', year: '年度', month: '月份', note: '说明', title: '名称', rows: '明细', plannedAmount: '计划金额', actualAmount: '实际金额', costItemId: '费用项目', description: '业务说明', task: '活动', taskId: '活动记录', departmentId: '部门记录', orgId: '主体记录', reason: '原因', submittedAt: '提交时间', createdAt: '创建时间', submissionNo: '提交版本', submittedByName: '提交人', changes: '变更明细', payload: '审计证据', laborRate: '人工费率', overheadRate: '制造费率', committed: '已确认', failed: '失败', accepted: '已接收', rejected: '异常行', error: '错误', id: '记录', totalAmount: '金额（元）', totalDelta: '总成本差额（元）', amount: '金额（元）', count: '条数', field: '字段', before: '变更前', after: '变更后', nodeId: '物料节点', diff: '差额', total: '总计', run: '计算批次', status: '状态', created: '新建', skipped: '跳过', results: '逐条回执', outputs: '输出', sourceRef: '来源引用', totalCost: '总成本', qty: '数量', estimate: '估算' }
// Only contract fields are interpreted as enums; names, notes and identifiers stay verbatim.
const FINANCE_ENUM_FIELDS = new Set(['status', 'syncStatus', 'alertType', 'scope', 'scopeType', 'changeType', 'action', 'expenseType', 'planType', 'type', 'kind', 'category', 'bizSystem', 'docType', 'transport', 'transportUsed', 'dataset', 'stage', 'severity', 'formulaVersion', 'fallbackReason', 'priority', 'role', 'sourceType', 'source', 'mode', 'algo', 'side', 'caliber', 'fromStatus', 'toStatus'])
Object.assign(FINANCE_FIELD_LABELS, {
  ok: '结果', enabled: '启用', active: '生效', acceptsAcceptance: '接受承兑', isPrimary: '主版本', fullAccess: '全量数据访问',
  budgetAmount: '预算金额', executionRate: '执行率', execRate: '执行率', threshold: '阈值', ruleVersion: '规则版本',
  prSubmittedAmount: '已打采购申请金额', prEstimatedAmount: '预计采购金额', paidAmount: '实际付款金额',
  plannedIncome: '预计收入', plannedExpense: '预计支出', actualIncome: '实际收入', actualExpense: '实际支出',
  remainingAmount: '剩余金额', varianceAmount: '差额', oldAmount: '调整前金额', newAmount: '调整后金额',
  projectedBalance: '预计余额', actualBalance: '实际余额', prevEndBalance: '上月末余额',
  expenseType: '费用类别', planType: '付款类型', recordType: '采购申请类型', priority: '优先级', planMonth: '排款月份',
  plannedCashAmount: '现汇金额', plannedAcceptanceAmount: '承兑金额', scheduleDate: '排款日期', actualDate: '实际日期',
  type: '类型', kind: '类别', category: '分类', sourceType: '来源类型', source: '来源', scope: '范围',
  role: '角色', permission: '功能权限', permissions: '功能权限', scopes: '数据范围', action: '操作', mode: '结转方式',
  percent: '比例', expireMonth: '过期月份', side: '调拨方向', fromStatus: '原状态', toStatus: '新状态',
  bizSystem: '业务系统', docType: '单据类型', dataset: '数据集', transport: '传输通道', transportUsed: '实际通道',
  stage: '处理阶段', fallbackReason: '回退原因', errorSummary: '失败原因', stats: '数据摘要',
  fetched: '采集', inserted: '新增', updated: '更新', duplicated: '重复', totalRows: '总行数', successRows: '成功行数', failedRows: '失败行数',
  batchId: '批次', batchKey: '批次编号', batchNo: '报价批次', headerRows: '主表行数', detailRows: '明细行数',
  amountTotal: '汇总金额', currency: '币种', sourceFile: '来源文件', sourceDocNo: '来源单号', sourcePath: '来源路径',
  startedAt: '开始时间', finishedAt: '完成时间', updatedAt: '更新时间', confirmedAt: '确认时间', publishedAt: '发布时间',
  dueAt: '截止时间', readAt: '阅读时间', expiresAt: '到期时间', startsAt: '生效时间', revokedAt: '撤销时间',
  version: '版本', versionId: '预算版本', formulaVersion: '公式版本', frozenThroughMonth: '冻结截至月份',
  paramVersionId: '参数版本', params: '业务参数', runId: '计算批次', newVersionId: '新预算版本',
  lineCount: '明细行数', rowCount: '行数', budgetTotal: '预算总额', assignmentId: '填报记录', assignments: '指派明细',
  departmentName: '部门', orgName: '主体', costItemName: '费用科目', taskTitle: '活动名称', assigneeName: '填报人',
  userId: '用户记录', userName: '人员', displayName: '显示名称', systemUserId: '系统用户', memberId: '成员记录',
  submittedBy: '提交人记录', actorName: '操作者', operatorName: '操作人', operator: '操作人', grantReason: '授权原因',
  name: '名称', code: '编号', label: '名称', message: '说明', detail: '详情', notes: '备注',
  product: '产品', quantity: '数量', unitPrice: '单价', receiptRate: '回款率', changeType: '变化类型', delta: '差额', changeRate: '变化率',
  package: '成本包', packageId: '成本包记录', modelCode: '车型编码', targetPrice: '目标售价', targetCost: '目标成本', profitTarget: '目标利润',
  nodes: '物料明细', partNo: '零件号', parentPartNo: '父级零件号', parentId: '父级节点', level: '层级', unit: '单位',
  unitCost: '单位成本', extendedCost: '展开成本', nodeCount: '节点数', leafCount: '叶子节点数', algo: '估算方式',
  affectedCount: '影响节点数', estimateUnitCost: '估算单位成本', targetUnitCost: '目标单位成本', gap: '缺口',
  supplierName: '供应商', price: '报价', target: '目标系统', fileRef: '文件引用', success: '成功',
  rule: '规则', result: '结果', difference: '差异', meaning: '业务含义', normalizedAmount: '折算金额', taxBasis: '含税口径',
  primaryAmount: '主要金额', amounts: '金额明细', dimensions: '业务维度', checks: '核对结果', workflow: '审批流程',
  value: '值', reasonCode: '原因', errors: '错误明细', validationErrors: '校验错误', severity: '严重程度', alertType: '预警类型',
  details: '明细', summary: '汇总', data: '数据', meta: '附加信息',
})
function financeFieldLabel(key) {
  if (Object.hasOwn(FINANCE_FIELD_LABELS, key)) return FINANCE_FIELD_LABELS[key]
  return /[\u3400-\u9fff]/u.test(key) ? key : '其他字段'
}
function financeDisplayValue(value, field) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (field === 'error' || field === 'errorSummary') return financeErrorText(value)
  if (field === 'permission') return Object.hasOwn(FINANCE_PERMISSION_NAMES, value) ? FINANCE_PERMISSION_NAMES[value] : '未识别权限'
  if (field === 'field') return financeFieldLabel(String(value))
  if (field === 'syncStatus' && value === 'PARTIAL') return '部分成功'
  if (field === 'stage' && value === 'PARTIAL') return '存在待核对记录，未发布'
  if (field === 'currency') return ({ CNY: '人民币', RMB: '人民币', USD: '美元', EUR: '欧元', JPY: '日元', HKD: '港币', GBP: '英镑' })[value] || String(value)
  if (['bizSystem', 'docType', 'transport', 'transportUsed', 'dataset', 'source', 'formulaVersion'].includes(field)) return financeLabel(value)
  if (FINANCE_ENUM_FIELDS.has(field)) return financeLabel(value, /[\u3400-\u9fff]/u.test(String(value)) ? String(value) : '未识别类型')
  return typeof value === 'number' ? formatNumber(value) : String(value)
}
function financeEnumLabel(value, t, keys = {}) {
  if (Object.hasOwn(keys, value)) return t(keys[value])
  return financeLabel(value, t('unknown'))
}
function financeErrorText(value, status) {
  if (Array.isArray(value)) return [...new Set(value.map(item => financeErrorText(item, status)))].join('；')
  const raw = String(value || '').trim()
  const errors = {
    upstream_timeout: '财务服务响应超时，请稍后重试。', upstream_unreachable: '无法连接财务服务，请检查网络后重试。',
    empty_result: '财务服务未返回结果，请刷新后重试。', invalid_adjustment_response: '预算调整结果无效，请刷新后核对。',
    finance_tool_unavailable: '此项财务功能暂不可用，请联系管理员。',
    'body too large': '提交内容过大，请减少明细行数后重试。', 'invalid JSON body': '提交的数据格式无效，请检查后重试。',
    'body must be a JSON object': '提交的数据格式无效，请检查后重试。',
  }
  if (Object.hasOwn(errors, raw)) return errors[raw]
  if (/[\u3400-\u9fff]/u.test(raw)) return raw
  const validation = raw.match(/^(\w+) must (not be less than|not be greater than|be a number conforming to the specified constraints|be a string|be a UUID|not be empty)(.*)$/i)
  if (validation && Object.hasOwn(FINANCE_FIELD_LABELS, validation[1])) {
    const messages = { 'not be less than': '不得小于', 'not be greater than': '不得大于', 'be a number conforming to the specified constraints': '须为有效数字', 'be a string': '须为文本', 'be a uuid': '须为有效记录编号', 'not be empty': '不能为空' }
    const limit = validation[3].trim().match(/^-?\d+(?:\.\d+)?$/)?.[0] || ''
    return `${financeFieldLabel(validation[1])}${messages[validation[2].toLowerCase()]}${limit ? ` ${limit}` : ''}`
  }
  if (status === 401 || /unauthorized|session.expired/i.test(raw)) return '登录已过期，请重新使用飞书登录。'
  if (status === 403 || /forbidden/i.test(raw)) return '当前账号没有此项财务操作权限。'
  if (/timeout|timed out|aborted/i.test(raw)) return '财务服务响应超时，请稍后重试。'
  if (status === 400) return '填报数据校验失败，请检查必填项、金额与期间。'
  if (status === 404) return '未找到对应的财务记录，请刷新后核对年度、主体和科目。'
  return '财务服务暂不可用，请检查网络或稍后重试。'
}

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
// 统一字段校验：自定义选择器与原生输入使用相同的提交、错误定位规则。
function financeFormErrors(fields, values) {
  const errors = {}
  for (const field of fields) {
    if (field.when && !field.when(values)) continue
    const value = financeFieldValue(values, field.key)
    const empty = value == null || (Array.isArray(value) ? !value.length : !String(value).trim())
    if (empty) { if (field.required) errors[field.key] = `请${field.options || field.multi ? '选择' : '填写'}${field.label}`; continue }
    if (field.options && (field.multi ? value.some(item => !field.options.some(([id]) => id === item)) : !field.options.some(([id]) => id === value))) errors[field.key] = `请重新选择${field.label}`
    else if (field.type === 'number') {
      const number = Number(value)
      if (!Number.isFinite(number)) errors[field.key] = `${field.label}须为有效数字`
      else if (field.min != null && number < field.min) errors[field.key] = `${field.label}不能小于 ${field.min}`
      else if (field.max != null && number > field.max) errors[field.key] = `${field.label}不能大于 ${field.max}`
    } else if (['date', 'datetime-local'].includes(field.type) && !Number.isFinite(new Date(value).getTime())) errors[field.key] = `请填写有效的${field.label}`
    else if (String(value).length > (field.maxLength || 500)) errors[field.key] = `${field.label}不能超过 ${field.maxLength || 500} 字`
  }
  return errors
}
function financeFocusFormError(form) {
  requestAnimationFrame(() => form?.querySelector('[aria-invalid="true"]')?.focus())
}
function financeFormFields(fields, values, onChange, errors, busy, prefix, rowNumber) {
  return fields.filter(field => !field.when || field.when(values)).map(field => {
    const message = errors[field.key], errorId = `${prefix}-${field.key}-error`
    const props = { 'aria-label': `${field.label}${rowNumber ? ` ${rowNumber}` : ''}`, 'aria-invalid': message ? true : undefined, 'aria-describedby': message ? errorId : undefined, value: financeFieldValue(values, field.key) ?? '', onChange: value => onChange(field.key, value), required: field.required, disabled: busy || Boolean(field.disabled) }
    return h(FormRow, { key: field.key, label: `${field.label}${field.required ? '（必填）' : ''}` },
      h('div', { className: 'sf-field-control' },
        field.multi ? h(MultiSearchSelect, { ...props, value: props.value || [], options: field.options || [], placeholder: field.label })
          : field.options ? h(field.searchable ? SearchSelect : Select, { ...props, ...(field.searchable ? { buttonTrigger: true } : {}), options: field.options, placeholder: field.searchable ? field.label : '请选择' })
          : h(field.type === 'textarea' ? Textarea : Field, { ...props, type: field.type || 'text', min: field.min, max: field.max, maxLength: field.maxLength || 500, step: field.type === 'number' ? 'any' : undefined }),
        message ? h('span', { id: errorId, className: 'sf-neg sf-field-error' }, message) : null))
  })
}
let financeNavigationGlobal = null
function financeNavigationContext() {
  return financeNavigationContext.value ||= React.createContext(null)
}
function useFinanceNavigationEntry(dirty, busy, discard) {
  const navigation = React.useContext(financeNavigationContext()) || financeNavigationGlobal, latest = useRef(null)
  latest.current = { dirty, busy, discard }
  const read = key => typeof latest.current[key] === 'function' ? latest.current[key]() : latest.current[key]
  useEffect(() => navigation?.register({ dirty: () => read('dirty'), busy: () => read('busy'), discard: () => latest.current.discard?.() }), [navigation])
  useEffect(() => {
    const prevent = event => { if (read('dirty') || read('busy')) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [])
  return navigation
}
function useFinanceNavigationGuard() {
  const entries = useRef(new Set()), [pending, setPending] = useState(null), [blocked, setBlocked] = useState(false)
  const busy = () => [...entries.current].some(entry => entry.busy())
  const navigation = useMemo(() => ({
    register: entry => { entries.current.add(entry); return () => entries.current.delete(entry) },
    leave: action => {
      if (busy()) { setBlocked(true); return }
      setBlocked(false)
      if ([...entries.current].some(entry => entry.dirty())) setPending(() => action)
      else action()
    },
  }), [])
  const dismiss = () => { setPending(null); setBlocked(false) }
  const prompt = pending || blocked ? h(Dialog, { title: blocked ? '正在处理，请稍候' : '放弃未保存的录入？', width: 'sm', onClose: dismiss },
    h('p', null, blocked ? '当前请求尚未完成，暂时不能切换。处理结果返回后可继续操作。' : '当前内容尚未保存。继续将清空本次填写或导入预览；也可以返回继续填写。'),
    h('div', { className: 'sf-row' }, h(GhostButton, { onClick: dismiss }, blocked ? '返回当前页面' : '继续填写'),
      !blocked ? h(PrimaryButton, { onClick: () => {
        if (busy()) { setBlocked(true); return }
        const action = pending; setPending(null)
        for (const entry of entries.current) entry.discard()
        action?.()
      } }, '放弃并继续') : null)) : null
  return { navigation, prompt }
}
function useFinanceFormExit(initial, values, busy, onClose) {
  const baseline = useRef(JSON.stringify(initial)), [leaving, setLeaving] = useState(false)
  const promptRef = useRef(null), previousFocus = useRef(null), pendingAction = useRef(onClose)
  const [discardLabel, setDiscardLabel] = useState('放弃修改并关闭')
  const dirty = JSON.stringify(values) !== baseline.current
  useFinanceNavigationEntry(dirty, busy, () => { baseline.current = JSON.stringify(values) })
  const isBusy = () => typeof busy === 'function' ? busy() : busy
  useEffect(() => { if (leaving) requestAnimationFrame(() => promptRef.current?.querySelector('button')?.focus()) }, [leaving])
  const leave = (action, label = '放弃修改并继续') => { if (!isBusy()) { if (dirty) { pendingAction.current = action; setDiscardLabel(label); previousFocus.current = document.activeElement; setLeaving(true) } else action() } }
  const close = () => leave(onClose, '放弃修改并关闭')
  const prompt = leaving ? h('div', { ref: promptRef, className: 'sf-form-exit sf-stack', role: 'alert' },
    h('p', null, '有尚未保存的修改。离开后这些内容将丢失。'),
    h('div', { className: 'sf-row' }, h(GhostButton, { disabled: isBusy(), onClick: () => { setLeaving(false); requestAnimationFrame(() => previousFocus.current?.focus()) } }, '继续编辑'), h(GhostButton, { disabled: isBusy(), onClick: () => { if (!isBusy()) { setLeaving(false); pendingAction.current() } } }, discardLabel))) : null
  return { close, prompt, leave, reset: values => { baseline.current = JSON.stringify(values) } }
}
function FinanceFormDialog({ title, description, fields, initial = {}, onSubmit, onClose }) {
  const [values, setValues] = useState(initial), [busy, setBusy] = useState(false)
  const [error, setError] = useState(null), [errors, setErrors] = useState({})
  const lock = useRef(false), formRef = useRef(null), prefix = useId()
  const exit = useFinanceFormExit(initial, values, busy, onClose)
  const change = (key, value) => {
    const next = financeSetField(values, key, value); setValues(next)
    // 提交后继续输入时就地更新错误，也移除已隐藏条件字段的错误。
    if (Object.keys(errors).length) setErrors(financeFormErrors(fields, next))
    setError(null)
  }
  const submit = async event => {
    event.preventDefault()
    if (lock.current) return
    const invalid = financeFormErrors(fields, values); setErrors(invalid)
    if (Object.keys(invalid).length) { financeFocusFormError(formRef.current); return }
    lock.current = true; setBusy(true); setError(null)
    try { await onSubmit(financeFormBody(fields, values)); onClose() }
    catch (failure) { setError(failure.message) }
    finally { lock.current = false; setBusy(false) }
  }
  return h(Dialog, { title, onClose: exit.close, dismissDisabled: busy },
    h('form', { ref: formRef, noValidate: true, onSubmit: submit, className: 'sf-stack sf-workflow-form' },
      description ? h('p', { className: 'sf-note' }, description) : null,
      ...financeFormFields(fields, values, change, errors, busy, prefix),
      Object.keys(errors).length ? h('p', { role: 'alert', className: 'sf-neg' }, `请检查 ${Object.keys(errors).length} 项输入，已定位到首个错误。`) : null,
      error ? h('p', { role: 'alert', className: 'sf-neg' }, error) : null,
      exit.prompt,
      h('div', { className: 'sf-row' }, h(PrimaryButton, { type: 'submit', busy }, '确认'), h(GhostButton, { disabled: busy, onClick: exit.close }, '取消'))))
}
function FinanceRowsDialog({ title, fields, initial = [{}], maxRows = 200, onSubmit, onClose }) {
  const [rows, setRows] = useState(initial), [busy, setBusy] = useState(false)
  const [error, setError] = useState(null), [errors, setErrors] = useState([])
  const lock = useRef(false), formRef = useRef(null), prefix = useId()
  const exit = useFinanceFormExit(initial, rows, busy, onClose)
  const update = next => { setRows(next); if (errors.length) setErrors(next.map(row => financeFormErrors(fields, row))); setError(null) }
  const submit = async event => {
    event.preventDefault()
    if (lock.current) return
    const invalid = rows.map(row => financeFormErrors(fields, row)); setErrors(invalid)
    if (!rows.length || rows.length > maxRows) { setError(`请填写 1 至 ${maxRows} 行明细`); return }
    if (invalid.some(row => Object.keys(row).length)) { financeFocusFormError(formRef.current); return }
    lock.current = true; setBusy(true); setError(null)
    try { await onSubmit(rows.map(row => financeFormBody(fields, row))); onClose() }
    catch (failure) { setError(failure.message) }
    finally { lock.current = false; setBusy(false) }
  }
  const invalidRows = errors.flatMap((row, index) => Object.keys(row).length ? [index + 1] : [])
  return h(Dialog, { title, width: 'lg', onClose: exit.close, dismissDisabled: busy }, h('form', { ref: formRef, noValidate: true, onSubmit: submit, className: 'sf-stack sf-workflow-form' },
    h('p', { className: 'sf-note', 'aria-live': 'polite' }, `共 ${rows.length} 行，最多 ${maxRows} 行。确认提交前请核对各行内容。`),
    ...rows.map((row, index) => h('fieldset', { key: index, disabled: busy, className: 'sf-stack' }, h('legend', null, `第 ${index + 1} 行`),
      ...financeFormFields(fields, row, (key, value) => update(rows.map((item, i) => i === index ? financeSetField(item, key, value) : item)), errors[index] || {}, busy, `${prefix}-${index}`, index + 1),
      rows.length > 1 ? h(GhostButton, { onClick: () => update(rows.filter((_, i) => i !== index)) }, '移除此行') : null)),
    h(GhostButton, { disabled: busy || rows.length >= maxRows, onClick: () => update([...rows, {}]) }, '添加一行'),
    invalidRows.length ? h('p', { role: 'alert', className: 'sf-neg' }, `第 ${invalidRows.join('、')} 行存在输入错误，已定位到首个错误。`) : null,
    error ? h('p', { role: 'alert', className: 'sf-neg' }, error) : null, exit.prompt,
    h('div', { className: 'sf-row' }, h(PrimaryButton, { type: 'submit', busy }, '确认提交'), h(GhostButton, { disabled: busy, onClick: exit.close }, '取消'))))
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
  if (section === 'entry') return Boolean(identity.financeWriter && identity.permissions?.includes('budget.submission.edit'))
  if (section === 'costitems') return identity.role === 'FINANCE_OWNER'
  if (section === 'identity') return identity.role === 'FINANCE_OWNER'
  const permission = FINANCE_SECTION_PERMISSIONS[section]
  if (section === 'facts') return Boolean(identity.permissions?.some(code => ['budget.execution.read', 'cash.plan.read', 'finance.source.review'].includes(code)))
  if (permission && !identity.permissions?.includes(permission)) return false
  if (section === 'review' && !identity.financeWriter) return false
  return true
}
