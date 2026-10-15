---
name: finance-cost-structure
description: 拆解年度财务成本结构，识别费用集中度和异常漂移，并给出下季度成本建议。
---

# 成本结构分析

先调用 `sensteed_finance_bootstrap`，再调用 `mcp__finance__finance_analysis_brief` 与 `mcp__finance__finance_get_budget_summary`。按项目运营、固定运营、模型专项三类费用和主体维度拆解预算、PR、实际付款及占比。

指出占比异常漂移、单点集中度和预算与实际的主要差异，给出可执行的成本优化建议及下季度成本预判。说明外推方法、样本范围和假设，金额统一使用元。只读分析；不要把推算值写回财务数据中心。
