/** Generated from the committed Tools plugin snapshot. Run node scripts/generate-tool-views.mjs. */
export const TOOL_CAPABILITY_VIEWS = [
  {
    "id": "tools-market-research",
    "kind": "business",
    "group": "research",
    "name": "行业与竞品调研",
    "description": "发现行业和竞品信息，结合网页证据生成结构化调研。",
    "servers": [
      "tools-platform",
      "tools-browser-intelligence"
    ]
  },
  {
    "id": "tools-public-social-research",
    "kind": "business",
    "group": "research",
    "name": "微信头条与西瓜公开资料",
    "description": "检索微信公开内容，读取公众号、视频号、头条与西瓜账号及内容资料；缓存未命中可能消耗采集额度。",
    "servers": [
      "tools-platform"
    ]
  },
  {
    "id": "tools-hotspot-discovery",
    "kind": "business",
    "group": "research",
    "name": "热点发现与事件跟踪",
    "description": "发现热点话题、读取事件详情，跟踪热点任务与进展。",
    "servers": [
      "tools-hotspot-discovery"
    ]
  },
  {
    "id": "tools-talent-discovery",
    "kind": "business",
    "group": "research",
    "name": "人才发现",
    "description": "按招聘需求发现人才，整理候选人信息与匹配线索。",
    "servers": [
      "tools-talent-discovery"
    ]
  },
  {
    "id": "tools-lead-discovery",
    "kind": "business",
    "group": "research",
    "name": "客户线索发现与监测",
    "description": "发现潜在客户，持续监测线索变化并读取跟进结果。",
    "servers": [
      "tools-lead-discovery",
      "tools-lead-monitor"
    ]
  },
  {
    "id": "tools-custom-car-monitoring",
    "kind": "business",
    "group": "research",
    "name": "汽车行业专项监测",
    "description": "跟踪汽车行业的指定对象与话题，汇总监测信息。",
    "servers": [
      "tools-custom-car-monitoring"
    ]
  },
  {
    "id": "tools-viral-video",
    "kind": "business",
    "group": "creation",
    "name": "热门视频分析",
    "description": "发现并分析热门视频，提炼选题与创作参考。",
    "servers": [
      "tools-viral-video"
    ]
  },
  {
    "id": "tools-social-operation",
    "kind": "business",
    "group": "collaboration",
    "name": "小红书与抖音运营",
    "description": "读取账号与内容信息，执行工具支持的运营任务；写入操作需确认。",
    "servers": [
      "tools-xhs-operation",
      "tools-douyin-operation"
    ]
  },
  {
    "id": "tools-tos-upload",
    "kind": "business",
    "group": "collaboration",
    "name": "文件上传与素材链接",
    "description": "上传本地文件，获取可供后续工具使用的素材链接。",
    "servers": [
      "tools-tos-upload"
    ]
  },
  {
    "id": "tools-supply-chain",
    "kind": "business",
    "group": "business",
    "name": "供应链数据检索",
    "description": "读取供应链工具提供的供应商与企业数据，核对已保存的台账和证据。",
    "servers": [
      "tools-supply-chain"
    ]
  }
] as const
