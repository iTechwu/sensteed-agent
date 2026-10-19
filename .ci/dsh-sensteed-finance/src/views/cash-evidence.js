// 片段 5/7 视图：资金证据（逐笔付款/到账登记 + 计划准确率；契约以 Datasource cash-evidence.contract.ts 为唯一权威）

// 与网页一致：金额字符串 ≤19 位、最多两位小数；币种三位大写字母。
function financeEvidenceAmount(value) {
  const text = String(value ?? '').trim()
  return text.length > 0 && text.length <= 19 && /^\d+(\.\d{1,2})?$/.test(text) ? text : null
}

// 实付/到账按财务业务时区（北京时间）解释，与网页 `new Date(v + ':00+08:00')` 一致。
function financeBeijingInstant(localValue) {
  if (!localValue) return null
  const date = new Date(`${localValue}:00+08:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

// 客户端仅镜像服务端 Zod 规则（RegisterCashSettlementSchema）用于提交前提示；occurredAt 须已是 ISO 字符串，最终以服务端校验为准。
function financeSettlementBody(t, input) {
  const sourceSystem = String(input.sourceSystem ?? 'PROJECT_ENTRY').trim()
  if (!sourceSystem || sourceSystem.length > 100) return { error: '来源系统：1-100' }
  input = { ...input, cash: input.cash ?? input.cashAmount, acceptance: input.acceptance ?? input.acceptanceAmount, process: input.process ?? input.processNo }
  const sourceId = String(input.sourceId ?? '').trim()
  if (!sourceId || sourceId.length > 200) return { error: `${t('settlementSourceId')}：1-200` }
  if (!input.occurredAt) return { error: t('settlementOccurredAt') }
  const amount = financeEvidenceAmount(input.amount)
  if (!amount) return { error: `${t('amount')}：≥ 0，最多两位小数` }
  const currency = String(input.currency ?? '').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) return { error: t('accuracyBadCurrency') }
  const note = String(input.note ?? '').trim()
  if (!note || note.length > 1000) return { error: `${t('settlementNote')}：1-1000` }
  const sourceRef = String(input.sourceRef ?? '').trim()
  if (!sourceRef || sourceRef.length > 1000) return { error: `${t('settlementSourceRef')}：1-1000` }
  const cashAmount = String(input.cash ?? '').trim() ? financeEvidenceAmount(input.cash) : null
  const acceptanceAmount = String(input.acceptance ?? '').trim() ? financeEvidenceAmount(input.acceptance) : null
  if (String(input.cash ?? '').trim() && cashAmount === null) return { error: t('settlementCashUnknown') }
  if (String(input.acceptance ?? '').trim() && acceptanceAmount === null) return { error: t('settlementAcceptanceUnknown') }
  const processNo = String(input.process ?? '').trim() || null
  if (processNo && processNo.length > 200) return { error: t('settlementProcessNo') }
  return { body: {
    sourceSystem, sourceId, sourceRef, direction: input.direction, planId: input.planId,
    occurredAt: input.occurredAt, currency, amount, cashAmount, acceptanceAmount, processNo,
    reversesId: input.reversesId || null, note,
  } }
}

function CashSettlementsSection({ planId, direction, ctx, t }) {
  const canWrite = ctx.financeWriter && ctx.permissions.includes('cash.plan.write') && ctx.permissions.includes('cash.plan.verify')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [retry, setRetry] = useState(0)
  const [confirmed, setConfirmed] = useState(false)
  const [form, setForm] = useState({ sourceId: '', occurred: '', amount: '', cash: '', acceptance: '', process: '', currency: 'CNY', reference: '', note: '', reversesId: null })
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(null)
  const lock = useRef(false)
  const [pending, setPending] = useState(false)
  const exit = useFinanceFormExit(form, form, () => lock.current, () => {})
  const setField = (key, value) => setForm(current => ({ ...current, [key]: value }))
  useEffect(() => {
    let cancelled = false
    setData(null)
    api(`/rest/finance/cash-evidence/settlements?planId=${encodeURIComponent(planId)}&direction=${direction}&page=${page}&limit=20`)
      .then(value => { if (!cancelled) setData(value.data ?? value) })
      .catch(() => { if (!cancelled) setData({ error: true }) })
    return () => { cancelled = true }
  }, [planId, direction, page, retry])
  const resetEntry = () => { const clean = { sourceId: '', occurred: '', amount: '', cash: '', acceptance: '', process: '', currency: 'CNY', reference: '', note: '', reversesId: null }; setForm(clean); exit.reset(clean) }
  const submit = async () => {
    if (lock.current || !confirmed) return
    const occurredAt = financeBeijingInstant(form.occurred)
    const parsed = financeSettlementBody(t, { ...form, sourceRef: form.reference, occurredAt, direction, planId })
    if (parsed.error) { setError(parsed.error); return }
    lock.current = true; setPending(true); setError(null); setOk(null)
    try {
      await post('/rest/finance/cash-evidence/settlements', parsed.body)
      setOk(t('settlementRegisterOk')); resetEntry(); setConfirmed(false); setRetry(value => value + 1)
    } catch (err) { setError(err.message) } finally { lock.current = false; setPending(false) }
  }
  const importFile = async file => {
    if (!file || lock.current || !confirmed) return
    setError(null); setOk(null)
    if (file.size > 1024 * 1024) { setError(t('settlementTooLarge')); return }
    lock.current = true; setPending(true)
    try {
      const input = JSON.parse(await file.text())
      if (!input || typeof input.sourceSystem !== 'string' || input.planId !== planId || input.direction !== direction) { setError(t('settlementImportMismatch')); return }
      const occurred = input.occurredAt ? new Date(input.occurredAt) : null
      if (!occurred || Number.isNaN(occurred.getTime())) { setError(t('settlementOccurredAt')); return }
      const parsed = financeSettlementBody(t, { ...input, cash: input.cashAmount, acceptance: input.acceptanceAmount, process: input.processNo, occurredAt: occurred.toISOString() })
      if (parsed.error) { setError(parsed.error); return }
      await post('/rest/finance/cash-evidence/settlements', parsed.body)
      setOk(t('settlementImportOk')); setConfirmed(false); setRetry(value => value + 1)
    } catch (err) { setError(err instanceof SyntaxError ? t('settlementFileFail') : err.message) } finally { lock.current = false; setPending(false) }
  }
  const rows = data?.list || []
  return h('div', { className: 'sf-stack' },
    h('strong', null, direction === 'PAYMENT' ? t('settlementSectionPayment') : t('settlementSectionReceipt')),
    data?.error ? h('div', { role: 'alert', className: 'sf-row' }, t('settlementLoadFail'), h(LinkButton, { onClick: () => setRetry(value => value + 1) }, t('settlementRetry'))) : null,
    data && !data.error ? h('div', { className: 'sf-stack' },
      data.message ? h('p', { className: 'sf-note' }, data.message) : null,
      h('p', { className: 'sf-note' }, `${t('settlementSourceSummary')}：${data.sourceActualAmount ?? '—'}。${t('settlementSourceNote')}`),
      rows.length ? h(Table, { tableId: `finance-cash-evidence-${direction}`, rows, rowKey: 'id', empty: t('empty'), columns: [
        { key: 'sourceSystem', label: t('settlementSystem') },
        { key: 'sourceId', label: t('settlementNo') },
        { key: 'occurredAt', label: t('settlementOccurredAt'), render: row => new Date(row.occurredAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) },
        { key: 'amount', label: t('amount'), num: true, render: row => `${row.reversesId ? '−' : ''}${row.amount}` },
        { key: 'currency', label: t('paymentCurrency') },
        { key: 'cashAmount', label: t('cashAmount'), num: true, render: row => `${row.reversesId && row.cashAmount != null ? '−' : ''}${row.cashAmount ?? '—'}` },
        { key: 'acceptanceAmount', label: t('acceptanceAmount'), num: true, render: row => `${row.reversesId && row.acceptanceAmount != null ? '−' : ''}${row.acceptanceAmount ?? '—'}` },
        { key: 'reversesId', label: t('settlementReverseCol'), render: row => row.reversesId ?? '—' },
        { key: 'sourceRef', label: t('settlementRefCol') },
        { key: 'verifiedBy', label: t('settlementVerifier') },
        { key: 'actions', label: t('actions'), sortable: false, render: row => canWrite && !row.reversesId
          ? h(LinkButton, { disabled: pending, onClick: () => exit.leave(() => { resetEntry(); setField('reversesId', row.id); setField('process', row.processNo ?? ''); setField('currency', row.currency ?? 'CNY'); setConfirmed(false); setError(null); setOk(null) }, '放弃修改并切换冲销') }, t('settlementReverseAction'))
          : null },
      ] }) : h('p', { className: 'sf-note' }, t('settlementEmptyNote')),
      h(Pager, { page, total: data.total, limit: data.limit || 20, onPage: setPage })) : null,
    canWrite ? h('fieldset', { disabled: pending, className: 'sf-stack sf-fieldset' },
      h('label', { className: 'sf-row' },
        h('input', { type: 'checkbox', checked: confirmed, onChange: event => { setConfirmed(event.target.checked); setError(null); setOk(null) } }),
        t('settlementAttest')),
      h('div', { className: 'sf-stack' },
        error ? h('p', { role: 'alert', className: 'sf-neg' }, error) : null,
        ok ? h('p', { role: 'status' }, ok) : null,
        exit.prompt,
        form.reversesId ? h('p', { role: 'status', className: 'sf-row' }, `${t('settlementReverses')}：${form.reversesId}`,
          h(LinkButton, { onClick: () => exit.leave(() => { resetEntry(); setConfirmed(false) }, '放弃修改并取消冲销') }, t('settlementCancelReverse'))) : null,
        h('div', { className: 'sf-inline-form' },
          h(FormRow, { label: `${t('settlementSourceId')} *` }, h(Field, { value: form.sourceId, onChange: value => setField('sourceId', value), maxLength: 200, disabled: lock.current })),
          h(FormRow, { label: `${t('settlementOccurredAt')} *` }, h(Field, { type: 'datetime-local', value: form.occurred, onChange: value => setField('occurred', value), disabled: lock.current })),
          h(FormRow, { label: '本笔金额 *' }, h(Field, { value: form.amount, onChange: value => setField('amount', value), disabled: lock.current })),
          h(FormRow, { label: `${t('paymentCurrency')} *` }, h(Field, { value: form.currency, onChange: value => setField('currency', value.toUpperCase()), maxLength: 3, disabled: lock.current })),
          h(FormRow, { label: t('settlementCashUnknown') }, h(Field, { value: form.cash, onChange: value => setField('cash', value), disabled: lock.current })),
          h(FormRow, { label: t('settlementAcceptanceUnknown') }, h(Field, { value: form.acceptance, onChange: value => setField('acceptance', value), disabled: lock.current })),
          h(FormRow, { label: t('settlementProcessNo') }, h(Field, { value: form.process, onChange: value => setField('process', value), maxLength: 200, disabled: lock.current })),
          h(FormRow, { label: `${t('settlementSourceRef')} *` }, h(Field, { value: form.reference, onChange: value => setField('reference', value), maxLength: 1000, disabled: lock.current })),
          h(FormRow, { label: `${t('settlementNote')} *` }, h(Field, { value: form.note, onChange: value => setField('note', value), maxLength: 1000, disabled: lock.current }))),
        h('div', { className: 'sf-row' },
          h(PrimaryButton, { disabled: lock.current || !confirmed, onClick: submit }, form.reversesId ? t('settlementRegisterReverse') : direction === 'PAYMENT' ? t('settlementRegisterPayment') : t('settlementRegisterReceipt')),
          h('label', { className: 'sf-row' }, t('settlementImport'),
            h('input', { type: 'file', accept: '.json', 'aria-label': t('settlementImport'), disabled: lock.current || !confirmed, onChange: event => { const file = event.target.files?.[0]; event.target.value = ''; void importFile(file) } }))))) : null)
}

const CASH_ACCURACY_STATUS_KEYS = { READY: 'accReady', RULE_NOT_CONFIRMED: 'accRuleNotConfirmed', INSUFFICIENT_EVIDENCE: 'accInsufficient', NOT_APPLICABLE: 'accNotApplicable' }
const CASH_ACCURACY_CLASS_KEYS = { PAID: 'clsPaid', PROCESS_UNPAID: 'clsProcessUnpaid', NO_PROCESS_UNPAID: 'clsNoProcessUnpaid', PAYMENT_WITHOUT_PROCESS: 'clsPaidNoProcess', UNKNOWN: 'clsUnknown', EXCLUDED: 'clsExcluded' }

function CashAccuracyView({ ctx, t }) {
  const { year, orgId } = ctx
  const [month, setMonth] = useState(1)
  const [currency, setCurrency] = useState('CNY')
  if (!orgId) return h('p', { className: 'sf-note' }, t('accuracyNeedOrg'))
  const normalizedCurrency = currency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) return h('p', { role: 'alert', className: 'sf-neg' }, t('accuracyBadCurrency'))
  return h(CashAccuracyPeriod, { key: `${orgId}:${year}:${month}:${normalizedCurrency}`, ctx, t, orgId, year, month: Number(month), currency: normalizedCurrency })
}

function CashAccuracyPeriod({ ctx, t, orgId, year, month, currency }) {
  const canWrite = ctx.financeWriter && ctx.permissions.includes('cash.plan.write') && ctx.permissions.includes('cash.plan.verify')
  const scope = { orgId, year, month, currency }
  const [evidence, setEvidence] = useState(null)
  const [retry, setRetry] = useState(0)
  const [baselineId, setBaselineId] = useState('')
  const [executionId, setExecutionId] = useState('')
  const [ruleId, setRuleId] = useState('')
  const [page, setPage] = useState(1)
  const [assessment, setAssessment] = useState(null)
  const [assessing, setAssessing] = useState(false)
  const [assessError, setAssessError] = useState(null)
  const assess = async (targetPage = 1) => {
    if (!baselineId || !executionId || assessing) return
    setAssessing(true); setAssessError(null)
    try {
      const value = await api(`/rest/finance/cash-evidence/accuracy?baselineId=${encodeURIComponent(baselineId)}&executionId=${encodeURIComponent(executionId)}${ruleId ? `&ruleId=${encodeURIComponent(ruleId)}` : ''}&page=${targetPage}&limit=20`)
      setAssessment(value.data ?? value); setPage(targetPage)
    } catch (err) { setAssessError(err.message); setAssessment(null) } finally { setAssessing(false) }
  }
  useEffect(() => {
    let cancelled = false
    setEvidence(null)
    api(`/rest/finance/cash-evidence/snapshots?orgId=${encodeURIComponent(orgId)}&year=${year}&month=${month}&currency=${encodeURIComponent(currency)}&page=1&limit=50`)
      .then(value => { if (!cancelled) setEvidence(value.data ?? value) })
      .catch(() => { if (!cancelled) setEvidence({ error: true }) })
    return () => { cancelled = true }
  }, [orgId, year, month, currency, retry])
  useEffect(() => { setAssessment(null); setAssessError(null) }, [baselineId, executionId, ruleId])
  const items = evidence?.list || []
  const pick = kind => items.filter(item => item.kind === kind).map(item => [item.id, `${item.sourceRef} · ${item.asOf ?? item.recordedAt}`])
  const result = assessment
  return h('div', { className: 'sf-stack' },
    h(Card, { title: t('accuracyTitle'), unit: t('unitNote') },
      h('p', { className: 'sf-note' }, t('accuracyHint')),
      evidence?.error ? h('div', { role: 'alert', className: 'sf-row' }, t('accuracyLoadFail'), h(LinkButton, { onClick: () => setRetry(value => value + 1) }, t('accuracyRetryLoad'))) : null,
      evidence && !evidence.error ? h('div', { className: 'sf-stack' },
        !items.length ? h('p', { className: 'sf-note' }, t('accuracyNoEvidence')) : null,
        h('div', { className: 'sf-inline-form' },
          h(FormRow, { label: t('accuracyBaseline') }, h(Select, { 'aria-label': t('accuracyBaseline'), value: baselineId, onChange: setBaselineId, options: pick('BASELINE'), placeholder: t('accuracyPick') })),
          h(FormRow, { label: t('accuracyMonthEnd') }, h(Select, { 'aria-label': t('accuracyMonthEnd'), value: executionId, onChange: setExecutionId, options: pick('MONTH_END'), placeholder: t('accuracyPick') })),
          h(FormRow, { label: t('accuracyRule') }, h(Select, { 'aria-label': t('accuracyRule'), value: ruleId, onChange: setRuleId, options: pick('RULE'), placeholder: t('accuracyRuleEmpty') }))),
        baselineId && executionId ? h('div', { className: 'sf-stack' },
          h(PrimaryButton, { disabled: assessing, onClick: () => void assess(1) }, t('accuracyAssess')),
          assessing ? h('p', { role: 'status' }, t('running')) : null,
          assessError ? h('div', { role: 'alert', className: 'sf-row' }, `${t('accuracyAssessFail')} ${assessError}`, h(LinkButton, { onClick: () => void assess(page) }, t('accuracyRetryAssess'))) : null,
          result ? h('div', { className: 'sf-stack' },
            h('p', { role: 'status' }, `${t(CASH_ACCURACY_STATUS_KEYS[result.status] ?? result.status)} · ${t('accuracyCountRate')}：${result.countAccuracy == null ? '—' : `${(result.countAccuracy * 100).toFixed(2)}%`} · ${t('accuracyEligible')} ${result.eligible} / ${t('accuracyDenominator')} ${result.denominator}`),
            h('p', { className: 'sf-note' }, `${t('ruleVersion')} ${result.ruleVersion} · ${t('accuracyAddedAfter')} ${result.addedAfterCutoff.length}`),
            h('div', { className: 'sf-row' }, ...Object.entries(result.counts || {}).map(([key, value]) =>
              h('span', { key }, `${t(CASH_ACCURACY_CLASS_KEYS[key] ?? key)}：${value}`))),
            h(Table, { tableId: 'finance-cash-accuracy-rows', rows: result.rows?.list || [], rowKey: 'planId', empty: t('empty'), columns: [
              { key: 'planId', label: t('accuracyPlanCol') },
              { key: 'departmentId', label: t('accuracyDeptCol'), render: row => row.departmentId ?? '—' },
              { key: 'expenseType', label: t('accuracyExpenseCol'), render: row => row.expenseType ?? '—' },
              { key: 'plannedAmount', label: t('accuracyBaseAmount'), num: true, render: row => row.plannedAmount ?? '—' },
              { key: 'actualAmount', label: t('accuracyActualCol'), num: true, render: row => row.actualAmount ?? '—' },
              { key: 'amountVariance', label: t('accuracyVarianceCol'), num: true, render: row => row.amountVariance ?? '—' },
              { key: 'classification', label: t('accuracyClassCol'), render: row => t(CASH_ACCURACY_CLASS_KEYS[row.classification] ?? row.classification) },
              { key: 'reason', label: t('accuracyReasonCol') },
            ] }),
            h('p', { className: 'sf-note' }, `${t('accuracyAddedList')}：${result.addedAfterCutoff.join('、') || t('accuracyNone')}`),
            h(Pager, { page, total: result.rows?.total, limit: result.rows?.limit || 20, onPage: value => { void assess(value) } }),
            h('details', null, h('summary', null, t('accuracyEvidenceSummary')),
              h('p', { className: 'sf-note' }, `${t('accuracyBaselineEvidence')}：${result.baselineSha256}`),
              h('p', { className: 'sf-note' }, `${t('accuracyExecutionEvidence')}：${result.executionSha256}`),
              h('p', { className: 'sf-note' }, `${t('accuracyRuleEvidence')}：${result.ruleSha256}`))) : null) : null) : null),
    canWrite ? h(CashAccuracySourceForms, { t, scope, onChanged: () => setRetry(value => value + 1) }) : null)
}

function CashAccuracySourceForms({ t, scope, onChanged }) {
  const [note, setNote] = useState('')
  const [cutoff, setCutoff] = useState('')
  const [attested, setAttested] = useState(false)
  const [rule, setRule] = useState({ version: '', tolerance: '', cancelled: '', deferred: '', note: '', confirmed: false })
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(null)
  const lock = useRef(false)
  const setRuleField = (key, value) => setRule(current => ({ ...current, [key]: value }))
  const capture = async kind => {
    if (lock.current || !note.trim()) return
    lock.current = true; setError(null); setOk(null)
    try {
      await post('/rest/finance/cash-evidence/snapshots/capture', { ...scope, kind, note: note.trim(), ...(kind === 'MONTH_END' ? { cutoffAt: financeBeijingInstant(cutoff) } : {}) })
      setOk(kind === 'BASELINE' ? t('accuracyCaptureOk') : t('accuracyCaptureMonthEndOk')); onChanged()
    } catch (err) { setError(`${t('accuracyCaptureFail')}：${err.message}`) } finally { lock.current = false }
  }
  const importSnapshot = async file => {
    if (!file || lock.current || !attested) return
    setError(null); setOk(null)
    if (file.size > 1024 * 1024) { setError(t('accuracySnapshotTooLarge')); return }
    lock.current = true
    try {
      const parsed = JSON.parse(await file.text())
      const snapshot = parsed?.snapshot
      for (const key of ['orgId', 'year', 'month', 'currency']) if (!snapshot || snapshot[key] !== scope[key]) { setError(t('accuracySnapshotScopeBad')); return }
      await post('/rest/finance/cash-evidence/snapshots', parsed)
      setOk(t('accuracySnapshotOk')); setAttested(false); onChanged()
    } catch (err) { setError(err instanceof SyntaxError ? t('accuracySnapshotFail') : `${t('accuracySnapshotFail')}：${err.message}`) } finally { lock.current = false }
  }
  const confirmRule = async () => {
    if (lock.current || !rule.confirmed) return
    if (!rule.version.trim() || !financeEvidenceAmount(rule.tolerance) || !rule.cancelled || !rule.deferred || !rule.note.trim()) { setError(t('ruleConfirmFail')); return }
    lock.current = true; setError(null); setOk(null)
    try {
      await post('/rest/finance/cash-evidence/rules', { ...scope, version: rule.version.trim(), tolerance: rule.tolerance.trim(), excludeCancelled: rule.cancelled === 'exclude', excludeDeferred: rule.deferred === 'exclude', note: rule.note.trim() })
      setOk(t('ruleConfirmOk')); setRuleField('confirmed', false); onChanged()
    } catch (err) { setError(`${t('ruleConfirmFail')}：${err.message}`) } finally { lock.current = false }
  }
  return h('details', { className: 'sf-stack' },
    h('summary', null, t('accuracySourceTitle')),
    h('p', { className: 'sf-note' }, t('accuracySourceHint')),
    error ? h('p', { role: 'alert', className: 'sf-neg' }, error) : null,
    ok ? h('p', { role: 'status' }, ok) : null,
    h(FormRow, { label: t('accuracyCaptureNote') }, h(Field, { value: note, onChange: setNote, maxLength: 1000, disabled: lock.current })),
    h('div', { className: 'sf-row' },
      h(PrimaryButton, { disabled: lock.current || !note.trim(), onClick: () => void capture('BASELINE') }, t('accuracyCaptureBaseline')),
      h(PrimaryButton, { disabled: lock.current || !note.trim() || !cutoff, onClick: () => void capture('MONTH_END') }, t('accuracyCaptureMonthEnd'))),
    h(FormRow, { label: t('accuracyCutoff') }, h(Field, { type: 'datetime-local', value: cutoff, onChange: setCutoff, disabled: lock.current })),
    h('label', { className: 'sf-row' },
      h('input', { type: 'checkbox', checked: attested, onChange: event => setAttested(event.target.checked) }), t('accuracyAttest')),
    attested ? h('label', { className: 'sf-row' }, t('accuracySnapshotFile'),
      h('input', { type: 'file', accept: '.json', 'aria-label': t('accuracySnapshotFile'), disabled: lock.current || !attested, onChange: event => { void importSnapshot(event.target.files?.[0]) } })) : null,
    h('div', { className: 'sf-inline-form' },
      h(FormRow, { label: `${t('ruleVersion')} *` }, h(Field, { value: rule.version, onChange: value => setRuleField('version', value), maxLength: 100, disabled: lock.current })),
      h(FormRow, { label: `${t('ruleTolerance')} *` }, h(Field, { value: rule.tolerance, onChange: value => setRuleField('tolerance', value), disabled: lock.current })),
      h(FormRow, { label: `${t('ruleCancelled')} *` }, h(Select, { value: rule.cancelled, onChange: value => setRuleField('cancelled', value), options: [['exclude', t('ruleExclude')], ['include', t('ruleInclude')]], placeholder: t('rulePickAttribution') })),
      h(FormRow, { label: `${t('ruleDeferred')} *` }, h(Select, { value: rule.deferred, onChange: value => setRuleField('deferred', value), options: [['exclude', t('ruleExclude')], ['include', t('ruleInclude')]], placeholder: t('rulePickAttribution') })),
      h(FormRow, { label: `${t('ruleBasis')} *` }, h(Field, { value: rule.note, onChange: value => setRuleField('note', value), maxLength: 1000, disabled: lock.current }))),
    h('label', { className: 'sf-row' },
      h('input', { type: 'checkbox', checked: rule.confirmed, onChange: event => setRuleField('confirmed', event.target.checked) }), t('ruleConfirm')),
    h(PrimaryButton, { disabled: lock.current || !rule.confirmed, onClick: () => void confirmRule() }, t('ruleConfirmAction')))
}
