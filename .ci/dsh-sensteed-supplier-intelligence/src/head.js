const React = require('react')
const { createElement: h, useEffect, useState } = React
const { IconShieldOutlineRegular, IconRefreshOutlineRegular, IconSearchOutlineRegular, IconRightUpOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')

const PANEL_ID = 'supplier-risk'
const BASE = '/api/desktop/sensteed/supplier-risk'
const TABS = [
  ['overview', '风险总览'], ['suppliers', '供应商台账'], ['enterprise', '工商与司法'],
  ['media', '媒体舆情'], ['business', '业务影响'], ['weekly', '风险周报'],
]
let selectedSupplier = ''
let selectedEvidence = ''
let selectedEvidenceKind = ''
let selectedEvidenceEventId = ''
let currentScopeId = ''
const panelMemory = Object.create(null)

function adoptScope(scopeId) {
  if (typeof scopeId !== 'string' || !scopeId || scopeId === currentScopeId) return
  const hadScope = Boolean(currentScopeId)
  currentScopeId = scopeId
  selectedSupplier = ''
  selectedEvidence = ''
  selectedEvidenceKind = ''
  selectedEvidenceEventId = ''
  for (const key of Object.keys(panelMemory)) delete panelMemory[key]
  if (hadScope) window.dispatchEvent(new CustomEvent('supplier-risk:scope-changed'))
}

async function api(action, args = {}, signal) {
  const response = await fetch(`${BASE}/call`, {
    method: 'POST', credentials: 'same-origin', redirect: 'error',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, args }),
    signal: signal || AbortSignal.timeout(30000),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.ok !== true) throw new Error(body?.error || `http_${response.status}`)
  adoptScope(body.scopeId)
  return body.data
}

function useRemembered(key, initial) {
  const storageKey = `${currentScopeId}:${key}`
  const [value, setValue] = useState(() => Object.hasOwn(panelMemory, storageKey) ? panelMemory[storageKey] : initial)
  useEffect(() => {
    setValue(Object.hasOwn(panelMemory, storageKey) ? panelMemory[storageKey] : initial)
  }, [storageKey])
  const update = next => setValue(previous => {
    const value = typeof next === 'function' ? next(previous) : next
    panelMemory[storageKey] = value
    return value
  })
  useEffect(() => { panelMemory[storageKey] = value }, [storageKey, value])
  return [value, update]
}

function fmt(value) {
  if (!value) return '时间未记录'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? String(value) : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function errorText(error) {
  const map = {
    credential_unavailable: '本机 Models 凭据不可用，请检查 Sensteed 登录状态。',
    gateway_request_failed: '供应链服务暂不可用。', supplier_mcp_request_failed: '供应链服务暂不可用。',
    VERSION_CONFLICT: '记录已被其他操作更新，请刷新后重试。', STALE_EVIDENCE: '证据已变化，请刷新后重新保存。',
    SUPPLIER_NOT_FOUND: '该供应商当前不可用。', REPORT_NOT_READY: '周报尚未生成完成。',
  }
  return map[error?.message] || `加载或保存失败（${error?.message || '未知错误'}）`
}
