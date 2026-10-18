---
name: finance-budget-review
description: 复盘年度预算执行率、实际支付率和主体偏离原因，输出预算调整建议。
---

# 预算执行复盘

先调用 `sensteed_finance_bootstrap`，再调用 `mcp__finance__finance_get_budget_summary` 与 `mcp__finance__finance_get_budget_lines`。按主体计算执行率（已打 PR 除以预算）和实际支付率（实际付款除以预算），并按执行率排序。预计 PR 独立展示，不计入执行率；预算为零或缺失时标注比率不可计算，不填造百分比。

将偏离归因为录入滞后、计划变更、预算虚高或其他有证据的原因，列出关键预算行、金额和期间，最后给出预算调整建议。金额使用元；不要把建议直接变成调整单或过账操作。
