// 片段 5/7 视图：资金（资金汇总/排款工作台/收入计划/准确率；排款/调整/详情 Dialog）

// 实付日期按财务业务时区展示，避免中国本地零点保存为 UTC 后退一天。
function actualPaymentDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
}

const PRIORITIES = [['HIGH', 'priHigh'], ['MEDIUM', 'priMid'], ['LOW', 'priLow']]

function normalizePaymentPriority(value) {
  const aliases = { 高: 'HIGH', 中: 'MEDIUM', 低: 'LOW', priHigh: 'HIGH', priMid: 'MEDIUM', priLow: 'LOW' }
  return value ? (aliases[value] ?? value) : ''
}

function CashView({ ctx, t, onDrill }) {
  const { year, orgId, departments, revision } = ctx
  const canWrite = Boolean(ctx.financeWriter && ctx.permissions.includes('cash.plan.write'))
  const canVerify = Boolean(ctx.financeWriter && ctx.permissions.includes('cash.plan.verify'))
  const writeLock = useRef(false)
  const [tab, setTab] = useFinanceViewState(ctx, 'tab', () => ['summary', 'plans', 'revenue', 'accuracy'].includes(ctx.drillParams?.view) ? ctx.drillParams.view : 'summary')
  const [cash, setCash] = useState(null)
  const [plans, setPlans] = useState(null)
  const [revenues, setRevenues] = useState(null)
  const [filters, setFilters] = useFinanceViewState(ctx, 'filters', { planType: ctx.drillParams?.planType || '', departmentId: ctx.drillParams?.departmentId || '', months: ctx.drillParams?.months || financePlanMonths(null, ctx.drillParams?.month), expenseType: ctx.drillParams?.expenseType || '', keyword: ctx.drillParams?.keyword || '', unassigned: ctx.drillParams?.unassigned === true })
  const [page, setPage] = useFinanceViewState(ctx, 'page', ctx.drillParams?.page || 1)
  const [revenuePage, setRevenuePage] = useFinanceViewState(ctx, 'revenuePage', ctx.drillParams?.page || 1)
  const [keywordDraft, setKeywordDraft] = useFinanceViewState(ctx, 'keywordDraft', ctx.drillParams?.keyword || '')
  const [incomeTypeName, setIncomeTypeName] = useFinanceViewState(ctx, 'incomeTypeName', ctx.drillParams?.incomeTypeName || '')
  const [incomeTypeDraft, setIncomeTypeDraft] = useFinanceViewState(ctx, 'incomeTypeDraft', ctx.drillParams?.incomeTypeName || '')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [reloadTick, setReloadTick] = useState(0)

  const query = (extra = {}) => {
    const params = new URLSearchParams({ year })
    if (orgId && !filters.unassigned) params.set('orgId', orgId)
    if (filters.planType) params.set('planType', filters.planType)
    if (filters.departmentId) params.set('departmentId', filters.departmentId)
    if (filters.months.length) params.set('months', filters.months.join(','))
    if (filters.expenseType) params.set('expenseType', filters.expenseType)
    if (filters.keyword.trim()) params.set('keyword', filters.keyword.trim())
    if (filters.unassigned) params.set('unassigned', '1')
    for (const [key, value] of Object.entries(extra)) if (value !== undefined && value !== '') params.set(key, value)
    return params.toString()
  }

  const planPath = `/payment-plans?${query({ page, limit: PAGE_SIZE })}`
  const revenuePath = `/revenue-plans?${new URLSearchParams({ year, ...(orgId ? { orgId } : {}), ...(filters.months.length ? { months: filters.months.join(',') } : {}), ...(filters.keyword.trim() ? { keyword: filters.keyword.trim() } : {}), ...(incomeTypeName ? { incomeTypeName } : {}), page: String(revenuePage), limit: String(PAGE_SIZE) })}`
  const currentPlans = plans?.path === planPath ? plans : null
  const currentRevenues = revenues?.path === revenuePath ? revenues : null
  const retryList = () => setReloadTick(value => value + 1)

  const act = async (path, payload, doneMessage) => {
    if (writeLock.current) return false
    writeLock.current = true; setBusy(true); setNotice(null)
    try {
      await post(path, payload)
      setNotice(doneMessage ?? t('submitted'))
      setReloadTick(value => value + 1)
      return true
    } catch (error) { setNotice(`${t('opFailed')}: ${error.message}`); return false } finally { writeLock.current = false; setBusy(false) }
  }

  useEffect(() => { setNotice(null) }, [revision])
  useEffect(() => {
    let cancelled = false
    if (tab === 'summary') {
      api(`/cash?${new URLSearchParams({ year, ...(orgId ? { orgId } : {}) })}`).then(value => { if (!cancelled) setCash(value) }).catch(() => { if (!cancelled) setCash({ error: true }) })
    }
    if (tab === 'plans') {
      setPlans(null)
      api(planPath).then(value => { if (!cancelled) setPlans({ path: planPath, value }) }).catch(() => { if (!cancelled) setPlans({ path: planPath, error: true }) })
    }
    if (tab === 'revenue') {
      setRevenues(null)
      api(revenuePath).then(value => { if (!cancelled) setRevenues({ path: revenuePath, value }) }).catch(() => { if (!cancelled) setRevenues({ path: revenuePath, error: true }) })
    }
    return () => { cancelled = true }
  }, [tab, planPath, revenuePath, year, orgId, revision, reloadTick])

  const updateFilters = patch => { setPage(1); setRevenuePage(1); setFilters(current => ({ ...current, ...patch })) }
  const filterBar = ['plans', 'revenue'].includes(tab) ? h('div', { className: 'sf-filters' },
    tab === 'plans' ? [
      h(Select, { key: 'type', 'aria-label': t('planType'), value: filters.planType, onChange: value => updateFilters({ planType: value }), options: PLAN_TYPES.map(([id, label]) => [id, t(label)]), placeholder: t('planType') }),
      h(Select, { key: 'expense', 'aria-label': t('expenseType'), value: filters.expenseType, onChange: value => updateFilters({ expenseType: value }), options: EXPENSE_TYPES.map(([id, label]) => [id, t(label)]), placeholder: t('expenseType') }),
      h(SearchSelect, { key: 'department', value: filters.departmentId, onChange: value => updateFilters({ departmentId: value }), options: (departments || []).map(d => [d.id, d.name]), placeholder: t('department') }),
    ] : h('form', { className: 'sf-row', 'aria-label': '筛选收入类型', onSubmit: event => { event.preventDefault(); setIncomeTypeName(incomeTypeDraft.trim()); setRevenuePage(1) } },
      h(Field, { 'aria-label': '收入类型（精确匹配）', value: incomeTypeDraft, onChange: setIncomeTypeDraft, placeholder: '收入类型（精确匹配）', maxLength: 100 }),
      h(GhostButton, { type: 'submit' }, '筛选类型'),
      incomeTypeName ? h(GhostButton, { onClick: () => { setIncomeTypeDraft(''); setIncomeTypeName(''); setRevenuePage(1) } }, '清空类型') : null),
    h(MultiSearchSelect, { selectedLabel: filters.months.length ? `${filters.months.join('、')}月` : '全部月份', value: filters.months.map(String), onChange: values => updateFilters({ months: values.map(Number).sort((a, b) => a - b) }), options: Array.from({ length: 12 }, (_, index) => [String(index + 1), `${index + 1}月`]), placeholder: '计划月份（可多选）' }),
    h('form', { className: 'sf-row', onSubmit: event => { event.preventDefault(); updateFilters({ keyword: keywordDraft.trim() }) } },
      h(Field, { 'aria-label': tab === 'plans' ? '搜索付款描述、收款方、PR 编号、部门' : '搜索收入项目、付款方、类型', value: keywordDraft, onChange: setKeywordDraft, placeholder: tab === 'plans' ? '搜索付款描述、收款方、PR 编号、部门' : '搜索收入项目、付款方、类型', maxLength: 200 }),
      h(GhostButton, { type: 'submit' }, '搜索'),
      filters.keyword ? h(GhostButton, { onClick: () => { setKeywordDraft(''); updateFilters({ keyword: '' }) } }, '清空') : null),
    tab === 'plans' ? h('label', { className: 'sf-row', style: { gap: 6, fontSize: 12, color: 'var(--sf-ink2)' } },
      h('input', { type: 'checkbox', checked: filters.unassigned, onChange: event => updateFilters({ unassigned: event.target.checked }) }), t('unassigned')) : null) : null

  const planRows = currentPlans?.value?.data?.list || currentPlans?.value?.list || []
  return h('div', { className: 'sf-view' },
    h('div', { className: 'sf-row-between' },
      h(PillTabs, { tabs: [['summary', 'cashSummaryV'], ['plans', 'cashPlans'], ['revenue', 'cashRevenue'], ['accuracy', 'cashAccuracyTab']], value: tab, onChange: id => { setTab(id); setPage(1); setRevenuePage(1); setKeywordDraft(filters.keyword) }, t }),
      notice ? h(Notice, null, notice) : null),
    filterBar ? h('div', { className: 'sf-row-between' }, filterBar) : null,

    tab === 'summary' ? h(SummaryTab, { cash, t, year, onDrill }) : null,
    tab === 'plans' ? !currentPlans ? h('p', { role: 'status' }, t('loading')) : currentPlans.error ? h(CashPlanListError, { onRetry: retryList }) : h(PlansTab, { rows: planRows, total: currentPlans.value?.data?.total ?? currentPlans.value?.total, page, onPage: setPage, t, busy, act, canWrite, onDialog: setDialog }) : null,
    tab === 'revenue' ? !currentRevenues ? h('p', { role: 'status' }, t('loading')) : currentRevenues.error ? h(CashPlanListError, { onRetry: retryList }) : h(RevenueTab, { revenues: currentRevenues.value, page: revenuePage, onPage: setRevenuePage, t, canWrite, onBackfill: row => setDialog({ kind: 'backfill', row }), onLedger: row => setDialog({ kind: 'receiptLedger', row }) }) : null,
    tab === 'accuracy' ? h(CashAccuracyView, { ctx, t }) : null,

    dialog?.kind === 'closeRemaining' && canWrite ? h(CloseRemainingDialog, { plan: dialog.plan, t, busy, onClose: () => setDialog(null), act }) : null,
    dialog?.kind === 'schedule' ? h(ScheduleDialog, { plan: dialog.plan, t, onClose: () => setDialog(null), act }) : null,
    dialog?.kind === 'increase' ? h(IncreaseDialog, { plan: dialog.plan, t, onClose: () => setDialog(null), act }) : null,
    dialog?.kind === 'planDetail' ? h(PlanDetailDialog, { plan: dialog.plan, ctx, t, onClose: () => setDialog(null) }) : null,
    dialog?.kind === 'receiptLedger' ? h(Dialog, { title: `${t('settlementSectionReceipt')} · ${dialog.row.itemName ?? ''}`, onClose: () => setDialog(null) }, h(CashSettlementsSection, { planId: dialog.row.id, direction: 'RECEIPT', ctx, t })) : null,
    dialog?.kind === 'backfill' ? h(BackfillDialog, { row: dialog.row, t, onClose: () => setDialog(null), act }) : null,
  )
}

function CashPlanListError({ onRetry }) {
  return h('div', { role: 'alert', className: 'sf-stack' }, '计划加载失败，请重试。', h(LinkButton, { onClick: onRetry }, '重试加载'))
}

// ---- 汇总：当月执行 + 主体/月明细；空值保留未知，余额不跨月相加 ----

function cashSummaryModel(rows, selectedYear, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric' }).formatToParts(now)
  const year = Number(parts.find(part => part.type === 'year').value)
  const month = Number(parts.find(part => part.type === 'month').value)
  const isCurrentYear = Number(selectedYear) === year
  const current = isCurrentYear ? rows.filter(row => row.year === year && row.month === month) : []
  const totals = Object.fromEntries(['actualBalance', 'plannedIncome', 'plannedExpense', 'actualIncome', 'actualExpense', 'remainingPayment'].map(key => {
    const values = current.map(row => finite(row[key]))
    return [key, values.length && values.every(value => value !== null) ? values.reduce((sum, value) => sum + value, 0) : null]
  }))
  return { year, month, isCurrentYear, rows: current, totals }
}

function SummaryTab({ cash, t, year, now, onDrill }) {
  if (cash?.error) return h(EmptyState, null, t('loadError'))
  const rows = cash?.data?.list || cash?.list || []
  const model = cashSummaryModel(rows, year, now)
  const caliber = cash?.data?.caliber || cash?.caliber
  return h('div', { className: 'sf-stack' },
    h('p', { className: 'sf-note' }, caliber === 'PUBLISHED_FACTS' ? '按已生效财务代录及已审核发布的付款/收入计划汇总，仅含年度、月份齐全的行；未知金额保留为空，余额及来源剩余金额暂不可用。' : caliber === 'IMPORTED' ? '每行是主体×月份导入快照，未经拆分；余额不跨月累加。' : '来源口径暂未返回，请核对服务版本与导入发布状态；未知金额不按零处理。'),
    !rows.length ? h('p', { role: 'status' }, '当前年度与主体暂无资金汇总记录，可切换范围或到数据中心核查导入与发布状态。') : null,
    model.isCurrentYear ? h(Card, { title: `${model.year}-${String(model.month).padStart(2, '0')} · ${t('cashMonthlyExecution')}`, unit: t('unitNote') },
      h('div', { className: 'sf-kpis' },
        ...[['actualBalance', 'cashBalance'], ['plannedIncome', 'plannedIncome'], ['plannedExpense', 'plannedExpense'], ['actualIncome', 'actualIncome'], ['actualExpense', 'actualExpense'], ['remainingPayment', 'remainingUnpaid']].map(([key, label]) =>
          h(KpiCard, { key, icon: 'data', label: t(label), value: yuan(model.totals[key]) ?? '—', negative: model.totals[key] !== null && model.totals[key] < 0, onClick: onDrill && key !== 'actualBalance' ? () => onDrill('cash', { view: /Income$/.test(key) ? 'revenue' : 'plans', year: String(model.year), month: String(model.month) }) : undefined }))),
      h('p', { className: 'sf-note' }, t('cashMissingMetrics'))) : null,
    h(Card, { title: t('cashSummaryTable'), unit: t('unitNote') }, h(CashSummaryTable, { rows, t })))
}

function CashSummaryTable({ rows, t }) {
  return h(Table, { tableId: 'finance-CashSummaryTable-1',
    columns: [
      { label: t('org'), key: 'orgName', stickyLeft: true },
      { label: t('year'), key: 'year', num: true },
      { label: t('monthCol'), key: 'month', num: true },
      ...[['prevMonthEndBalance', 'prevEndBalance'], ['plannedIncome', 'plannedIncome'], ['plannedExpense', 'plannedExpense'], ['projectedBalance', 'projectedBalance'], ['actualIncome', 'actualIncome'], ['actualExpense', 'actualExpense'], ['actualBalance', 'actualBalance'], ['remainingPayment', 'remainingUnpaid']].map(([key, label]) => ({
        label: t(label), key, sortValue: row => finite(row[key]), num: true, render: row => wan(row[key]) ?? '—',
      })),
    ], rows, rowKey: 'id', empty: t('empty'),
  })
}

// ---- 排款工作台 ----

function PlansTab({ rows, total, page, onPage, t, busy, act, canWrite = true, onDialog }) {
  return h(Card, { title: t('cashPlans'), unit: t('unitNote') },
    h(Table, { tableId: 'finance-PlansTab-1',
      columns: [
        { label: t('org'), key: 'orgName', stickyLeft: true },
        { label: t('planType'), key: 'planType', render: row => financeEnumLabel(row.planType, t, PLAN_LABELS) },
        { label: t('description'), key: 'description' },
        { label: t('planMonth'), key: 'planMonth', sortValue: row => row.planMonth ?? row.month, render: row => mm(row.planMonth ?? row.month), num: true },
        { label: t('planned'), key: 'plannedAmount', render: row => wan(row.plannedAmount) ?? '—', num: true },
        { label: t('actual'), key: 'actualAmount', render: row => { const over = finite(row.actualAmount) !== null && finite(row.plannedAmount) !== null && row.actualAmount > row.plannedAmount; return h('span', { className: over ? 'sf-neg' : '' }, wan(row.actualAmount) ?? '—') }, num: true },
        { label: t('remaining'), key: 'remainingAmount', render: row => wan(row.remainingAmount) ?? '—', num: true },
        { label: t('actualPaidDate'), key: 'actualPaidAt', render: row => actualPaymentDate(row.actualPaidAt) ?? '—', num: true },
        { label: t('statusCol'), key: 'status', render: row => financeDisplayValue(row.status, 'status') },
        { label: t('scheduleDate'), key: 'scheduleDate', render: row => actualPaymentDate(row.scheduleDate) ?? '—', num: true },
        { label: t('priority'), key: 'priority', render: row => { const priority = normalizePaymentPriority(row.priority); return priority ? h(Pill, { tone: priority === 'HIGH' ? 'rose' : priority === 'MEDIUM' ? 'amber' : 'muted' }, financeEnumLabel(priority, t, Object.fromEntries(PRIORITIES))) : '—' } },
        {
          label: t('actions'), key: 'actions', sortable: false,
          render: row => h('div', { className: 'sf-row', style: { flexWrap: 'nowrap', justifyContent: 'flex-end' } },
            h(LinkButton, { onClick: () => onDialog({ kind: 'planDetail', plan: row }) }, t('actDetail')),
            canWrite && finite(row.remainingAmount) > 0 && row.status !== '剩余不再执行' ? h(LinkButton, { disabled: busy, onClick: () => onDialog({ kind: 'closeRemaining', plan: row }) }, t('closeRemaining')) : null,
            canWrite ? h(LinkButton, { disabled: busy, onClick: () => onDialog({ kind: 'schedule', plan: row }) }, t('schedule')) : null,
            canWrite ? h(LinkButton, { disabled: busy, onClick: () => onDialog({ kind: 'increase', plan: row }) }, t('increase')) : null),
        },
      ],
      rows, empty: t('empty'),
    }),
    h(Pager, { page, total, limit: PAGE_SIZE, onPage }))
}

function CloseRemainingDialog({ plan, t, onClose, act, busy }) {
  const [reason, setReason] = useState('')
  const invalid = busy || !reason.trim()
  const submit = async () => {
    if (invalid) return
    const saved = await act(`/rest/finance/payment-plans/${plan.id}/close-remaining`, { reason: reason.trim() })
    if (saved !== false) onClose()
  }
  return h(Dialog, { title: t('closeRemaining'), onClose: busy ? () => {} : onClose, footer: [
    h(GhostButton, { key: 'cancel', disabled: busy, onClick: onClose }, t('cancel')),
    h(PrimaryButton, { key: 'ok', disabled: invalid, onClick: submit }, t('closeRemainingConfirm')),
  ] }, h('div', { className: 'sf-stack' },
    h('p', { className: 'sf-note' }, `${plan.description ?? ''} · ${t('remaining')}：${wan(plan.remainingAmount) ?? '—'}`),
    h('p', { className: 'sf-note' }, t('closeRemainingHint')),
    h(FormRow, { label: t('closeRemainingReason') }, h(Textarea, { value: reason, onChange: setReason, maxLength: 500, disabled: busy }))))
}

function ScheduleDialog({ plan, t, onClose, act }) {
  const [scheduleDate, setScheduleDate] = useState(actualPaymentDate(plan.scheduleDate) ?? '')
  const [priority, setPriority] = useState(normalizePaymentPriority(plan.priority))
  const [accepts, setAccepts] = useState(plan.acceptsAcceptance == null ? '' : plan.acceptsAcceptance ? 'yes' : 'no')
  const [cashAmount, setCashAmount] = useState(plan.plannedCashAmount != null ? String(plan.plannedCashAmount) : '')
  const [acceptanceAmount, setAcceptanceAmount] = useState(plan.plannedAcceptanceAmount != null ? String(plan.plannedAcceptanceAmount) : '')
  const [planMonth, setPlanMonth] = useState('')
  const [splitTouched, setSplitTouched] = useState(false)
  const [formError, setFormError] = useState(null)
  const [pending, setPending] = useState(false)
  const lock = useRef(false)
  const close = () => { if (!lock.current) onClose() }
  const totalCents = finite(plan.plannedAmount) !== null ? Math.round(Number(plan.plannedAmount) * 100) : null
  const ratio = value => totalCents !== null && totalCents > 0 && value != null ? ((Number(value) * 100 / totalCents) * 100).toFixed(2) : ''
  const [cashPercent, setCashPercent] = useState(() => ratio(plan.plannedCashAmount))
  const [acceptancePercent, setAcceptancePercent] = useState(() => ratio(plan.plannedAcceptanceAmount))
  const [ratioError, setRatioError] = useState(false)
  const validDecimal = value => /^\d+(\.\d{1,2})?$/.test(value.trim())
  // 与网页一致：改一边自动补另一边（分单位计算），保留正在输入字段的原文。
  const updateSplit = (field, value) => {
    setSplitTouched(true); setFormError(null); setRatioError(false)
    if (field === 'cash') setCashAmount(value)
    else setAcceptanceAmount(value)
    const cents = Math.round(Number(value) * 100)
    if (!validDecimal(value) || totalCents === null || cents > totalCents) return
    const cash = field === 'cash' ? cents : totalCents - cents
    const acceptance = totalCents - cash
    if (field === 'cash') setAcceptanceAmount((acceptance / 100).toFixed(2))
    else setCashAmount((cash / 100).toFixed(2))
    setCashPercent(ratio(cash / 100)); setAcceptancePercent(ratio(acceptance / 100))
  }
  const updatePercent = (field, value) => {
    setSplitTouched(true); setFormError(null)
    if (field === 'cash') setCashPercent(value)
    else setAcceptancePercent(value)
    const percent = Number(value), invalid = !validDecimal(value) || percent < 0 || percent > 100
    setRatioError(invalid)
    if (invalid || totalCents === null || totalCents <= 0) return
    updateSplit(field, (Math.round(totalCents * percent / 100) / 100).toFixed(2))
    if (field === 'cash') setCashPercent(value)
    else setAcceptancePercent(value)
  }
  const submit = async () => {
    if (lock.current) return
    const cash = cashAmount.trim() ? Number(cashAmount) : undefined
    const acceptance = acceptanceAmount.trim() ? Number(acceptanceAmount) : undefined
    if (cash !== undefined && (!Number.isFinite(cash) || cash < 0)) { setFormError(t('scheduleCashBad')); return }
    if (acceptance !== undefined && (!Number.isFinite(acceptance) || acceptance < 0)) { setFormError(t('scheduleAcceptanceBad')); return }
    if (ratioError) { setFormError('比例需填写 0 到 100 之间、最多两位小数的数字。'); return }
    if (plan.planMonth == null && !planMonth) { setFormError(t('scheduleMonthMissing')); return }
    if (splitTouched) {
      if (totalCents == null) { setFormError(t('scheduleNoPlanAmount')); return }
      if (!/^\d+(\.\d{1,2})?$/.test(cashAmount.trim()) || !/^\d+(\.\d{1,2})?$/.test(acceptanceAmount.trim())) { setFormError(t('scheduleSplitBad')); return }
      if (Math.round(Number(cashAmount) * 100) + Math.round(Number(acceptanceAmount) * 100) !== totalCents) { setFormError(t('scheduleSumBad')); return }
      if (accepts === 'no' && Number(acceptanceAmount) > 0) { setFormError(t('scheduleNoAcceptance')); return }
    }
    setFormError(null)
    lock.current = true; setPending(true)
    try {
      const saved = await act(`/payment-plans/${plan.id}/schedule`, {
        ...(scheduleDate ? { scheduleDate: new Date(`${scheduleDate}T00:00:00+08:00`).toISOString() } : {}),
        ...(priority ? { priority } : {}),
        ...(accepts ? { acceptsAcceptance: accepts === 'yes' } : {}),
        ...(plan.planMonth == null && planMonth ? { planMonth: Number(planMonth) } : {}),
        ...(splitTouched ? { plannedCashAmount: cash, plannedAcceptanceAmount: acceptance } : {}),
      })
      if (saved !== false) onClose()
      else setFormError('排款更新失败，请刷新核对计划金额与权限后重试；本次输入已保留。')
    } catch {
      setFormError('排款更新失败，请刷新核对计划金额与权限后重试；本次输入已保留。')
    } finally { lock.current = false; setPending(false) }
  }
  const priorityOptions = PRIORITIES.map(([id, label]) => [id, t(label)])
  if (priority && !priorityOptions.some(([id]) => id === priority)) priorityOptions.push([priority, priority])
  return h(Dialog, { title: t('schedule'), onClose: close, footer: [
    h(GhostButton, { key: 'cancel', disabled: pending, onClick: close }, t('cancel')),
    h(PrimaryButton, { key: 'ok', disabled: pending, onClick: submit }, '保存排款'),
  ] },
    h('fieldset', { className: 'sf-stack sf-fieldset', disabled: pending, 'aria-busy': pending },
      h('p', { className: 'sf-note' }, `${plan.description ?? '—'} · 计划 ${yuan(plan.plannedAmount) ?? '—'} · ${plan.planMonth ? plan.planMonth + '月' : '待排'}`),
      formError ? h('p', { role: 'alert', className: 'sf-neg' }, formError) : null,
      plan.planMonth == null ? h(FormRow, { label: `${t('scheduleMonthBackfill')} *` }, h(Select, { value: planMonth, onChange: setPlanMonth, options: Array.from({ length: 12 }, (_, index) => [String(index + 1), `${index + 1} ${t('monthCol')}`]), placeholder: t('monthCol') })) : null,
      h(FormRow, { label: t('scheduleDate') }, h(Field, { type: 'date', value: scheduleDate, onChange: setScheduleDate })),
      h(FormRow, { label: '排款优先级' }, h(Select, { value: priority, onChange: setPriority, options: priorityOptions, placeholder: '未设置' })),
      h(FormRow, { label: '是否接受承兑' }, h(Select, { value: accepts, onChange: value => { setAccepts(value); if (value === 'no' && totalCents !== null) updateSplit('acceptance', '0') }, options: [['yes', '接受'], ['no', '不接受']], placeholder: '未设置' })),
      h(FormRow, { label: t('cashAmount') }, h(Field, { inputMode: 'decimal', value: cashAmount, onChange: value => updateSplit('cash', value) })),
      h(FormRow, { label: t('acceptanceAmount') }, h(Field, { inputMode: 'decimal', value: acceptanceAmount, onChange: value => updateSplit('acceptance', value) })),
      h(FormRow, { label: '现汇比例（%）' }, h(Field, { inputMode: 'decimal', disabled: totalCents === null || totalCents <= 0, value: cashPercent, onChange: value => updatePercent('cash', value) })),
      h(FormRow, { label: '承兑比例（%）' }, h(Field, { inputMode: 'decimal', disabled: totalCents === null || totalCents <= 0, value: acceptancePercent, onChange: value => updatePercent('acceptance', value) })),
      h('p', { className: 'sf-note' }, '编辑比例或金额将同步另一通道，金额按分舍入；两通道合计须等于计划金额。未提供的来源拆分保留为空。')))
}

function validPlanAdjustment(plan, value, reason) {
  const before = finite(plan.plannedAmount), after = finite(value), actual = finite(plan.actualAmount)
  return before !== null && after !== null && after >= 0 && after !== before
    && /^\d+(\.\d{1,2})?$/.test(String(value).trim()) && Boolean(reason.trim())
    && (after > before || actual !== null && after >= actual)
}

function IncreaseDialog({ plan, t, onClose, act }) {
  const [newAmount, setNewAmount] = useState('')
  const [reason, setReason] = useState('')
  const [draftId, setDraftId] = useState(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)
  const lock = useRef(false), draftRef = useRef(null)
  const invalid = !validPlanAdjustment(plan, newAmount, reason)
  const close = () => { if (!lock.current) onClose() }
  const submit = async () => {
    if (invalid || lock.current) return
    lock.current = true; setPending(true); setError(null)
    try {
      if (!draftRef.current) {
        const result = await post(`/rest/finance/payment-plans/${plan.id}/adjustments`, { newAmount: Number(newAmount), reason: reason.trim() })
        const id = result.data?.id || result.data?.adjustment?.id
        if (!id) throw new Error(t('opFailed'))
        draftRef.current = id; setDraftId(id)
      }
      const saved = await act(`/rest/finance/payment-plan-adjustments/${draftRef.current}/submit`, {})
      if (saved !== false) onClose()
    } catch (err) { setError(err.message) } finally { lock.current = false; setPending(false) }
  }
  return h(Dialog, { title: `${t('increase')} · ${plan.description ?? ''}`, onClose: close, footer: [
    h(GhostButton, { key: 'cancel', disabled: pending, onClick: close }, t('cancel')),
    h(PrimaryButton, { key: 'ok', disabled: invalid || pending, onClick: submit }, t('submit')),
  ] },
    h('div', { className: 'sf-stack' },
      error ? h('p', { role: 'alert' }, error) : null,
      draftId ? h('p', { className: 'sf-note' }, t('adjustmentDraftSaved')) : null,
      h('p', { className: 'sf-note' }, `${t('planned')}：${wan(plan.plannedAmount) ?? '—'} ${t('unitYuan')} · ${t('increaseHint')}`),
      h(FormRow, { label: t('newAmount') }, h(Field, { type: 'number', min: '0', step: '0.01', disabled: pending || Boolean(draftId), value: newAmount, onChange: setNewAmount })),
      h(FormRow, { label: t('increaseReason'), wide: true }, h(Textarea, { disabled: pending || Boolean(draftId), value: reason, onChange: setReason, maxLength: 500 }))))
}

function PlanPayments({ planId, t }) {
  const [page, setPage] = useState(1), [data, setData] = useState(null), [retry, setRetry] = useState(0)
  useEffect(() => {
    let cancelled = false; setData(null)
    api(`/rest/finance/payment-plans/${planId}/payments?page=${page}&limit=20`)
      .then(value => { if (!cancelled) setData(value.data) })
      .catch(() => { if (!cancelled) setData({ error: true }) })
    return () => { cancelled = true }
  }, [planId, page, retry])
  if (!data) return h('p', { role: 'status' }, t('loading'))
  if (data.error) return h('div', { role: 'alert' }, t('paymentReadFailed'), h(LinkButton, { onClick: () => setRetry(value => value + 1) }, t('retry')))
  const evidence = { CONFIRMED: 'paymentConfirmed', RETURNED: 'paymentReturned', PENDING: 'paymentPending', UNKNOWN: 'paymentUnknown' }
  return h('div', { className: 'sf-stack' },
    h('strong', null, t('paymentTransactions')),
    data.message ? h('p', { className: 'sf-note' }, data.message) : null,
    h('p', { className: 'sf-note' }, t('paymentCoverageUnknown')),
    h(Table, { tableId: 'finance-plan-payments', rows: data.list || [], empty: t('paymentNone'), columns: [
      { key: 'paymentNo', label: t('paymentNumber') },
      { key: 'processNo', label: t('paymentProcess') },
      { key: 'paidAt', label: t('actualPaidDate'), render: row => actualPaymentDate(row.paidAt) ?? '—' },
      { key: 'status', label: t('statusCol'), render: row => `${row.status ?? '—'} · ${t(evidence[row.evidence] || 'paymentUnknown')}` },
      { key: 'currency', label: t('paymentCurrency') },
      { key: 'amount', label: t('amount'), num: true, render: row => wan(row.amount) ?? '—' },
      { key: 'cashAmount', label: t('cashAmount'), num: true, render: row => wan(row.cashAmount) ?? '—' },
      { key: 'acceptanceAmount', label: t('acceptanceAmount'), num: true, render: row => wan(row.acceptanceAmount) ?? '—' },
    ] }),
    h(Pager, { page, total: data.total, limit: 20, onPage: setPage }))
}

function PlanDetailDialog({ plan, ctx, t, onClose }) {
  const fields = [
    [t('org'), plan.orgName], [t('planType'), financeEnumLabel(plan.planType, t, PLAN_LABELS)], [t('description'), plan.description],
    [t('department'), plan.departmentName], [t('costItem'), plan.costItemName], [t('planMonth'), plan.planMonth ? `${plan.planMonth} 月` : '—'],
    [t('planned'), wan(plan.plannedAmount)], [t('actual'), wan(plan.actualAmount)], [t('variance'), wan(plan.varianceAmount)],
    [t('remaining'), wan(plan.remainingAmount)], [t('actualPaidDate'), actualPaymentDate(plan.actualPaidAt)], [t('scheduleDate'), actualPaymentDate(plan.scheduleDate)], [t('priority'), plan.priority ? financeEnumLabel(normalizePaymentPriority(plan.priority), t, Object.fromEntries(PRIORITIES)) : '—'],
    [t('acceptAcceptance'), plan.acceptsAcceptance ? '✓' : '—'], [t('cashAmount'), wan(plan.plannedCashAmount)], [t('acceptanceAmount'), wan(plan.plannedAcceptanceAmount)],
    [t('payee'), plan.payeeName], [t('statusCol'), financeDisplayValue(plan.status, 'status')],
  ]
  return h(Dialog, { title: t('planDetail'), onClose },
    h('dl', { className: 'sf-evidence' }, ...fields.map(([label, value], index) =>
      h('div', { key: index, className: 'sf-evidence-item' }, h('small', null, label), h('strong', null, value ?? '—')))),
    h(PlanPayments, { key: plan.id, planId: plan.id, t }),
    h(CashSettlementsSection, { key: `settlement-${plan.id}`, planId: plan.id, direction: 'PAYMENT', ctx, t }))
}

// ---- 收入计划 ----

function RevenueTab({ revenues, page, onPage, t, canWrite = true, onBackfill, onLedger }) {
  const rows = revenues?.data?.list || revenues?.list || []
  return h(Card, { title: t('revenueVs'), unit: t('unitNote') },
    h('p', { className: 'sf-note' }, t('remainingReceiptHint')),
    h(Table, { tableId: 'finance-RevenueTab-1',
      columns: [
        { label: t('itemName'), key: 'itemName' },
        { label: t('incomeType'), key: 'incomeTypeName' },
        { label: t('payer'), key: 'payerName' },
        { label: t('monthCol'), key: 'month', sortValue: row => row.month, render: row => mm(row.month), num: true },
        { label: t('planned'), key: 'plannedAmount', render: row => wan(row.plannedAmount) ?? '—', num: true },
        { label: t('actual'), key: 'actualAmount', render: row => wan(row.actualAmount) ?? '—', num: true },
        {
          label: t('receiptVariance'), key: 'varianceAmount', num: true, sortValue: revenueVariance,
          render: row => {
            const value = revenueVariance(row)
            if (value === null) return '—'
            return h('span', { className: value < 0 ? 'sf-neg' : 'sf-pos' }, wan(value))
          },
        },
        { label: t('remainingReceipt'), key: 'remainingReceipt', num: true, sortValue: revenueRemaining, render: row => wan(revenueRemaining(row)) ?? '—' },
        { label: t('actions'), key: 'actions', sortable: false, render: row => h('div', { className: 'sf-row', style: { flexWrap: 'nowrap', justifyContent: 'flex-end' } },
        canWrite ? h(LinkButton, { onClick: () => onBackfill(row) }, t('backfill')) : null,
        canWrite ? h(LinkButton, { onClick: () => onLedger(row) }, t('settlementSectionReceipt')) : null) },
      ],
      rows, empty: t('empty'),
    }),
    h(Pager, { page, total: revenues?.data?.total ?? revenues?.total, limit: PAGE_SIZE, onPage }))
}

function revenueRemaining(row) {
  const planned = finite(row.plannedAmount), actual = finite(row.actualAmount)
  return planned === null || actual === null ? null : Math.max(0, Math.round((planned - actual) * 100) / 100)
}

function revenueVariance(row) {
  const source = finite(row.varianceAmount)
  if (source !== null) return source
  const planned = finite(row.plannedAmount), actual = finite(row.actualAmount)
  return planned === null || actual === null ? null : planned - actual
}

function BackfillDialog({ row, t, onClose, act }) {
  const [amount, setAmount] = useState(row.actualAmount != null ? String(row.actualAmount) : '')
  const [date, setDate] = useState(actualPaymentDate(row.actualPaidAt) ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)
  const lock = useRef(false)
  const valid = finite(amount) !== null && Number(amount) >= 0
  const close = () => { if (!lock.current) onClose() }
  const submit = async event => {
    event.preventDefault()
    if (!valid || lock.current) return
    lock.current = true; setPending(true); setError(null)
    try {
      const saved = await act(`/revenue-plans/${row.id}/actuals`, {
        actualAmount: Number(amount),
        ...(date ? { actualPaidAt: new Date(`${date}T00:00:00+08:00`).toISOString() } : {}),
      })
      if (saved !== false) onClose()
      else setError('实际数回填失败，请核对后重试；本次输入已保留。')
    } catch {
      setError('实际数回填失败，请核对后重试；本次输入已保留。')
    } finally { lock.current = false; setPending(false) }
  }
  return h(Dialog, { title: `${t('backfill')} · ${row.itemName ?? ''}`, width: 'sm', onClose: close, footer: [
    h(GhostButton, { key: 'cancel', onClick: close, disabled: pending }, t('cancel')),
    h(PrimaryButton, { key: 'ok', onClick: submit, disabled: !valid || pending }, t('submit')),
  ] },
    h('form', { onSubmit: submit, className: 'sf-stack' },
      error ? h('p', { role: 'alert' }, error) : null,
      h('fieldset', { className: 'sf-stack sf-fieldset', disabled: pending, 'aria-busy': pending },
      h(FormRow, { label: t('actualAmountL') }, h(Field, { type: 'number', min: '0', step: '0.01', value: amount, onChange: setAmount, required: true })),
      h(FormRow, { label: t('actualDateL') }, h(Field, { type: 'date', value: date, onChange: setDate })))))
}
