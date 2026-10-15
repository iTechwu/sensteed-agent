---
name: finance-budget-version-health
description: 检查预算主版本、调整稿和草稿推进状态，给出版本治理建议。
---

# 预算版本健康检查

先调用 `sensteed_finance_bootstrap`，再调用 `mcp__finance__finance_get_budget_versions`，用 `finance_budget_version_diff` 对比主版本与最新调整稿（主体和三类费用），并用 `finance_get_budget_summary` 对照实际执行。

识别未生效的已审定版本、超过 30 天未推进的草稿，以及主版本与实际执行的主要偏离。输出版本状态、差异金额、责任范围和推进建议（审定、生效、作废或重排）。只读检查，不擅自改变版本状态。
