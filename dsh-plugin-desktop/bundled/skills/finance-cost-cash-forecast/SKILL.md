---
name: finance-cost-cash-forecast
description: 用近期付款和收入节奏预测未来成本、支出与月末资金余额，并标注置信度。
---

# 成本与资金预判

先调用 `sensteed_finance_bootstrap` 和 `mcp__finance__finance_analysis_brief`，再读取近 3 个月实际付款、已打 PR 未付款部分和收入计划到账节奏。按月外推未来支出和月末资金余额区间。

明确说明样本窗口、计算方法、假设和不确定性；把高置信和低置信结论分开，指出敏感变量和需要补充的数据。金额使用元。预测只用于分析，不写回预算或资金计划。
