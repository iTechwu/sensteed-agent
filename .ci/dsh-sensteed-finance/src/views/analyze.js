// 片段 5/7 视图：深度分析入口（预制指令投递当前会话，Agent 调 mcp__finance__* 完成分析）

function sendErrorReason(error) {
  const message = error instanceof Error ? error.message : String(error)
  const reasons = { conversation_unavailable: '会话服务暂不可用', conversation_service_unavailable: '会话服务暂不可用', session_unavailable: '未找到可用会话' }
  return Object.hasOwn(reasons, message) ? reasons[message] : financeErrorText(message)
}

function sendToAgent(prompt, setNotice, t) {
  // 优先直接投递到当前会话；宿主未暴露 conversation 服务时降级为剪贴板复制。
  try {
    const conversation = globalThis.__sensteed_finance_conversation?.() ?? null
    if (conversation?.send) {
      void conversation.send(prompt)
        .then(() => { globalThis.__sensteed_finance_close?.(); setNotice(t('sent')) })
        .catch(error => {
          globalThis.console?.warn?.('[dofe.sensteed-finance] conversation send failed', error)
          copyFallback(prompt, setNotice, t, sendErrorReason(error))
        })
      return
    }
  } catch (error) {
    globalThis.console?.warn?.('[dofe.sensteed-finance] conversation bridge unavailable', error)
    copyFallback(prompt, setNotice, t, sendErrorReason(error))
    return
  }
  copyFallback(prompt, setNotice, t)
}

function copyFallback(prompt, setNotice, t, reason) {
  const failed = () => setNotice(t('copyFailed'))
  if (!navigator.clipboard?.writeText) return failed()
  try { navigator.clipboard.writeText(prompt).then(() => setNotice(reason ? t('sendFailReason', { reason }) : t('sendFail')), failed) } catch { failed() }
}

function analysisPrompt(entry, year, orgName) {
  const context = typeof entry.prompt === 'function' ? entry.prompt(year, orgName) : entry.prompt
  return `/${entry.skill}\n${context}`
}

function AnalyzeView({ ctx, t }) {
  const { year, orgId, orgs } = ctx
  const [notice, setNotice] = useState(null)
  const orgName = (orgs || []).find(org => org.id === orgId)?.name
  return h('div', { className: 'sf-view' },
    h('p', { className: 'sf-note' }, t('analyzeHint')),
    h('div', { className: 'sf-analysis-grid' }, ...ANALYSIS_ENTRIES.map(entry => h('article', { className: 'sf-card sf-analysis-card', key: entry.id },
      h('div', { className: 'sf-analysis-head' }, h(Glyph, { name: entry.icon, size: 15 }), h('h2', null, t(`analysis_${entry.id}`))),
      h('p', null, t(`analysis_${entry.id}_desc`)),
      h('div', null, h(PrimaryButton, { onClick: () => sendToAgent(analysisPrompt(entry, year, orgName), setNotice, t) }, h(Glyph, { name: 'send', size: 12 }), t('send')))))),
    notice ? h(Notice, null, notice) : null,
    h('p', { className: 'sf-note' }, t('analyzingNote')))
}
