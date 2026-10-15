---
name: finance-data-quality
description: 评估财务数据质量问题对分析结论的影响，并安排补数和修复优先级。
---

# 数据质量影响评估

先调用 `sensteed_finance_bootstrap`，再调用 `mcp__finance__finance_get_data_quality`、`mcp__finance__finance_get_import_batches` 和 `mcp__finance__finance_get_alerts`（优先筛选 `DATA_QUALITY` 类型）。

列出问题、涉及数据集、数量级、来源批次和影响期间，逐项说明哪些风险、预算或资金结论可能失真。按影响范围、严重度和修复成本给出补数与修复优先级。没有证据的影响不要推断为确定事实；只读检查，不直接修改数据。
