export const name = 'tools-guidance'
export const inject = ['systemPrompt', 'hubMcp']
export const capabilities = Object.freeze([
  {
    "id": "tools-business-discovery",
    "kind": "business",
    "group": "business",
    "name": "业务能力分类与契约发现",
    "description": "按业务目标发现类别、服务与工具，核对参数、费用和可用条件；目录读取不触发采集或模型。"
  },
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
  },
  {
    "id": "tools-supply-chain",
    "kind": "business",
    "group": "business",
    "name": "供应链数据检索",
    "description": "读取供应链工具提供的供应商与企业数据，核对已保存的台账和证据。"
  }
])

export function apply(ctx) {
  if (!ctx.hubMcp?.register) throw new Error('HUB_MCP_SERVICE_REQUIRED')
  const registrations = ['platform', 'supply-chain', 'talent-discovery', 'lead-discovery', 'lead-monitor', 'hotspot-discovery', 'custom-car-monitoring', 'viral-video', 'browser-intelligence', 'xhs-operation', 'douyin-operation', 'tos-upload'].map(path => ctx.hubMcp.register({ capability: 'tools', serverName: `tools-${path}`, path: `tools/${path}`, timeoutMs: 60000 }))
  const guidance = ctx.systemPrompt.section({
    name: 'tools:guidance',
    order: 7,
    text: '通用业务任务先调 mcp__tools-platform__business_service_categories_list 浏览 8 个业务分类（categoryId），选定服务组（serviceId）后用 business_tools_search 按 query、categoryId、serviceId、operationKind 与政策过滤；先从 facets 读取支持的维度和值，再按 domain、dataSourcePolicy、modelUsage、businessPersistence、controlPersistence、executionMode、policyReview、outputContractStatus 取交集，最后用 business_tool_contract_get 读取所选工具的实际输入 schema、政策与可用条件。已有事实查询优先传 externalCallsAllowed=false、chargeAllowed=false；如需只查库且不调模型/不写业务状态，组合 dataSourcePolicy=database、modelUsage=never、businessPersistence=none，禁止审计/回执/计划绑定写入时另加 controlPersistence=none；查异步模型分析入口可组合 modelUsage=possible、executionMode=async，结果读取工具仍单独按真实政策选择。facets 统计全部条件命中集而非当前页，空结果不自动放宽限制。旧目录的输入 schema 尚无新筛选参数时只使用其已声明参数；只读不自动表示免费，unknown 政策不能当作零成本，false 过滤会排除 unknown 而不是放行。目录只说明注册与源码条件，不能据此宣称部署健康、设备已连接或付费执行可用。endpointRef 只由已注册的公共网关连接解析：xhs_operation 对应 tools-xhs-operation，douyin_operation 对应 tools-douyin-operation；video-processing 与 media.upload/sources/transcripts/frames/jobs 属视频笔记插件的既有连接，本插件未激活时如实告知缺少接入，不能拼内部地址。找不到目录工具时回退 tools/list 与已存在领域目录，不猜参数或自动执行。工具名称、分类、schema、费用及工作流以 Tools 服务端实时目录为准，客户端不维护第二套工具清单。企业调研用 mcp__tools-platform__* 做能力发现，mcp__tools-hotspot-discovery__* 读热点运行与事件，必要时用 mcp__tools-browser-intelligence__* 补网页证据。需要公网文件 URL 时先调 mcp__tools-tos-upload__tos_upload_authorize 取预签名 PUT URL，再用 Bash 按原始字节直传。先 preview/读取再运行；确认、幂等、版本校验与个人身份按各工具实际契约执行；只在 schema 支持时传 confirm/idempotencyKey，不给普通读取添写参数。不确定响应继续读取原 runId/jobId 或回执，不换幂等键重提。微信/公众号/视频号/头条/西瓜公开资料先调 mcp__tools-platform__getoneapi_social_capabilities_get 取目录、参数与 workflows；getoneapi_social_read_prepare 零成本校验，getoneapi_social_read 单页读取。缓存未命中可能计费，保留来源、retrievedAt、observedAt、cacheHit、charged、externalCallMade；不自动重试或翻页，不猜账号标识或续页游标。ONEAPI_DEADLINE_EXCEEDED 或 ONEAPI_BUDGET_EXHAUSTED 时停止本次外部读取并报告稳定错误码；不改参数、换接口或直连自动重放。相同请求并发成功由服务端复用缓存，网络未知结果不保证只计费一次。头条/西瓜无目录内关键词搜索接口；读取结果是临时研究资料，不自动成为供应商、人才、线索或改装案例。长文用 dataPointer/textOffset 分段读同一缓存，短期视频 URL/decode_key 不作永久素材链接。供应商正式入库用经授权来源的 supply_chain_social_monitoring_collect，微信来源 platform=wechat-search，confirm=true 并用稳定 idempotencyKey；正式客户线索先查目录内正式线索池的只读能力，不拿发现候选冒充事实池。人才后续操作沿用服务返回的 collectionRef，不猜内部 taskId。公共供应商事实与个人/团队业务状态保持各自作用域；客户端不传租户或身份覆盖服务端上下文。',
  })
  return async () => { guidance?.(); await Promise.all(registrations.map(r => r.dispose())) }
}
