---
name: sensteed-supplier-intelligence
description: 归集供应商企查查与社交媒体数据，复核全量覆盖缺口，并基于数据库证据生成可审计的整体舆情 Markdown 报告。适用于供应商尽调、覆盖补采、子公司监控和舆情汇总。
---

# 供应商全量归集与舆情分析

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
