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

export const DOFE_CAPABILITY_CATALOG = [
  { id: 'opencli-research', plugin: 'opencli', kind: 'basic', name: '互联网检索与资料整理', description: '受控读取公开网页，提炼来源与研究结论。' },
  { id: 'media-image-generation', plugin: 'media', kind: 'basic', name: '图片生成', description: '根据文字描述生成单张图片，并可继续迭代画面。' },
  { id: 'media-video-generation', plugin: 'media', kind: 'basic', name: '短视频生成', description: '生成 5–10 秒单镜头视频，适合快速验证创意。' },
  { id: 'openmontage-video-planning', plugin: 'openmontage', kind: 'basic', name: '多镜头视频编排', description: '从脚本到分镜，组织复杂视频的镜头与素材。' },
  { id: 'openmontage-asset-finishing', plugin: 'openmontage', kind: 'basic', name: '素材复刻与后期', description: '完成素材复刻、字幕、配音和成片提交。' },
  { id: 'connect-im', plugin: 'connect-im', kind: 'basic', name: '企业消息与协作连接', description: '连接微信、飞书、企微、钉钉、QQ 与 Matrix 等企业消息渠道。' },
  { id: 'tools-market-research', plugin: 'tools', kind: 'business', name: '商业调研与热点分析', description: '围绕行业、竞品和热点事件形成结构化调研。' },
  { id: 'knowledge-memory', plugin: 'knowledge', kind: 'business', name: '企业知识与 Memory', description: '检索企业知识，管理记忆，并维护知识图谱关系。' },
  { id: 'finance-management', plugin: 'finance', kind: 'business', name: '财务经营分析', description: '预算、台账、资金、预警和数据治理看板。' },
  { id: 'supplier-intelligence', plugin: 'supplier-intelligence', kind: 'business', name: '供应商情报与风险', description: '采集供应商情报，分析舆情并跟踪风险变化。' },
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
  return plugin !== undefined && (variant !== 'sensteed' || plugin.access === 'basic' || entitledPlugins?.includes(pluginId) === true)
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
