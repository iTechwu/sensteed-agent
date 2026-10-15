---
name: finance-cash-pressure
description: 评估年度月度资金压力，识别未来 1 至 3 个月资金缺口和头寸安排。
---

# 资金流压力评估

先调用 `sensteed_finance_bootstrap`，再读取 `mcp__finance__finance_get_cash_summary` 和 `mcp__finance__finance_get_payment_plans`。按月梳理期初余额、计划收入、计划支出、实际收支和预计余额，重点标出预计余额为负或骤降的月份。

输出未来 1 至 3 个月的缺口金额、形成原因、到期付款和头寸安排建议，并区分账面事实与预测。金额使用元，缺少收入或付款计划时降低置信度并列出补数项。只读分析，不能代替付款审批。
