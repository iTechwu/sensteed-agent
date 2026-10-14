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

export const inject = ['tools', 'systemPrompt']
export const capabilities = Object.freeze([
  {
    "id": "supplier-intelligence",
    "kind": "business",
    "group": "business",
    "name": "供应商情报与风险",
    "description": "查询企业与供应商信息，采集舆情，分析关系与风险变化。"
  }
])

export function apply(ctx) {
  const disposers = []
  const canUseSupplier = scope => {
    const gate = typeof ctx.dofeAccess === 'function' ? ctx.dofeAccess() : undefined
    if (gate && (!gate.ready || !gate.enabledPlugins?.includes('supplier-intelligence'))) return false
    return (ctx.tools?.schemas?.(scope) || []).some(tool => /(?:mcp__supply-chain__|mcp__tools-supply-chain__)/u.test(tool.name || ''))
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
  return () => disposers.reverse().forEach(dispose => dispose?.())
}
