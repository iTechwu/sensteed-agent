// 片段 5/7 视图：资金（四子视图：资金汇总/排款工作台/调增审批/收入计划；排款/调增/详情 Dialog）

// 实付日期按财务业务时区展示，避免中国本地零点保存为 UTC 后退一天。
function actualPaymentDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
}

const PRIORITIES = [['HIGH', 'priHigh'], ['MEDIUM', 'priMid'], ['LOW', 'priLow']]

function CashView({ ctx, t, onDrill }) {
  const { year, orgId, departments, revision } = ctx
  const canWrite = ctx.financeWriter && ctx.permissions.includes('cash.plan.write')
  const canVerify = ctx.financeWriter && ctx.permissions.includes('cash.plan.verify')
  const writeLock = useRef(false)
  const [tab, setTab] = useState(() => ['summary', 'plans', 'adjustments', 'revenue'].includes(ctx.drillParams?.view) ? ctx.drillParams.view : 'summary')
  const [cash, setCash] = useState(null)
  const [plans, setPlans] = useState(null)
  const [revenues, setRevenues] = useState(null)
  const [filters, setFilters] = useState({ planType: '', departmentId: '', month: ctx.drillParams?.month ? String(ctx.drillParams.month) : '', unassigned: false })
  const [page, setPage] = useState(1)
  const [revenuePage, setRevenuePage] = useState(1)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [reloadTick, setReloadTick] = useState(0)

  const query = (extra = {}) => {
    const params = new URLSearchParams({ year })
    if (orgId) params.set('orgId', orgId)
    if (filters.planType) params.set('planType', filters.planType)
    if (filters.departmentId) params.set('departmentId', filters.departmentId)
    if (filters.month) params.set('month', filters.month)
    if (filters.unassigned) params.set('unassigned', '1')
    for (const [key, value] of Object.entries(extra)) if (value !== undefined && value !== '') params.set(key, value)
    return params.toString()
  }

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
      api(`/cash?${query()}`).then(value => { if (!cancelled) setCash(value) }).catch(() => { if (!cancelled) setCash({ error: true }) })
    }
    if (tab === 'plans') {
      api(`/payment-plans?${query({ page, limit: PAGE_SIZE })}`).then(value => { if (!cancelled) setPlans(value) }).catch(() => { if (!cancelled) setPlans({ error: true }) })
    }
    if (tab === 'revenue') {
      api(`/revenue-plans?year=${year}${orgId ? `&orgId=${orgId}` : ''}&page=${revenuePage}&limit=${PAGE_SIZE}`).then(value => { if (!cancelled) setRevenues(value) }).catch(() => { if (!cancelled) setRevenues({ error: true }) })
    }
    return () => { cancelled = true }
  }, [tab, page, revenuePage, year, orgId, filters.planType, filters.departmentId, filters.month, filters.unassigned, revision, reloadTick])

  const filterBar = tab === 'plans' ? h('div', { className: 'sf-filters' },
    h(Select, { value: filters.planType, onChange: value => { setPage(1); setFilters(f => ({ ...f, planType: value })) }, options: PLAN_TYPES.map(([id, label]) => [id, t(label)]), placeholder: t('planType') }),
    h(SearchSelect, { value: filters.departmentId, onChange: value => { setPage(1); setFilters(f => ({ ...f, departmentId: value })) }, options: (departments || []).map(d => [d.id, d.name]), placeholder: t('department') }),
    h(Select, { value: filters.month, onChange: value => { setPage(1); setFilters(f => ({ ...f, month: value })) }, options: Array.from({ length: 12 }, (_, index) => [String(index + 1), `${index + 1} 月`]), placeholder: t('monthCol') }),
    h('label', { className: 'sf-row', style: { gap: 6, fontSize: 12, color: 'var(--sf-ink2)' } },
      h('input', { type: 'checkbox', checked: filters.unassigned, onChange: event => { setPage(1); setFilters(f => ({ ...f, unassigned: event.target.checked })) } }), t('unassigned'))) : null

  const planRows = plans?.data?.list || plans?.list || []
  return h('div', { className: 'sf-view' },
    h('div', { className: 'sf-row-between' },
      h(PillTabs, { tabs: [['summary', 'cashSummaryV'], ['plans', 'cashPlans'], ['adjustments', 'cashAdjustments'], ['revenue', 'cashRevenue']], value: tab, onChange: id => { setTab(id); setPage(1) }, t }),
      notice ? h(Notice, null, notice) : null),
    filterBar ? h('div', { className: 'sf-row-between' }, filterBar) : null,

    tab === 'summary' ? h(SummaryTab, { cash, t, year }) : null,
    tab === 'plans' ? h(PlansTab, { rows: planRows, total: plans?.data?.total ?? plans?.total, page, onPage: setPage, t, busy, act, canWrite, onDialog: setDialog }) : null,
    tab === 'adjustments' ? h(PlanAdjustmentsTab, { t, revision, reloadTick, busy, act, canWrite, canVerify, onDialog: setDialog }) : null,
    tab === 'revenue' ? h(RevenueTab, { revenues, page: revenuePage, onPage: setRevenuePage, t, canWrite, onBackfill: row => setDialog({ kind: 'backfill', row }) }) : null,

    dialog?.kind === 'closeRemaining' && canWrite ? h(CloseRemainingDialog, { plan: dialog.plan, t, busy, onClose: () => setDialog(null), act }) : null,
    dialog?.kind === 'schedule' ? h(ScheduleDialog, { plan: dialog.plan, t, onClose: () => setDialog(null), act }) : null,
    dialog?.kind === 'increase' ? h(IncreaseDialog, { plan: dialog.plan, t, onClose: () => setDialog(null), act }) : null,
    dialog?.kind === 'planDetail' ? h(PlanDetailDialog, { plan: dialog.plan, t, onClose: () => setDialog(null) }) : null,
    dialog?.kind === 'backfill' ? h(BackfillDialog, { row: dialog.row, t, onClose: () => setDialog(null), act }) : null,
    dialog?.kind === 'reason' ? h(ReasonDialog, { title: dialog.title, required: dialog.required, t, onClose: () => setDialog(null), onSubmit: reason => { setDialog(null); return dialog.run(reason) } }) : null,
    dialog?.kind === 'planAdjDetail' ? h(PlanAdjustDetailDialog, { id: dialog.id, t, onClose: () => setDialog(null) }) : null,
  )
}

function PlanAdjustDetailDialog({ id, t, onClose }) {
  const [detail, setDetail] = useState(null)
  useEffect(() => {
    let cancelled = false
    api(`/plan-adjustments/${id}`).then(value => { if (!cancelled) setDetail(value.data) }).catch(() => { if (!cancelled) setDetail({ error: true }) })
    return () => { cancelled = true }
  }, [id])
  const flow = detail?.flows || detail?.statusLogs || []
  const adjustment = detail?.adjustment ?? detail
  return h(Dialog, { title: `${t('adjustmentOf')} ${adjustment?.code ?? ''}`, onClose },
    h('div', { className: 'sf-stack' },
      adjustment ? h('div', { className: 'sf-row' },
        h(Pill, { tone: ADJ_STATUS_TONES[adjustment.status] ?? 'muted' }, financeEnumLabel(adjustment.status, t, ADJ_STATUS_KEYS)),
        h('span', { className: 'sf-note' }, `${wan(adjustment.oldAmount) ?? '—'} → ${wan(adjustment.newAmount) ?? '—'} ${t('unitYuan')}`)) : null,
      adjustment?.reason ? h('p', { className: 'sf-note' }, `${t('increaseReason')}：${adjustment.reason}`) : null,
      flow.length ? h('div', null, h('strong', null, t('flow')), h('div', { className: 'sf-timeline' }, ...flow.map((item, index) =>
        h('div', { key: index, className: 'sf-timeline-row' },
          h('span', { className: 'sf-timeline-dot' }),
          h('div', { className: 'sf-timeline-main' }, h('span', null, `${financeDisplayValue(item.action ?? item.toStatus, item.action ? 'action' : 'toStatus')} · ${item.operatorName ?? item.operator ?? '—'}`), h('small', null, shortDate(item.at ?? item.createdAt) ?? '')),
          h('span', { className: 'sf-note' }, item.note ?? ''))))) : null))
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

function SummaryTab({ cash, t, year, now }) {
  if (cash?.error) return h(EmptyState, null, t('loadError'))
  const rows = cash?.data?.list || cash?.list || []
  const model = cashSummaryModel(rows, year, now)
  return h('div', { className: 'sf-stack' },
    model.isCurrentYear ? h(Card, { title: `${model.year}-${String(model.month).padStart(2, '0')} · ${t('cashMonthlyExecution')}`, unit: t('unitNote') },
      h('div', { className: 'sf-kpis' },
        ...[['actualBalance', 'cashBalance'], ['plannedIncome', 'plannedIncome'], ['plannedExpense', 'plannedExpense'], ['actualIncome', 'actualIncome'], ['actualExpense', 'actualExpense'], ['remainingPayment', 'remainingUnpaid']].map(([key, label]) =>
          h(KpiCard, { key, icon: 'data', label: t(label), value: yuan(model.totals[key]) ?? '—', negative: model.totals[key] !== null && model.totals[key] < 0 }))),
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
        { label: t('scheduleDate'), key: 'scheduleDate', render: row => shortDate(row.scheduleDate) ?? '—', num: true },
        { label: t('priority'), key: 'priority', render: row => row.priority ? h(Pill, { tone: row.priority === 'HIGH' ? 'rose' : row.priority === 'MEDIUM' ? 'amber' : 'muted' }, financeEnumLabel(row.priority, t, Object.fromEntries(PRIORITIES))) : '—' },
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
  const [scheduleDate, setScheduleDate] = useState(plan.scheduleDate?.slice(0, 10) ?? '')
  const [priority, setPriority] = useState(plan.priority ?? '')
  const [accepts, setAccepts] = useState(Boolean(plan.acceptsAcceptance))
  const [cashAmount, setCashAmount] = useState(plan.plannedCashAmount != null ? String(plan.plannedCashAmount) : '')
  const [acceptanceAmount, setAcceptanceAmount] = useState(plan.plannedAcceptanceAmount != null ? String(plan.plannedAcceptanceAmount) : '')
  const submit = async () => {
    const saved = await act(`/payment-plans/${plan.id}/schedule`, {
      ...(scheduleDate ? { scheduleDate: new Date(`${scheduleDate}T00:00:00`).toISOString() } : {}),
      ...(priority ? { priority } : { priority: null }),
      acceptsAcceptance: accepts,
      ...(cashAmount ? { plannedCashAmount: Number(cashAmount) } : {}),
      ...(acceptanceAmount ? { plannedAcceptanceAmount: Number(acceptanceAmount) } : {}),
    })
    if (saved !== false) onClose()
  }
  return h(Dialog, { title: `${t('schedule')} · ${plan.description ?? ''}`, onClose, footer: [
    h(GhostButton, { key: 'cancel', onClick: onClose }, t('cancel')),
    h(PrimaryButton, { key: 'ok', onClick: submit }, t('submit')),
  ] },
    h('div', { className: 'sf-stack' },
      h(FormRow, { label: t('scheduleDate') }, h(Field, { type: 'date', value: scheduleDate, onChange: setScheduleDate })),
      h(FormRow, { label: t('priority') }, h(Select, { value: priority, onChange: setPriority, options: PRIORITIES.map(([id, label]) => [id, t(label)]), placeholder: '—' })),
      h(FormRow, { label: t('acceptAcceptance') }, h(Switch, { checked: accepts, onChange: setAccepts, label: t('acceptAcceptance') })),
      accepts ? h(FormRow, { label: t('cashAmount') }, h(Field, { type: 'number', min: '0', step: '0.01', value: cashAmount, onChange: setCashAmount })) : null,
      accepts ? h(FormRow, { label: t('acceptanceAmount') }, h(Field, { type: 'number', min: '0', step: '0.01', value: acceptanceAmount, onChange: setAcceptanceAmount })) : null))
}

function IncreaseDialog({ plan, t, onClose, act }) {
  const [newAmount, setNewAmount] = useState('')
  const [reason, setReason] = useState('')
  const invalid = finite(newAmount) === null || Number(newAmount) <= Number(plan.plannedAmount ?? 0) || !reason.trim()
  const submit = async () => { if (invalid) return; const saved = await act('/plan-adjustments', { planId: plan.id, newAmount: Number(newAmount), reason: reason.trim() }); if (saved !== false) onClose() }
  return h(Dialog, { title: `${t('increase')} · ${plan.description ?? ''}`, onClose, footer: [
    h(GhostButton, { key: 'cancel', onClick: onClose }, t('cancel')),
    h(PrimaryButton, { key: 'ok', disabled: invalid, onClick: submit }, t('submit')),
  ] },
    h('div', { className: 'sf-stack' },
      h('p', { className: 'sf-note' }, `${t('planned')}：${wan(plan.plannedAmount) ?? '—'} ${t('unitYuan')} · ${t('increaseHint')}`),
      h(FormRow, { label: t('newAmount') }, h(Field, { type: 'number', min: '0.01', step: '0.01', value: newAmount, onChange: setNewAmount })),
      h(FormRow, { label: t('increaseReason'), wide: true }, h(Textarea, { value: reason, onChange: setReason, maxLength: 500 }))))
}

function PlanDetailDialog({ plan, t, onClose }) {
  const fields = [
    [t('org'), plan.orgName], [t('planType'), financeEnumLabel(plan.planType, t, PLAN_LABELS)], [t('description'), plan.description],
    [t('department'), plan.departmentName], [t('costItem'), plan.costItemName], [t('planMonth'), plan.planMonth ? `${plan.planMonth} 月` : '—'],
    [t('planned'), wan(plan.plannedAmount)], [t('actual'), wan(plan.actualAmount)], [t('variance'), wan(plan.varianceAmount)],
    [t('remaining'), wan(plan.remainingAmount)], [t('actualPaidDate'), actualPaymentDate(plan.actualPaidAt)], [t('scheduleDate'), shortDate(plan.scheduleDate)], [t('priority'), plan.priority ? financeEnumLabel(plan.priority, t, Object.fromEntries(PRIORITIES)) : '—'],
    [t('acceptAcceptance'), plan.acceptsAcceptance ? '✓' : '—'], [t('cashAmount'), wan(plan.plannedCashAmount)], [t('acceptanceAmount'), wan(plan.plannedAcceptanceAmount)],
    [t('payee'), plan.payeeName], [t('statusCol'), financeDisplayValue(plan.status, 'status')],
  ]
  return h(Dialog, { title: t('planDetail'), onClose },
    h('dl', { className: 'sf-evidence' }, ...fields.map(([label, value], index) =>
      h('div', { key: index, className: 'sf-evidence-item' }, h('small', null, label), h('strong', null, value ?? '—')))))
}

// ---- 调增审批台 ----

function PlanAdjustmentsTab({ t, revision, reloadTick, busy, act, canWrite = true, canVerify = true, onDialog }) {
  const [status, setStatus] = useState('SUBMITTED')
  const [data, setData] = useState(null)
  const [page, setPage] = useState(1)
  useEffect(() => {
    let cancelled = false
    api(`/plan-adjustments?${status ? `status=${status}&` : ''}page=${page}&limit=${PAGE_SIZE}`)
      .then(value => { if (!cancelled) setData(value) })
      .catch(() => { if (!cancelled) setData({ error: true }) })
    return () => { cancelled = true }
  }, [status, page, revision, reloadTick])
  const rows = data?.adjustments || []
  const deltaOf = row => { const delta = (finite(row.newAmount) ?? 0) - (finite(row.oldAmount) ?? 0); return delta >= 0 ? `+${wan(delta)}` : wan(delta) }
  return h('div', { className: 'sf-stack' },
    h(PillTabs, { tabs: ADJ_STATUSES, value: status, onChange: value => { setStatus(value); setPage(1) }, t }),
    h(Card, { title: t('cashAdjustments'), unit: t('unitNote') },
      h(Table, { tableId: 'finance-PlanAdjustmentsTab-1',
        columns: [
          { label: t('adjustmentOf'), key: 'code' },
          { label: t('amount'), key: 'amount', sortValue: row => row.newAmount - row.oldAmount, render: row => h('span', null, `${wan(row.oldAmount) ?? '—'} → ${wan(row.newAmount) ?? '—'} `, h('span', { className: 'sf-pos' }, `（${deltaOf(row)}）`)), num: true },
          { label: t('statusCol'), key: 'status', render: row => h(Pill, { tone: ADJ_STATUS_TONES[row.status] ?? 'muted' }, financeEnumLabel(row.status, t, ADJ_STATUS_KEYS)) },
          { label: t('lastSeen'), key: 'submittedAt', render: row => shortDate(row.submittedAt) ?? '—', num: true },
          {
            label: t('actions'), key: 'actions', sortable: false,
            render: row => h('div', { className: 'sf-row', style: { flexWrap: 'nowrap', justifyContent: 'flex-end' } },
              h(LinkButton, { onClick: () => onDialog({ kind: 'planAdjDetail', id: row.id }) }, t('actDetail')),
              canVerify && row.status === 'SUBMITTED' ? h(LinkButton, { onClick: () => act(`/plan-adjustments/${row.id}/approve`, {}) }, t('actApprove')) : null,
              canVerify && row.status === 'SUBMITTED' ? h(LinkButton, { onClick: () => onDialog({ kind: 'reason', title: t('actReject'), required: true, run: reason => act(`/plan-adjustments/${row.id}/reject`, { note: reason }) }) }, t('actReject')) : null,
              canVerify && row.status === 'APPROVED' ? h(LinkButton, { onClick: () => act(`/plan-adjustments/${row.id}/post`, {}) }, t('actPost')) : null,
              row.status === 'DRAFT' || canVerify && row.status === 'SUBMITTED' ? h(LinkButton, { onClick: () => onDialog({ kind: 'reason', title: t('actCancel'), required: false, run: reason => act(`/plan-adjustments/${row.id}/cancel`, reason ? { note: reason } : {}) }) }, t('actCancel')) : null),
          },
        ],
        rows, empty: t('empty'),
      }),
      h(Pager, { page, total: data?.total, limit: PAGE_SIZE, onPage })),
    // 驳回理由 Dialog 与详情 Dialog 由外壳层渲染——这里通过 onDialog 请求，但 Dialog 需要在 CashView 层挂载
    null)
}

// ---- 收入计划 ----

function RevenueTab({ revenues, page, onPage, t, canWrite = true, onBackfill }) {
  const rows = revenues?.data?.list || revenues?.list || []
  return h(Card, { title: t('revenueVs'), unit: t('unitNote') },
    h(Table, { tableId: 'finance-RevenueTab-1',
      columns: [
        { label: t('org'), key: 'orgName', stickyLeft: true },
        { label: t('itemName'), key: 'itemName' },
        { label: t('payer'), key: 'payerName' },
        { label: t('monthCol'), key: 'month', sortValue: row => row.month, render: row => mm(row.month), num: true },
        { label: t('planned'), key: 'plannedAmount', render: row => wan(row.plannedAmount) ?? '—', num: true },
        { label: t('actual'), key: 'actualAmount', render: row => wan(row.actualAmount) ?? '—', num: true },
        {
          label: t('variance'), key: 'varianceAmount', num: true,
          render: row => {
            const value = finite(row.varianceAmount)
            if (value === null) return '—'
            return h('span', { className: value < 0 ? 'sf-neg' : 'sf-pos' }, wan(value))
          },
        },
        { label: t('actions'), key: 'actions', sortable: false, render: row => canWrite ? h(LinkButton, { onClick: () => onBackfill(row) }, t('backfill')) : null },
      ],
      rows, empty: t('empty'),
    }),
    h(Pager, { page, total: revenues?.data?.total ?? revenues?.total, limit: PAGE_SIZE, onPage }))
}

function BackfillDialog({ row, t, onClose, act }) {
  const [amount, setAmount] = useState(row.actualAmount != null ? String(row.actualAmount) : '')
  const [date, setDate] = useState(row.actualPaidAt?.slice(0, 10) ?? '')
  const submit = async event => {
    event.preventDefault()
    const saved = await act(`/revenue-plans/${row.id}/actuals`, {
      actualAmount: Number(amount),
      ...(date ? { actualPaidAt: new Date(`${date}T00:00:00`).toISOString() } : {}),
    })
    if (saved !== false) onClose()
  }
  return h(Dialog, { title: `${t('backfill')} · ${row.itemName ?? ''}`, width: 'sm', onClose, footer: [
    h(GhostButton, { key: 'cancel', onClick: onClose }, t('cancel')),
    h(PrimaryButton, { key: 'ok', onClick: submit, disabled: finite(amount) === null }, t('submit')),
  ] },
    h('form', { onSubmit: submit, className: 'sf-stack' },
      h(FormRow, { label: t('actualAmountL') }, h(Field, { type: 'number', min: '0', step: '0.01', value: amount, onChange: setAmount, required: true })),
      h(FormRow, { label: t('actualDateL') }, h(Field, { type: 'date', value: date, onChange: setDate }))))
}
