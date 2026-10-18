// 深度分析入口：在独立新会话调用对应默认技能。

function sendErrorReason(error) {
  const message = error instanceof Error ? error.message : String(error)
  const reasons = { conversation_unavailable: '会话服务暂不可用', conversation_service_unavailable: '会话服务暂不可用', session_unavailable: '未找到可用会话' }
  return Object.hasOwn(reasons, message) ? reasons[message] : financeErrorText(message)
}

async function sendToAgent(prompt, setNotice, t) {
  // 由宿主桥接创建新会话；服务不可用时保留分析指令供用户重试。
  try {
    const conversation = globalThis.__sensteed_finance_conversation?.() ?? null
    if (conversation?.send) {
      await conversation.send(prompt)
      globalThis.__sensteed_finance_close?.()
      setNotice(t('sent'))
      return
    }
  } catch (error) {
    globalThis.console?.warn?.('[dofe.sensteed-finance] conversation bridge unavailable', error)
    await copyFallback(prompt, setNotice, t, sendErrorReason(error))
    return
  }
  await copyFallback(prompt, setNotice, t)
}

async function copyFallback(prompt, setNotice, t, reason) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable')
    await navigator.clipboard.writeText(prompt)
    setNotice(reason ? t('sendFailReason', { reason }) : t('sendFail'))
  } catch { setNotice(t('copyFailed')) }
}

function analysisPrompt(entry, year, orgName) {
  const context = typeof entry.prompt === 'function' ? entry.prompt(year, orgName) : entry.prompt
  return `/${entry.skill}\n${context}`
}

function AnalyzeView({ ctx, t }) {
  const { year, orgId, orgs } = ctx
  const [notice, setNotice] = useState(null)
  const [starting, setStarting] = useState(null)
  const startingRef = useRef(false)
  const orgName = (orgs || []).find(org => org.id === orgId)?.name
  const startAnalysis = async entry => {
    if (startingRef.current) return
    startingRef.current = true
    setStarting(entry.id)
    setNotice(null)
    try { await sendToAgent(analysisPrompt(entry, year, orgName), setNotice, t) }
    finally { startingRef.current = false; setStarting(null) }
  }
  return h('div', { className: 'sf-view' },
    h('p', { className: 'sf-note' }, t('analyzeHint')),
    h('div', { className: 'sf-analysis-grid' }, ...ANALYSIS_ENTRIES.map(entry => h('article', { className: 'sf-card sf-analysis-card', key: entry.id },
      h('div', { className: 'sf-analysis-head' }, h(Glyph, { name: entry.icon, size: 15 }), h('h2', null, t(`analysis_${entry.id}`))),
      h('p', null, t(`analysis_${entry.id}_desc`)),
      h('div', null, h(PrimaryButton, { busy: starting === entry.id, disabled: starting !== null, onClick: () => startAnalysis(entry), 'aria-label': `${t(`analysis_${entry.id}`)}：${t('send')}` }, h(Glyph, { name: 'send', size: 12 }), t(starting === entry.id ? 'analysisStarting' : 'send')))))),
    notice ? h(Notice, null, notice) : null,
    h('p', { className: 'sf-note' }, t('analyzingNote')))
}
