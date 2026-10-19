---
name: sensteed-supplier-intelligence
description: 归集供应商企查查与社交媒体数据，复核全量覆盖缺口，并基于数据库证据生成可审计的整体舆情 Markdown 报告。适用于供应商尽调、覆盖补采、子公司监控和舆情汇总。
---

# 供应商全量归集与舆情分析

## 工作台与业务判断

Sensteed 默认插件提供“供应商风险”主内容区：风险总览、供应商台账、工商与司法证据、媒体舆情、业务影响和每周风险报告。工作台读取 `supply_chain_workbench_overview_get`、`supply_chain_workbench_suppliers_list`、`supply_chain_workbench_evidence_list`、`supply_chain_business_context_get` 与 `supply_chain_weekly_reports_list` 等已持久化视图；这些读取不会发起外部采集。

- 面向用户解释风险时，分开引用已确认事实、待核验线索、团队录入的业务背景和 Agent 推断。媒体候选不等于企业事实。
- 业务影响判断通过 `supply_chain_business_analysis_save` 持久化，必须关联当前业务背景版本和证据版本；版本冲突或证据变化时先重新读取再分析，不覆盖旧结论。
- 周报只呈现服务端已保存快照。不要声称页面读取会刷新工商/媒体数据，也不要将预算记录描述为已执行采集。
- 新供应商导入只回报新增、重复数以及经服务端脱敏的行号和稳定错误码；绝不在 Agent 摘要中复述整份 CSV 或原始导入异常。
- 用户要求扩大监控或启动外部采集时，先说明目标供应商、来源和额度影响，等待明确确认；已提交任务用原 `runId` 轮询，不重复提交。

通过 `mcp__supply-chain__*` 工具工作。开始时调用 `sensteed_supplier_intelligence_bootstrap` 和 `supply_chain_capabilities_get`，确认当前工具目录；不要把客户端、Cookie、API Key、租户或用户标识作为工具参数。

## 企业主体检索

当用户给出公司名称、简称、品牌名或股票简称，但供应商台账中尚无对应记录时，直接调用 `supply_chain_qcc_company_search({query})`。该工具独立于供应商主数据，使用 QCC `company.get_company_by_query`，按标准化关键词走 30 分钟数据库优先缓存；缓存未命中可能消耗 QCC 额度。

- 先把所有候选及其统一社会信用代码、状态等返回字段完整展示。唯一精确匹配也要向用户说明命中依据；多候选时必须等待用户明确选择，禁止默认选第一条或把相似名称当同一主体。
- 无匹配时检查名称/关键词后再询问是否重试，不要改用 `knowledge_search` 代替企业登记检索。
- 此工具只检索并缓存实体候选，不创建供应商、不自动启动其他 QCC 付费 capability。用户确认主体后，再按授权流程建档/核验，之后使用 `supply_chain_qcc_company_data_get` 获取工商等详情。
- 返回的候选是识别线索，不是已核验的供应商事实；保留 `metadata` 中的来源、检索时间、缓存命中和外部调用状态。

## 数据归集

1. 对用户明确指定但未必在台账中的企业，先按“企业主体检索”执行；只有全量供应商覆盖分析才分页调用 `supply_chain_suppliers_list`，并按 `verificationStatus` 区分已核验和待核验主体。不要把历史固定数量写成当前事实。
2. 对每家供应商先调用 `supply_chain_qcc_company_data_list` 读取本地企查查缓存。需要补充或刷新时，先用 `supply_chain_qcc_capabilities_get` 选择 Server、capability 和 `agentArgumentsSchema`，再调用 `supply_chain_qcc_company_data_get`。该调用自行执行 30 分钟数据库优先缓存；禁止传 `searchKey` 或凭据，禁止自动重试。
3. 优先覆盖 `company`、`risk`、`ipr`、`operation`、`history`、`executive` 六个 Server 中已编目的能力。目录标为 `entitlement_required` 的能力要作为权益缺口输出，不能伪装为可用。
4. 使用 `supply_chain_relationships_list` 读取子公司/投资企业。只有关系已审核、已核验且已生效时，才可扩展社媒监控范围；候选关系只作为待审核证据。
5. 社媒归集只能对已核验供应商执行。调用 `supply_chain_social_monitoring_collect` 时使用已批准来源、`confirm=true` 和稳定 `idempotencyKey`；轮询超时后继续查询原 `runId`，不得换幂等键重复提交。

遇到 `QCC_MCP_UNAVAILABLE`、认证/账号/余额错误、`ONEAPI_BUDGET_EXHAUSTED` 或环境不可用时，立即停止对应外部采集分支，保留已完成数据并报告稳定错误码。代码或参数错误可修正后继续剩余项；不得用直接 Provider 请求绕过 MCP、缓存、预算或入库流程。

## 微信、头条与西瓜公开资料

- 供应商正式采集支持 `wechat-search` 来源：先发现 `supply_chain_getone_social_source_authorize` 并按用户授权登记来源，再对已核验供应商运行 `supply_chain_social_monitoring_collect`。固定搜索公众号文章，使用已批准来源、`confirm=true` 与稳定幂等键；不要替用户自动授权或扩大采集范围。
- 跨平台临时研究由 Tools 插件的 `mcp__tools-platform__getoneapi_social_capabilities_get` 发现五组目录及 workflows，`getoneapi_social_read_prepare` 本地验证参数，`getoneapi_social_read` 显式读取单页/详情。若该工具未出现在当前会话目录，报告工具未启用，不直连 Provider。
- 头条/西瓜目录提供已知账号和内容读取，没有关键词搜索。视频号需服务端目录要求的真实账号/作品标识，不猜测 ID。公众号文章详情可以补充临时分析引用，但不会自动写入供应商证据表。
- 目录/prepare 不产生外部调用；read 缓存未命中可能计费。保留来源、原 `retrievedAt`、本次 `observedAt`、`cacheHit`、`charged`、`externalCallMade`。不自动重试或翻页；长文按 `dataPointer`/`textOffset` 继续读缓存。短期媒体地址和 `decode_key` 不能描述为永久发布链接。

## 舆情分析

对每家供应商调用 `supply_chain_intelligence_report_get`，只使用已持久化的证据、告警和已审核关系。将社媒命中分为正向、中性、混合、负向或证据不足，并同时给出证据数量、来源、时间范围与核验状态。

- 候选命中、关键词标签和未经人工确认的风险事件不能写成企业事实。
- 没有命中只能表述为当前数据库覆盖内未发现，不能表述为没有风险。
- 缓存读取保留原 `retrievedAt`；本次分析时间使用 `observedAt`。输出 `dataSource`、`upstreamSource`、`cacheHit` 和 `externalCallMade`。
- 企查查风险扫描的聚合计数按原值引用，不跨维度自行加总，也不在未下钻明细前下定性结论。

## Markdown 输出

输出一个完整 Markdown 文档，至少包含：执行摘要、数据覆盖、企查查覆盖、社媒覆盖、整体舆情、重点负向/混合项、全部供应商明细、子公司关系、缺口与阻断、审计元数据。明细必须展示供应商名称、核验状态、数据源、最近检索时间、情感判断、证据引用和缺口。

报告应明确区分三类内容：已确认事实、候选证据、数据缺口。只读分析本身标记 `dataSource=database`、`externalCallMade=false`；若本轮执行过补采，在执行摘要中单独列出对应调用及缓存/计费状态。

需要核对详细工具语义与停止条件时，读取 [references/workflow.md](references/workflow.md)。
