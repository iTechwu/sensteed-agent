import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const SKILL_URL = new URL('./skills/supplier-intelligence/SKILL.md', import.meta.url)
const REQUIRED_TOOLS = [
  'supply_chain_capabilities_get',
  'supply_chain_suppliers_list',
  'supply_chain_qcc_capabilities_get',
  'supply_chain_qcc_company_search',
  'supply_chain_qcc_company_data_get',
  'supply_chain_qcc_company_data_list',
  'supply_chain_relationships_list',
  'supply_chain_intelligence_report_get',
  'supply_chain_social_monitoring_collect',
  'supply_chain_run_get',
]
const MCP_URL = 'https://ai.hozonauto.com/mcp/tools/supply-chain'
const MCP_TOOL_PREFIXES = ['mcp__supply-chain__', 'mcp__tools-supply-chain__']
const ROUTE_PREFIX = '/api/desktop/sensteed/supplier-risk'
const MAX_BODY_BYTES = 256 * 1024
const READ_TOOLS = new Set([
  'supply_chain_workbench_overview_get', 'supply_chain_workbench_suppliers_list',
  'supply_chain_workbench_evidence_list', 'supply_chain_workbench_evidence_get',
  'supply_chain_business_context_get', 'supply_chain_business_analysis_list',
  'supply_chain_weekly_report_plan_get', 'supply_chain_weekly_reports_list',
  'supply_chain_weekly_report_get', 'supply_chain_run_get',
])
const WRITE_TOOLS = new Set([
  'supply_chain_business_context_save', 'supply_chain_business_analysis_save',
  'supply_chain_weekly_report_plan_save', 'supply_chain_weekly_report_mark_read',
  'supply_chain_weekly_report_retry', 'supply_chain_risk_event_review',
  'supply_chain_supplier_create', 'supply_chain_supplier_import',
])
let credentialFingerprint = ''
let credentialScopeId = randomUUID()

export const inject = ['tools', 'systemPrompt', 'webServer', 'credentials', 'dofeAccess', 'dofeAuth']
export const capabilities = Object.freeze([
  {
    "id": "supplier-intelligence",
    "kind": "business",
    "group": "business",
    "name": "供应商情报与风险",
    "description": "查询企业与供应商信息，采集舆情，分析关系与风险变化。"
  }
])

export function apply(ctx, overrides = {}) {
  const disposers = []
  const canUseSupplier = scope => {
    const gate = typeof ctx.dofeAccess === 'function' ? ctx.dofeAccess() : undefined
    if (gate && (!gate.ready || !gate.enabledPlugins?.includes('supplier-intelligence')
      || !gate.entitlements?.plugins?.includes('supplier-intelligence'))) return false
    return (ctx.tools?.schemas?.(scope) || []).some(tool => MCP_TOOL_PREFIXES.some(prefix => String(tool.name || '').startsWith(prefix)))
  }
  if (ctx.systemPrompt?.section) {
    disposers.push(ctx.systemPrompt.section({
      name: 'sensteed:supplier-intelligence-skill',
      order: 9,
      text: context => canUseSupplier(context?.scope) ? readFileSync(SKILL_URL, 'utf8') : '',
    }))
  }
  if (ctx.tools?.register) {
    let disposeBootstrap
    let reconciling = false
    let disposed = false
    const reconcile = () => {
      if (reconciling || disposed) return
      reconciling = true
      try {
        if (!canUseSupplier()) { disposeBootstrap?.(); disposeBootstrap = undefined; return }
        if (disposeBootstrap) return
        disposeBootstrap = ctx.tools.register({
          name: 'sensteed_supplier_intelligence_bootstrap',
          description: 'Inspect the local supply-chain tool catalog before company search, supplier collection, or public-opinion analysis. This tool is read-only.',
          parameters: { type: 'object', additionalProperties: false, properties: {} },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
          },
          isConcurrencySafe: () => true,
          async execute() {
            if (!canUseSupplier()) return { ok: false, error: '供应商情报未启用或工具暂不可用。' }
            const schemas = ctx.tools.schemas?.() || []
            const names = schemas.map(item => String(item.name || ''))
            const tools = Object.fromEntries(REQUIRED_TOOLS.map(name => [name, names.some(candidate => candidate.includes(name))]))
            const missing = Object.entries(tools).filter(([, available]) => !available).map(([name]) => name)
            return {
              ok: missing.length === 0,
              result: {
                dataSource: 'local_tool_catalog',
                externalCallMade: false,
                tools,
                missing,
                usage: 'For a company not yet in the supplier registry, search with supply_chain_qcc_company_search first. Show every candidate and wait for the user to select; never auto-select. Only then create/verify the supplier and use QCC capability discovery plus cache-aware data reads. Submit social collection only for verified suppliers with a stable idempotencyKey and poll the original runId.',
              },
            }
          },
        })
      } finally { reconciling = false }
    }
    reconcile()
    if (ctx.on) {
      disposers.push(ctx.on('dofe/access-changed', reconcile))
      disposers.push(ctx.on('tools/change', reconcile))
    }
    disposers.push(() => { disposed = true; disposeBootstrap?.(); disposeBootstrap = undefined })
  }
  if (ctx.webServer?.register && overrides.registerHostRoute !== false) {
    const fetchImpl = overrides.fetch || globalThis.fetch
    const origin = `http://127.0.0.1:${String(ctx.webServer.port)}`
    const isSameOrigin = req => {
      const address = req.socket?.remoteAddress ?? ''
      const loopback = address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
      if (!loopback || (req.headers['sec-fetch-site'] !== undefined && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) return false
      if (req.method === 'GET') return req.headers.origin === undefined || req.headers.origin === origin
      return req.method === 'POST' && req.headers.origin === origin
        && req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
    }
    disposers.push(ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      async handler(req, res) {
        const respond = (status, value) => {
          res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' })
          res.end(JSON.stringify(value))
        }
        if (!isSameOrigin(req)) return respond(403, { ok: false, error: 'same_origin_required' })
        const path = new URL(req.url, origin).pathname
        if (req.method === 'GET' && path === ROUTE_PREFIX + '/access') {
          const gate = typeof ctx.dofeAccess === 'function' ? ctx.dofeAccess() : undefined
          const available = gate?.ready === true && gate.enabledPlugins?.includes('supplier-intelligence')
            && gate.entitlements?.plugins?.includes('supplier-intelligence')
            && (ctx.tools.schemas?.() || []).some(tool => MCP_TOOL_PREFIXES.some(prefix => String(tool.name || '').startsWith(prefix)))
          const apiKey = await resolveApiKey(ctx)
          const auth = ctx.dofeAuth ?? ctx.get?.('dofeAuth')
          const session = auth?.getDatasourceSession?.()
          if (apiKey) refreshCredentialScope(apiKey, `${session?.tenantId || ''}\0${session?.operator || ''}`)
          return respond(200, { ok: true, allowed: Boolean(available && apiKey), scopeId: credentialScopeId })
        }
        if (req.method !== 'POST' || path !== ROUTE_PREFIX + '/call') return respond(404, { ok: false, error: 'not_found' })
        const gate = typeof ctx.dofeAccess === 'function' ? ctx.dofeAccess() : undefined
        if (gate?.ready !== true || !gate.enabledPlugins?.includes('supplier-intelligence')
          || !gate.entitlements?.plugins?.includes('supplier-intelligence')) return respond(403, { ok: false, error: 'plugin_unavailable' })
        const schemas = ctx.tools.schemas?.() || []
        const available = schemas.map(tool => String(tool.name || ''))
        let body
        try { body = await readJsonBody(req, MAX_BODY_BYTES) } catch { return respond(400, { ok: false, error: 'invalid_request' }) }
        if (!body || typeof body.action !== 'string' || !body.args || typeof body.args !== 'object' || Array.isArray(body.args)) return respond(400, { ok: false, error: 'invalid_request' })
        const tool = body.action
        if ((!READ_TOOLS.has(tool) && !WRITE_TOOLS.has(tool)) || !available.some(name => MCP_TOOL_PREFIXES.some(prefix => name === `${prefix}${tool}`))) return respond(404, { ok: false, error: 'tool_unavailable' })
        if (WRITE_TOOLS.has(tool) && body.args.confirm !== true) return respond(400, { ok: false, error: 'confirmation_required' })
        const args = normalizeArguments(tool, body.args)
        if (!args) return respond(400, { ok: false, error: 'invalid_arguments' })
        try {
          const apiKey = await resolveApiKey(ctx)
          if (!apiKey) return respond(503, { ok: false, error: 'credential_unavailable' })
          const auth = ctx.dofeAuth ?? ctx.get?.('dofeAuth')
          const session = auth?.getDatasourceSession?.()
          refreshCredentialScope(apiKey, `${session?.tenantId || ''}\0${session?.operator || ''}`)
          const result = await callMcp(fetchImpl, apiKey, tool, args, ctx.logger)
          if (!result.ok) return respond(result.status || 502, { ok: false, error: result.error })
          return respond(200, { ok: true, data: result.data, scopeId: credentialScopeId })
        } catch (error) {
          ctx.logger?.info?.(`supplier risk: ${tool} failed (${safeErrorCode(error)})`)
          return respond(503, { ok: false, error: safeErrorCode(error) })
        }
      },
    }))
  }
  return () => disposers.reverse().forEach(dispose => dispose?.())
}

async function resolveApiKey(ctx) {
  try {
    const credential = await ctx.credentials?.resolve?.('MODELS_API_KEY')
    const key = typeof credential === 'string' ? credential : credential?.value
    return typeof key === 'string' && key.trim() ? key.trim() : ''
  } catch { return '' }
}

function refreshCredentialScope(apiKey, tenantId = '') {
  const fingerprint = createHash('sha256').update(apiKey).update('\0').update(tenantId).digest('hex')
  if (fingerprint !== credentialFingerprint) {
    credentialFingerprint = fingerprint
    credentialScopeId = randomUUID()
  }
}

function normalizeArguments(tool, input) {
  const allowed = {
    supply_chain_workbench_overview_get: [],
    supply_chain_workbench_suppliers_list: ['page', 'pageSize', 'query', 'category', 'verificationStatus'],
    supply_chain_workbench_evidence_list: ['kind', 'page', 'pageSize', 'supplierId', 'category', 'reviewStatus', 'source', 'fromTime', 'toTime'],
    supply_chain_workbench_evidence_get: ['kind', 'evidenceId'],
    supply_chain_business_context_get: ['supplierId'],
    supply_chain_business_analysis_list: ['supplierId', 'page', 'pageSize'],
    supply_chain_weekly_report_plan_get: [],
    supply_chain_weekly_reports_list: ['page', 'pageSize'],
    supply_chain_weekly_report_get: ['reportId'],
    supply_chain_run_get: ['runId'],
    supply_chain_business_context_save: ['supplierId', 'expectedVersion', 'fields', 'idempotencyKey', 'confirm'],
    supply_chain_business_analysis_save: ['supplierId', 'expectedVersion', 'backgroundVersion', 'evidenceVersion', 'evidenceIds', 'fields', 'idempotencyKey', 'confirm'],
    supply_chain_weekly_report_plan_save: ['expectedVersion', 'fields', 'idempotencyKey', 'confirm'],
    supply_chain_weekly_report_mark_read: ['reportId', 'confirm'],
    supply_chain_weekly_report_retry: ['reportId', 'confirm'],
    supply_chain_risk_event_review: ['eventId', 'decision', 'reasonCode', 'idempotencyKey', 'confirm', 'comment'],
    supply_chain_supplier_create: ['supplier', 'idempotencyKey', 'confirm'],
    supply_chain_supplier_import: ['csvText', 'idempotencyKey', 'confirm'],
  }[tool]
  if (!allowed || Object.keys(input).some(key => !allowed.includes(key))) return null
  if (tool === 'supply_chain_workbench_evidence_list' && !['enterprise', 'media'].includes(input.kind)) return null
  if (tool === 'supply_chain_workbench_evidence_get' && !['enterprise', 'media'].includes(input.kind)) return null
  if (tool === 'supply_chain_risk_event_review' && !['CONFIRMED', 'REJECTED'].includes(input.decision)) return null
  if (tool === 'supply_chain_supplier_create' && (!input.supplier || typeof input.supplier.displayName !== 'string' || !input.supplier.displayName.trim())) return null
  if (tool === 'supply_chain_supplier_import' && (typeof input.csvText !== 'string' || !input.csvText.trim() || input.csvText.length > 20_000)) return null
  return input
}

async function readJsonBody(req, limit) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (Buffer.byteLength(raw) > limit) throw new Error('request_too_large')
  }
  return JSON.parse(raw || '{}')
}

async function callMcp(fetchImpl, apiKey, tool, input, logger) {
  const response = await fetchImpl(MCP_URL, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: `supplier-risk-${randomUUID()}`, method: 'tools/call', params: { name: tool, arguments: input } }),
  })
  if (!response.ok) {
    logger?.info?.(`supplier risk: ${tool} gateway http ${response.status}`)
    return { ok: false, status: response.status === 401 || response.status === 403 ? 403 : 502, error: 'gateway_request_failed' }
  }
  const text = await response.text()
  let message
  for (const line of text.split(/\r?\n/u)) {
    if (!line.startsWith('data:')) continue
    try { message = JSON.parse(line.slice(5).trim()) } catch {}
  }
  if (!message) {
    try { message = JSON.parse(text) } catch { return { ok: false, error: 'invalid_gateway_response' } }
  }
  if (message.error || message.result?.isError) {
    const toolText = message.result?.content?.find(item => item.type === 'text')?.text
    return { ok: false, error: safeErrorCode(toolText || message.error?.message) }
  }
  const result = message.result || {}
  if (result.structuredContent && typeof result.structuredContent === 'object') return { ok: true, data: result.structuredContent }
  const content = result.content?.find(item => item.type === 'text')?.text
  try { return { ok: true, data: content ? JSON.parse(content) : result } } catch { return { ok: true, data: result } }
}

function safeErrorCode(value) {
  const match = String(value || '').match(/[A-Z][A-Z0-9_:-]{2,79}/u)
  return match?.[0] || 'supplier_mcp_request_failed'
}
