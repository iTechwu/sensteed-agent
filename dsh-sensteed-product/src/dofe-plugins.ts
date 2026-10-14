/** Built-in DoFe capabilities shipped by each white-label product. */
import type { DofeAuthEntitlements } from './dofe-auth-contract.ts'

export const DOFE_ACCESS_SETTINGS_NAMESPACE = 'dofe-access' as const
// Tenant ownership is now part of authorization; previously accepted keys
// must re-enter the gate so they can be checked against the current brand.
// Existing installations must re-enter their key whenever the authorization
// contract changes; this prevents a credential accepted by an older build from
// silently keeping the application unlocked after a tenant/protocol upgrade.
export const DOFE_ACCESS_VALIDATION_VERSION = 5 as const
export type DofeBrandVariant = 'yootun' | 'sensteed'
export type DofePluginAccess = 'basic' | 'business'

export const DOFE_PLUGIN_CATALOG = [
  {
    id: 'tools',
    name: 'DoFe Tools',
    description: '商业调研与热点工具集',
    variants: ['yootun', 'sensteed'],
    servers: [
      'tools-platform', 'tools-supply-chain', 'tools-talent-discovery', 'tools-lead-discovery',
      'tools-lead-monitor', 'tools-hotspot-discovery', 'tools-custom-car-monitoring',
      'tools-viral-video', 'tools-browser-intelligence', 'tools-tos-upload',
      'tools-xhs-operation', 'tools-douyin-operation',
    ],
    access: 'business',
    builtIn: false,
  },
  {
    id: 'openmontage',
    name: 'OpenMontage',
    description: '视频生成与素材编排',
    variants: ['yootun', 'sensteed'],
    servers: ['openmontage'],
    access: 'basic',
    builtIn: false,
  },
  {
    id: 'media',
    name: 'Media 生成',
    description: '单张图片与 5–10 秒单镜头视频直连生成（复杂视频走 OpenMontage）',
    variants: ['yootun', 'sensteed'],
    servers: ['media'],
    access: 'basic',
    builtIn: false,
  },
  {
    id: 'opencli',
    name: 'OpenCLI Research',
    description: '受控的互联网只读调研',
    variants: ['yootun', 'sensteed'],
    servers: [],
    access: 'basic',
    builtIn: false,
  },
  {
    id: 'connect-im',
    name: 'Sensteed Agent Connect IM',
    description: '企业消息与协作连接',
    variants: ['sensteed'],
    servers: [],
    access: 'basic',
    builtIn: true,
  },
  {
    id: 'knowledge',
    name: '企业知识与 Memory',
    description: '知识库、Memory 与知识图谱治理',
    variants: ['yootun', 'sensteed'],
    servers: ['knowledge'],
    access: 'business',
    builtIn: false,
  },
  {
    id: 'finance',
    name: '财务管理',
    description: '预算/台账/资金/预警/数据治理看板与财务 MCP 数据面',
    variants: ['sensteed'],
    servers: ['finance'],
    access: 'business',
    builtIn: true,
  },
  {
    id: 'supplier-intelligence',
    name: '供应商情报',
    description: '供应商采集覆盖与舆情分析（企查查与社媒数据面）',
    variants: ['sensteed'],
    servers: ['supply-chain'],
    access: 'business',
    builtIn: true,
  },
] as const

export type DofePluginId = typeof DOFE_PLUGIN_CATALOG[number]['id']

/** Group by user task; access requirements remain separate from navigation. */
export const DOFE_CAPABILITY_GROUPS = ['research', 'creation', 'collaboration', 'business'] as const
export const DOFE_CAPABILITY_CATALOG = [
  { id: 'opencli-research', plugin: 'opencli', kind: 'basic', group: 'research', name: '互联网检索与网页阅读', description: '搜索公开信息、阅读网页、提取来源，整理可追溯的研究结论。' },
  { id: 'tools-market-research', plugin: 'tools', kind: 'business', group: 'research', name: '行业与竞品调研', description: '发现行业和竞品信息，结合网页证据生成结构化调研。' },
  { id: 'tools-hotspot-discovery', plugin: 'tools', kind: 'business', group: 'research', name: '热点发现与事件跟踪', description: '发现热点话题、读取事件详情，跟踪热点任务与进展。' },
  { id: 'tools-talent-discovery', plugin: 'tools', kind: 'business', group: 'research', name: '人才发现', description: '按招聘需求发现人才，整理候选人信息与匹配线索。' },
  { id: 'tools-lead-discovery', plugin: 'tools', kind: 'business', group: 'research', name: '客户线索发现与监测', description: '发现潜在客户，持续监测线索变化并读取跟进结果。' },
  { id: 'tools-custom-car-monitoring', plugin: 'tools', kind: 'business', group: 'research', name: '汽车行业专项监测', description: '跟踪汽车行业的指定对象与话题，汇总监测信息。' },
  { id: 'media-image-generation', plugin: 'media', kind: 'basic', group: 'creation', name: '图片生成', description: '根据文字生成图片，继续调整画面与风格。' },
  { id: 'media-video-generation', plugin: 'media', kind: 'basic', group: 'creation', name: '短视频生成', description: '生成 5–10 秒单镜头视频，快速验证创意。' },
  { id: 'openmontage-video-planning', plugin: 'openmontage', kind: 'basic', group: 'creation', name: '多镜头视频编排', description: '从脚本到分镜组织镜头、素材与视频制作任务。' },
  { id: 'openmontage-asset-finishing', plugin: 'openmontage', kind: 'basic', group: 'creation', name: '素材复刻与后期', description: '复刻参考素材，完成字幕、配音与成片提交。' },
  { id: 'tools-viral-video', plugin: 'tools', kind: 'business', group: 'creation', name: '热门视频分析', description: '发现并分析热门视频，提炼选题与创作参考。' },
  { id: 'tools-social-operation', plugin: 'tools', kind: 'business', group: 'collaboration', name: '小红书与抖音运营', description: '读取账号与内容信息，执行工具支持的运营任务；写入操作需确认。' },
  { id: 'tools-tos-upload', plugin: 'tools', kind: 'business', group: 'collaboration', name: '文件上传与素材链接', description: '上传本地文件，获取可供后续工具使用的素材链接。' },
  { id: 'connect-im', plugin: 'connect-im', kind: 'basic', group: 'collaboration', name: '企业消息与协作连接', description: '连接飞书、钉钉、企微、微信、QQ 与 Matrix 等消息渠道。' },
  { id: 'knowledge-memory', plugin: 'knowledge', kind: 'business', group: 'business', name: '企业知识与记忆', description: '检索知识库，管理长期记忆，维护知识图谱关系。' },
  { id: 'finance-management', plugin: 'finance', kind: 'business', group: 'business', name: '财务经营分析', description: '分析预算、台账、资金、经营预警与成本 BOM，查看数据治理看板。' },
  { id: 'supplier-intelligence', plugin: 'supplier-intelligence', kind: 'business', group: 'business', name: '供应商情报与风险', description: '查询企业与供应商信息，采集舆情，分析关系与风险变化。' },
] as const

export type DofeCapabilityId = typeof DOFE_CAPABILITY_CATALOG[number]['id']
export type DofeCapabilityKind = typeof DOFE_CAPABILITY_CATALOG[number]['kind']

export function dofePluginsForBrand(variant: DofeBrandVariant): typeof DOFE_PLUGIN_CATALOG[number][] {
  return DOFE_PLUGIN_CATALOG.filter(plugin => (plugin.variants as readonly DofeBrandVariant[]).includes(variant))
}

export function dofeCapabilitiesForBrand(variant: DofeBrandVariant): typeof DOFE_CAPABILITY_CATALOG[number][] {
  const plugins = new Set(dofePluginsForBrand(variant).map(plugin => plugin.id))
  return DOFE_CAPABILITY_CATALOG.filter(capability => plugins.has(capability.plugin))
}

export function dofePluginCanEnable(pluginId: string, variant: DofeBrandVariant, entitledPlugins?: readonly string[]): boolean {
  const plugin = dofePluginsForBrand(variant).find(candidate => candidate.id === pluginId)
  return plugin !== undefined && (variant !== 'sensteed' || plugin.access === 'basic' || entitledPlugins?.includes(pluginId) === true
    || pluginId === 'supplier-intelligence' && entitledPlugins?.includes('tools') === true)
}

export function normalizeDofeEnabledPluginIds(ids: readonly string[] | undefined, variant: DofeBrandVariant, entitledPlugins?: readonly string[]): DofePluginId[] {
  const requested = new Set(normalizeDofePluginIds(ids, variant))
  const required = dofePluginsForBrand(variant).filter(plugin => plugin.access === 'basic').map(plugin => plugin.id)
  return [...new Set([...required, ...requested])].filter(plugin => dofePluginCanEnable(plugin, variant, entitledPlugins))
}

/** Remove stale or cross-brand capability ids before they reach settings or MCP. */
export function normalizeDofePluginIds(ids: readonly string[] | undefined, variant: DofeBrandVariant): DofePluginId[] {
  const available = new Set<string>(dofePluginsForBrand(variant).map(plugin => plugin.id))
  return [...new Set((ids ?? []).filter((id): id is DofePluginId => available.has(id)))]
}

export interface DofeAccessSettings {
  /** The user has completed the mandatory DoFe access gate. */
  setupComplete: boolean
  /** Version of the Host-validated model_api_key gate. */
  validationVersion: number
  /** Built-in capabilities selected by the user. */
  enabledPlugins: string[]
  /** Model id selected from the validated DoFe catalog. */
  modelId: string
  /** Wire protocol used by the selected DoFe model route. */
  protocol: 'chat-completions' | 'messages' | 'responses'
  /** Identity provider selected by the branded onboarding flow. */
  authMode?: 'feishu' | 'manual'
  /** Non-secret SSO identity shown in settings and diagnostics. */
  identity?: { ssoSub: string; name: string; avatar?: string | null; groups?: string[]; groupNames?: Record<string, string> }
  entitlements?: DofeAuthEntitlements
}

export const DEFAULT_DOFE_PLUGIN_IDS: DofePluginId[] = DOFE_PLUGIN_CATALOG.map(plugin => plugin.id)
