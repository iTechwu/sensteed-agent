/** Presentation entries share their owning package's authorization and installation. */
import { dofePluginsForBrand, type DofeBrandVariant, type DofePluginId } from './dofe-plugins.ts'

import { TOOL_CAPABILITY_VIEWS } from './generated-tool-views.ts'

export const PLUGIN_PRESENTATION_GROUPS = [
  { id: 'research', label: '检索与调研' },
  { id: 'creation', label: '内容分析' },
  { id: 'collaboration', label: '运营与素材' },
  { id: 'business', label: '供应链与企业' },
  { id: 'plugins', label: '业务与创作插件' },
] as const

type Group = typeof PLUGIN_PRESENTATION_GROUPS[number]['id']
type Plugin = ReturnType<typeof dofePluginsForBrand>[number]
export interface PluginPresentation {
  key: string
  group: Group
  plugin: { id: DofePluginId; name: string; description: string; servers: readonly string[]; access: 'basic' | 'business'; builtIn: boolean; ownerName?: string }
}
export function pluginPresentations(brand: DofeBrandVariant): PluginPresentation[] {
  return dofePluginsForBrand(brand).flatMap((plugin: Plugin): PluginPresentation[] => plugin.id !== 'tools'
    ? [{ key: plugin.id, group: 'plugins', plugin }]
    : TOOL_CAPABILITY_VIEWS.map(item => ({
      key: item.id, group: item.group, plugin: { ...plugin, ownerName: plugin.name, name: item.name, description: item.description, servers: item.servers },
    })))
}
