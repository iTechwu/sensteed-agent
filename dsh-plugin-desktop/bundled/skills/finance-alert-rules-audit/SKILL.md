---
name: finance-alert-rules-audit
description: 核查财务预警规则集的生效状态、默认阈值和近 30 天告警量。
---

# 预警规则核查

先调用 `sensteed_finance_bootstrap`，再调用 `mcp__finance__finance_get_alert_rules` 查看 `activeVersion` 和各版本阈值。如果规则集没有生效版本，说明内置默认阈值和确认生效的必要性；如果已生效，再用 `finance_get_alert_summary` 抽查近 30 天告警量与阈值预期的一致性。

输出规则状态、关键阈值、告警数量、异常解释和建议动作。不得把“建议确认”直接执行成规则变更；任何确认生效操作都需用户明确授权。
