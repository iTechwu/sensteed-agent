---
name: finance-revenue-attainment
description: 对比年度计划收入和实际到账，归因未达成差额并评估资金平衡影响。
---

# 收入达成分析

先调用 `sensteed_finance_bootstrap`，再调用 `mcp__finance__finance_get_revenue_plans` 和 `mcp__finance__finance_get_cash_summary`。逐项对比计划收入、实际到账、差额和达成率，按延期、缩水、未回填或其他有证据的原因归因。

说明未达成收入对全年资金平衡和关键月份的影响，给出催收、回填和计划修正建议。区分事实、推断和待确认事项，金额使用元。不要代替催收确认、收入录入或审批。
