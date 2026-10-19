// 深度分析入口：在独立新会话调用对应默认技能。

function sendErrorReason(error, t) {
  const message = error instanceof Error ? error.message : String(error)
  const reasons = {
    conversation_unavailable: 'analysisSessionUnavailable', conversation_service_unavailable: 'analysisSessionUnavailable', session_unavailable: 'analysisSessionUnavailable',
    analysis_skill_invalid: 'analysisSkillInvalid', analysis_catalog_unavailable: 'analysisCatalogUnavailable', analysis_skill_unavailable: 'analysisSkillUnavailable',
    analysis_login_required: 'analysisLoginRequired', analysis_access_denied: 'analysisAccessDenied', analysis_access_unavailable: 'analysisAccessUnavailable',
  }
  return Object.hasOwn(reasons, message) ? t(reasons[message]) : t('analysisStartFailed')
}

async function openAnalysisSession(receipt, setNotice, t, setSubmitted) {
  try { if (!receipt?.opened) await receipt?.open?.() }
  catch {
    setSubmitted(receipt)
    setNotice(t('analysisSentNotOpened'))
    return
  }
  setSubmitted(null)
  setNotice(t('sent'))
  // Submission and navigation already succeeded. Panel cleanup cannot undo either.
  try { await globalThis.__sensteed_finance_close?.() } catch {}
}

async function sendToAgent(prompt, setNotice, t, setRecovery, setSubmitted) {
  // 由宿主桥接创建新会话；服务不可用时保留分析指令供用户重试。
  let receipt
  try {
    const conversation = globalThis.__sensteed_finance_conversation?.() ?? null
    if (!conversation?.send) throw new Error('conversation_unavailable')
    receipt = await conversation.send(prompt)
  } catch (error) {
    await copyFallback(prompt, setNotice, t, sendErrorReason(error, t), setRecovery)
    return
  }
  if (receipt?.opened === false) {
    setSubmitted(receipt)
    setNotice(t('analysisSentNotOpened'))
  } else await openAnalysisSession(receipt, setNotice, t, setSubmitted)
}

async function copyFallback(prompt, setNotice, t, reason, setRecovery) {
  setRecovery(prompt)
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable')
    await navigator.clipboard.writeText(prompt)
    setNotice(t('sendFailReason', { reason }))
  } catch { setNotice(t('sendFailCopyFailed', { reason })) }
}

function analysisPrompt(entry, year, orgName, orgId) {
  const context = typeof entry.prompt === 'function' ? entry.prompt(year, orgName || (orgId ? '所选主体' : '')) : entry.prompt
  const scope = orgId ? `所选主体 ID：${orgId}；名称：${orgName || '待核实'}。请通过 bootstrap 与主体列表核对，不得扩大为全部主体。` : '全部授权主体。'
  return `/${entry.skill}\n${context}\n分析范围：${year} 年；${scope}租户级统计须单独标注范围。`
}

function FinanceInlineAssistant({ ctx }) {
  const [question, setQuestion] = useFinanceViewState(ctx, 'assistantQuestion', '')
  const [submission, setSubmission] = useFinanceViewState(ctx, 'assistantSubmission', null)
  const query = new URLSearchParams({ year: ctx.year, ...(ctx.orgId ? { orgId: ctx.orgId } : {}) })
  const budget = useFinanceResource(`/finance/budget/summary?${query}`, ctx.revision)
  const cash = useFinanceResource(`/finance/cash-summary?${query}`, ctx.revision)
  const quality = useFinanceResource('/finance/data-quality', ctx.revision)
  const resources = { budget, cash, quality }
  const unavailable = value => {
    const resource = resources[financeQuestionIntent(value)]
    return Boolean(resource && (resource.loading || resource.error))
  }
  const scope = JSON.stringify([ctx.year, ctx.orgId || ''])
  const submitted = submission?.scope === scope ? submission.text : ''
  const answer = submitted && !unavailable(submitted) ? financeInlineAnswer(submitted, { year: ctx.year, orgId: ctx.orgId || undefined, budget: budget.data, cash: cash.data, quality: quality.data }) : null
  const ask = value => { const text = value.trim(); if (text && !unavailable(text)) { setQuestion(text); setSubmission({ text, scope }) } }
  const names = { budget: '预算', cash: '资金', quality: '质量' }
  const errors = Object.entries(resources).filter(([, resource]) => resource.error)
  const pending = resources[financeQuestionIntent(submitted)]?.loading
  const openSource = () => {
    const destination = financeBusinessDestination(answer.href)
    if (destination) ctx.onNavigate?.(destination.tab, destination.params)
  }
  return h('section', { className: 'sf-card sf-analysis-card', 'aria-label': '可信财务问答' },
    h('div', { className: 'sf-analysis-head' }, h('h2', null, '可信财务问答')),
    h('p', null, '确定性计算 · 金额单位：元。预算和资金按当前范围分析；数据质量检查覆盖全部年度与主体。'),
    errors.length ? h('div', { role: 'status', className: 'sf-notice' }, `${errors.map(([key]) => names[key]).join('、')}数据暂时无法读取，对应问题会在恢复后开放；其他问题仍可继续提问。`, ...errors.map(([key, resource]) => h(GhostButton, { key, onClick: resource.retry }, `重试${names[key]}`))) : null,
    h('div', { className: 'sf-row', style: { flexWrap: 'wrap' } }, ...['哪些项目已超预算？', '收入与支出达成情况如何？', '哪些月份存在资金缺口？', '数据质量检查结果如何？'].map(prompt => h(GhostButton, { key: prompt, disabled: unavailable(prompt), onClick: () => ask(prompt) }, prompt))),
    h('form', { className: 'sf-assistant-question', onSubmit: event => { event.preventDefault(); ask(question) } },
      h(Field, { value: question, onChange: setQuestion, 'aria-label': '输入财务问题', placeholder: '例如：哪些月份存在资金缺口？', maxLength: 1000 }),
      h(PrimaryButton, { type: 'submit', disabled: !question.trim() || unavailable(question) }, '发送问题')),
    pending ? h('p', { role: 'status' }, '正在读取当前范围的数据…') : answer ? h('article', { 'aria-live': 'polite', className: 'sf-assistant-answer' },
      h('p', null, submitted), h('strong', null, answer.title), h('p', null, answer.body),
      answer.evidence.length ? h('ul', null, ...answer.evidence.map((value, index) => h('li', { key: index }, value))) : null,
      answer.href ? h(GhostButton, { onClick: openSource }, '核对来源数据') : null,
      answer.sources.length ? h('small', null, `来源：${answer.sources.join('、')}`) : null) : h('p', null, errors.length === 3 ? '财务数据暂时无法读取，请重试后再提问。' : '从已治理的财务数据开始提问，支持预算、收支、资金和数据质量问题。'))
}

const idleAnalysisOperation = { starting: false, submitted: null }
const subscribeIdleAnalysis = () => () => {}
const getIdleAnalysis = () => idleAnalysisOperation

function AnalyzeView({ ctx, t }) {
  const { year, orgId, orgs } = ctx
  const [notice, setNotice] = useState(null)
  const [starting, setStarting] = useState(null)
  const [recovery, setRecovery] = useState(null)
  const [localSubmitted, setSubmitted] = useState(null)
  const bridge = globalThis.__sensteed_finance_conversation?.()
  const operation = useSyncExternalStore(bridge?.subscribe || subscribeIdleAnalysis, bridge?.getSnapshot || getIdleAnalysis, getIdleAnalysis)
  const submitted = localSubmitted || operation.submitted
  const busy = starting !== null || operation.starting
  const startingRef = useRef(false)
  const submittedRef = useRef(submitted)
  submittedRef.current = submitted
  const recordSubmitted = receipt => { submittedRef.current = receipt; setSubmitted(receipt) }
  const orgName = (orgs || []).find(org => org.id === orgId)?.name
  const scopeName = orgId ? `${orgName || t('analysisOrgPending')} (${orgId})` : t('analysisAllAuthorized')
  const startAnalysis = async entry => {
    if (startingRef.current || bridge?.getSnapshot?.().starting || submittedRef.current) return
    startingRef.current = true
    setStarting(entry.id)
    setNotice(null)
    setRecovery(null)
    try { await sendToAgent(analysisPrompt(entry, year, orgName, orgId), setNotice, t, setRecovery, recordSubmitted) }
    finally { startingRef.current = false; setStarting(null) }
  }
  const reopenSubmitted = async () => {
    if (startingRef.current || !submittedRef.current) return
    startingRef.current = true
    setStarting('reopen')
    try { await openAnalysisSession(submittedRef.current, setNotice, t, recordSubmitted) }
    finally { startingRef.current = false; setStarting(null) }
  }
  return h('div', { className: 'sf-view' },
    h('p', { className: 'sf-note', role: 'status' }, t('analysisScope', { year, org: scopeName })),
    h(FinanceInlineAssistant, { key: `${year}-${orgId}`, ctx }),
    h('h2', null, '新会话深度分析'),
    h('p', { className: 'sf-note' }, t('analyzeHint')),
    notice || submitted || operation.starting ? h('p', { className: 'sf-notice', role: recovery || submitted ? 'alert' : 'status' }, notice || t(submitted ? 'analysisSentNotOpened' : 'analysisStarting')) : null,
    submitted ? h('div', null, h(PrimaryButton, { onClick: reopenSubmitted, disabled: busy, busy: starting === 'reopen', 'aria-label': t('analysisOpenSession') }, t('analysisOpenSession'))) : null,
    recovery ? h('label', { className: 'sf-form-row' }, h('span', null, t('analysisPromptLabel')), h('textarea', { readOnly: true, rows: 6, value: recovery, 'aria-label': t('analysisPromptLabel') })) : null,
    h('div', { className: 'sf-analysis-grid' }, ...ANALYSIS_ENTRIES.map(entry => h('article', { className: 'sf-card sf-analysis-card', key: entry.id },
      h('div', { className: 'sf-analysis-head' }, h(Glyph, { name: entry.icon, size: 15 }), h('h2', null, t(`analysis_${entry.id}`))),
      h('p', null, t(`analysis_${entry.id}_desc`)),
      h('div', null, h(PrimaryButton, { busy: starting === entry.id, disabled: busy || Boolean(submitted), onClick: () => startAnalysis(entry), 'aria-label': `${t(`analysis_${entry.id}`)}：${t('send')}` }, h(Glyph, { name: 'send', size: 12 }), t(starting === entry.id ? 'analysisStarting' : 'send')))))),
    h('p', { className: 'sf-note' }, t('analyzingNote')))
}
