export const name = 'tools-guidance'
export const inject = ['systemPrompt', 'hubMcp']
export const capabilities = Object.freeze([
  {
    "id": "tools-market-research",
    "kind": "business",
    "group": "research",
    "name": "行业与竞品调研",
    "description": "发现行业和竞品信息，结合网页证据生成结构化调研。"
  },
  {
    "id": "tools-public-social-research",
    "kind": "business",
    "group": "research",
    "name": "微信头条与西瓜公开资料",
    "description": "检索微信公开内容，读取公众号、视频号、头条与西瓜账号及内容资料；缓存未命中可能消耗采集额度。"
  },
  {
    "id": "tools-hotspot-discovery",
    "kind": "business",
    "group": "research",
    "name": "热点发现与事件跟踪",
    "description": "发现热点话题、读取事件详情，跟踪热点任务与进展。"
  },
  {
    "id": "tools-talent-discovery",
    "kind": "business",
    "group": "research",
    "name": "人才发现",
    "description": "按招聘需求发现人才，整理候选人信息与匹配线索。"
  },
  {
    "id": "tools-lead-discovery",
    "kind": "business",
    "group": "research",
    "name": "客户线索发现与监测",
    "description": "发现潜在客户，持续监测线索变化并读取跟进结果。"
  },
  {
    "id": "tools-custom-car-monitoring",
    "kind": "business",
    "group": "research",
    "name": "汽车行业专项监测",
    "description": "跟踪汽车行业的指定对象与话题，汇总监测信息。"
  },
  {
    "id": "tools-viral-video",
    "kind": "business",
    "group": "creation",
    "name": "热门视频分析",
    "description": "发现并分析热门视频，提炼选题与创作参考。"
  },
  {
    "id": "tools-social-operation",
    "kind": "business",
    "group": "collaboration",
    "name": "小红书与抖音运营",
    "description": "读取账号与内容信息，执行工具支持的运营任务；写入操作需确认。"
  },
  {
    "id": "tools-tos-upload",
    "kind": "business",
    "group": "collaboration",
    "name": "文件上传与素材链接",
    "description": "上传本地文件，获取可供后续工具使用的素材链接。"
  }
])

export function apply(ctx) {
  if (!ctx.hubMcp?.register) throw new Error('HUB_MCP_SERVICE_REQUIRED')
  const registrations = ['platform', 'supply-chain', 'talent-discovery', 'lead-discovery', 'lead-monitor', 'hotspot-discovery', 'custom-car-monitoring', 'viral-video', 'browser-intelligence', 'xhs-operation', 'douyin-operation', 'tos-upload'].map(path => ctx.hubMcp.register({ capability: 'tools', serverName: `tools-${path}`, path: `tools/${path}`, timeoutMs: 60000 }))
  const guidance = ctx.systemPrompt.section({
    name: 'tools:guidance',
    order: 7,
    text: '企业调研使用 mcp__tools-platform__* 做能力发现，使用 mcp__tools-hotspot-discovery__* 做热点运行与事件读取，必要时使用 mcp__tools-browser-intelligence__* 补充网页证据。需要公网文件 URL 时先调 mcp__tools-tos-upload__tos_upload_authorize 取预签名 PUT URL，再用 Bash 按原始字节直传。先 preview/读取再运行；任何 Tools 写操作必须带 confirm=true 和稳定 idempotencyKey，不确定响应必须读取回执对账。 微信/公众号/视频号/头条/西瓜公开资料先调用 mcp__tools-platform__getoneapi_social_capabilities_get 获取目录、参数与 workflows；可用 getoneapi_social_read_prepare 零成本校验，再用 getoneapi_social_read 单页读取。缓存未命中可能计费，保留来源、retrievedAt、observedAt、cacheHit、charged、externalCallMade；不自动重试或翻页，不猜测账号标识或续页游标。遇到 ONEAPI_DEADLINE_EXCEEDED 或 ONEAPI_BUDGET_EXHAUSTED 时停止本次外部读取，报告稳定错误码；不得改参数、换接口或切换直连来自动重放。相同请求并发成功时由服务端复用缓存，但网络未知结果不保证只计费一次。头条/西瓜没有目录内关键词搜索接口；读取结果是临时研究资料，不自动成为供应商、人才、线索或改装案例。长文用 dataPointer/textOffset 分段读取同一缓存，短期视频 URL/decode_key 不作为永久素材链接。供应商正式入库使用经授权来源的 supply_chain_social_monitoring_collect，微信来源 platform=wechat-search，confirm=true 并使用稳定 idempotencyKey；普通业务列表仍只读数据库。',
  })
  return async () => { guidance?.(); await Promise.all(registrations.map(r => r.dispose())) }
}
