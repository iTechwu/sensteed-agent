const React = require('react')
const { createElement: h, useEffect, useRef, useState } = React
const { Tooltip, IconShieldOutlineRegular, IconRefreshOutlineRegular, IconSearchOutlineRegular, IconRightUpOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')
const REQUEST_TIMEOUT_MS = 30000

const PANEL_ID = 'supplier-risk'
const BASE = '/api/desktop/sensteed/supplier-risk'
const TABS = [
  ['overview', '风险总览'], ['suppliers', '供应商台账'], ['enterprise', '工商与司法'],
  ['media', '媒体舆情'], ['business', '业务影响'], ['weekly', '风险周报'],
]
let selectedSupplier = ''
let selectedSupplierName = ''
let selectedEvidence = ''
let selectedEvidenceKind = ''
let selectedEvidenceEventId = ''
let currentScopeId = ''
const panelMemory = Object.create(null)

function adoptScope(scopeId) {
  if (typeof scopeId !== 'string' || !scopeId || scopeId === currentScopeId) return
  supplierNavigation().adoptScope(scopeId)
  const hadScope = Boolean(currentScopeId)
  currentScopeId = scopeId
  selectedSupplier = ''
  selectedSupplierName = ''
  selectedEvidence = ''
  selectedEvidenceKind = ''
  selectedEvidenceEventId = ''
  for (const key of Object.keys(panelMemory)) delete panelMemory[key]
  if (hadScope) window.dispatchEvent(new CustomEvent('supplier-risk:scope-changed'))
}

async function api(action, args = {}, signal) {
  const bridge = supplierNavigation(), epoch = bridge.epoch
  const response = await fetch(`${BASE}/call`, {
    method: 'POST', credentials: 'same-origin', redirect: 'error',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, args }),
    signal: AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), bridge.signal, ...(signal ? [signal] : [])]),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.ok !== true) throw new Error(body?.error || `http_${response.status}`)
  if (epoch !== bridge.epoch) throw new DOMException('Stale identity response', 'AbortError')
  adoptScope(body.scopeId)
  return body.data
}

function useRemembered(key, initial) {
  const storageKey = `${currentScopeId}:${key}`
  const [state, setState] = useState(() => ({
    key: storageKey,
    value: Object.hasOwn(panelMemory, storageKey) ? panelMemory[storageKey] : initial,
  }))
  const value = state.key === storageKey
    ? state.value
    : Object.hasOwn(panelMemory, storageKey) ? panelMemory[storageKey] : initial
  useEffect(() => {
    setState({ key: storageKey, value })
  }, [storageKey])
  const update = next => setState(previousState => {
    const previous = previousState.key === storageKey
      ? previousState.value
      : Object.hasOwn(panelMemory, storageKey) ? panelMemory[storageKey] : initial
    const value = typeof next === 'function' ? next(previous) : next
    panelMemory[storageKey] = value
    return { key: storageKey, value }
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
    supply_chain_unavailable: '供应链数据服务暂不可用，请稍后重试。',
    connection_unavailable: '本地工作台连接已中断，请重新连接后重试。',
    credential_unavailable: '本机 Models 凭据不可用，请检查 Sensteed 登录状态。',
    gateway_request_failed: '供应链服务暂不可用。', supplier_mcp_request_failed: '供应链服务暂不可用。',
    VERSION_CONFLICT: '记录已被其他操作更新，请刷新后重试。', STALE_EVIDENCE: '证据已变化，请刷新后重新保存。',
    EVIDENCE_NOT_FOUND: '这条证据已不可用，请返回列表选择其他记录。',
    invalid_gateway_response: '服务返回的数据不完整，请重试；已有草稿会保留。',
    SUPPLIER_NOT_FOUND: '该供应商当前不可用。', REPORT_NOT_READY: '周报尚未生成完成。',
    supplier_list_incomplete: '供应商台账已发生变化，未能完整读取，请刷新重试。',
  }
  return map[error?.message] || `加载或保存失败（${error?.message || '未知错误'}）`
}

let supplierNavigationBridge
function supplierNavigation() { return supplierNavigationBridge ||= createDesktopNavigationBridge(React) }
