---
name: finance-monthly-risk
description: 对财务数据中心执行年度月度风险预判，覆盖预算超支、执行偏慢、资金缺口和数据质量风险。
---

# 月度风险预判

先调用 `sensteed_finance_bootstrap` 建立当前租户和操作者上下文，再调用 `mcp__finance__finance_analysis_brief` 获取口径基线，随后读取 `mcp__finance__finance_get_alerts` 与 `mcp__finance__finance_get_budget_summary`。

按预算超支、执行偏慢、资金缺口、数据质量四类输出风险清单。每项包含影响金额（元）、主体、期间、严重级别、证据、置信度和建议动作。先给结论，再给证据和行动清单。数据缺失或口径不足时明确标注，不补造金额。只读分析；任何录入、回填、审批或过账都先征得用户确认。
