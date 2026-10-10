import type { DofePluginId } from './dofe-plugins.ts'
import { KNOWLEDGE_ROUTING_PROMPT } from './knowledge-routing.ts'

/** Describe this turn's authorized tools, including scoped restrictions and disconnects. */
export function managedCapabilitiesPrompt(input: {
  ready: boolean
  enabled: ReadonlySet<DofePluginId>
  financeAllowed: boolean
  toolNames: readonly string[]
}): string {
  const rules = [
    '能力介绍规则：只介绍本轮已授权且实际可调用的能力。插件目录、历史对话和产品说明不代表当前用户权限。',
    '未授权、未启用或未加载的能力不要列为自己具备的能力，也不要主动展示其名称。工具报错时说明该能力暂时不可用，不得声称操作成功。',
    '介绍能力时覆盖下列已核实的能力，用用户能理解的业务语言；具体动作仍以本轮工具及参数为准，不能从只读工具推断写入权限。',
  ]
  if (!input.ready) return [...rules, '当前未就绪，不能宣称具备任何托管业务能力。'].join('\n')
  const has = (prefix: string) => input.toolNames.some(name => name.startsWith(prefix))
  const available = (id: DofePluginId, prefix: string) => input.enabled.has(id) && has(prefix)
  const knowledgeWrapper = available('knowledge', 'knowledge_')
  if (knowledgeWrapper || available('knowledge', 'mcp__knowledge__')) {
    rules.push('企业知识与记忆：按当前用户和空间权限检索知识、处理记忆；仅介绍实际工具支持的读写动作。')
    // The management plugin owns the wrapped tool argument/routing contract.
    if (!knowledgeWrapper) rules.push(KNOWLEDGE_ROUTING_PROMPT)
  }
  if (available('tools', 'mcp__tools-')) rules.push('商业调研与热点分析：仅限当前已加载的商业工具。')
  if (available('media', 'mcp__media__')) rules.push('图片与短视频：通过 Media 工具生成单张图片、5–10 秒单镜头视频；如本轮仅有查询工具，只介绍查询能力。')
  if (available('openmontage', 'mcp__openmontage__')) rules.push('视频制作：通过 OpenMontage 工具完成脚本、多镜头编排、素材复刻、字幕与配音；如本轮仅有查询工具，只介绍查询能力。')
  if (input.financeAllowed && has('mcp__finance__')) rules.push('财务管理：已通过财务工作区权限检查，可使用本轮已加载的财务工具。')
  rules.push('其他能力也必须以本轮实际可调用的工具为依据。不要索取或展示用户密钥。')
  return rules.join('\n')
}
