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

async function sendToAgent(prompt, setNotice, t, setRecovery) {
  // 由宿主桥接创建新会话；服务不可用时保留分析指令供用户重试。
  try {
    const conversation = globalThis.__sensteed_finance_conversation?.() ?? null
    if (!conversation?.send) throw new Error('conversation_unavailable')
    await conversation.send(prompt)
    globalThis.__sensteed_finance_close?.()
    setNotice(t('sent'))
  } catch (error) {
    await copyFallback(prompt, setNotice, t, sendErrorReason(error, t), setRecovery)
  }
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

function AnalyzeView({ ctx, t }) {
  const { year, orgId, orgs } = ctx
  const [notice, setNotice] = useState(null)
  const [starting, setStarting] = useState(null)
  const [recovery, setRecovery] = useState(null)
  const startingRef = useRef(false)
  const orgName = (orgs || []).find(org => org.id === orgId)?.name
  const scopeName = orgId ? `${orgName || t('analysisOrgPending')} (${orgId})` : t('analysisAllAuthorized')
  const startAnalysis = async entry => {
    if (startingRef.current) return
    startingRef.current = true
    setStarting(entry.id)
    setNotice(null)
    setRecovery(null)
    try { await sendToAgent(analysisPrompt(entry, year, orgName, orgId), setNotice, t, setRecovery) }
    finally { startingRef.current = false; setStarting(null) }
  }
  return h('div', { className: 'sf-view' },
    h('p', { className: 'sf-note' }, t('analyzeHint')),
    h('p', { className: 'sf-note', role: 'status' }, t('analysisScope', { year, org: scopeName })),
    notice ? h('p', { className: 'sf-notice', role: recovery ? 'alert' : 'status' }, notice) : null,
    recovery ? h('label', { className: 'sf-form-row' }, h('span', null, t('analysisPromptLabel')), h('textarea', { readOnly: true, rows: 6, value: recovery, 'aria-label': t('analysisPromptLabel') })) : null,
    h('div', { className: 'sf-analysis-grid' }, ...ANALYSIS_ENTRIES.map(entry => h('article', { className: 'sf-card sf-analysis-card', key: entry.id },
      h('div', { className: 'sf-analysis-head' }, h(Glyph, { name: entry.icon, size: 15 }), h('h2', null, t(`analysis_${entry.id}`))),
      h('p', null, t(`analysis_${entry.id}_desc`)),
      h('div', null, h(PrimaryButton, { busy: starting === entry.id, disabled: starting !== null, onClick: () => startAnalysis(entry), 'aria-label': `${t(`analysis_${entry.id}`)}：${t('send')}` }, h(Glyph, { name: 'send', size: 12 }), t(starting === entry.id ? 'analysisStarting' : 'send')))))),
    h('p', { className: 'sf-note' }, t('analyzingNote')))
}
