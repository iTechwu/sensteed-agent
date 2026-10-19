// 对齐 Datasource assistant-answer.ts 的确定性计算；修改规则须同步两端。
function financeQuestionIntent(value) {
  if (/超预算|超支|预算/.test(value)) return 'budget'
  if (/资金|现金|缺口|余额|收入|支出|收支|达成/.test(value)) return 'cash'
  if (/质量|缺失|异常数据/.test(value)) return 'quality'
  return 'unknown'
}
function financeAssistantMoney(value) {
  if (value == null) return '—'
  return `${value < 0 ? '-' : ''}¥${Math.abs(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`
}
function financeAssistantUrl(path, params) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]))
  return `${path}?${query}`
}
function financeInlineAnswer(text, { year, orgId, budget, cash, quality }) {
  const money = financeAssistantMoney
  const financeUrl = financeAssistantUrl
  const EXPENSE_TYPE_LABELS = { PROJECT_OPERATION: '项目运营成本', FIXED_OPERATION: '固定运营成本', MODEL_SPECIFIC: '车型专属成本', NON_PROJECT: '非项目类' }
  const budgetRows = budget?.list ?? [];
  const cashRows = cash?.list ?? [];
  if (/超预算|超支|预算/.test(text)) {
    const href = financeUrl('/budget', { view: 'lines', year, org: orgId });
    if (budget?.budgetVersionId == null || budgetRows.length === 0) {
      return {
        title: '暂无可用于判断的预算数据',
        body: '当前年度和主体范围内没有已发布预算或预算明细，无法判断是否超支。请先核对预算版本与筛选范围。',
        evidence: [],
        sources: [],
        href,
      };
    }
    const overruns = budgetRows
      .filter((row) => row.prSubmittedAmount > row.budgetAmount && row.prSubmittedAmount > 0)
      .map((row) => ({ ...row, over: row.prSubmittedAmount - row.budgetAmount }))
      .sort((a, b) => b.over - a.over);
    const total = overruns.reduce((sum, row) => sum + row.over, 0);
    return {
      title:
        overruns.length > 0
          ? `发现 ${overruns.length} 个预算分组超支`
          : '已检查的预算分组未发现超支',
      body:
        overruns.length > 0
          ? `按“已打 PR > 预算”规则核算，合计超出 ${money(total)}。以下为超支金额最高的项目。`
          : '仅比较预算行已回填的 PR 与预算金额；独立 PR 台账尚未分配或回填的金额不在本次判断范围内。',
      evidence: overruns
        .slice(0, 5)
        .map(
          (row) =>
            `${row.orgName ?? '未分配'} · ${row.month ? `${row.month}月` : '年度'} · ${row.expenseType ? (EXPENSE_TYPE_LABELS[row.expenseType] ?? row.expenseType) : '未分类'}：超出 ${money(row.over)}`,
        ),
      sources: ['年度预算主版本', '预算行已打 PR 金额'],
      href,
    };
  }

  if (/资金|现金|缺口|余额/.test(text)) {
    const known = cashRows.flatMap((row) =>
      row.projectedBalance == null ? [] : [{ ...row, projectedBalance: row.projectedBalance }],
    );
    const missing = cashRows.length - known.length;
    const gaps = known
      .filter((row) => row.projectedBalance < 0)
      .sort((a, b) => a.projectedBalance - b.projectedBalance);
    return {
      title:
        known.length === 0
          ? '余额数据不足，无法判断资金缺口'
          : gaps.length > 0
            ? `发现 ${gaps.length} 个负余额期间`
            : missing > 0
              ? '部分期间余额缺失，暂不能排除资金缺口'
              : '已检查期间未发现预计余额为负',
      body:
        known.length === 0
          ? '当前范围没有可用的预计余额。收支净额不等于账户余额，请先补齐期初余额与预计余额。'
          : `已检查 ${known.length} 条预计余额，另有 ${missing} 条缺失。${gaps.length > 0 ? '请核对负余额期间的收入到账时间与付款节奏。' : '结论仅覆盖有预计余额的记录。'}`,
      evidence: gaps
        .slice(0, 5)
        .map(
          (row) =>
            `${row.orgName ?? '未分配'} · ${row.month}月：预计余额 ${money(row.projectedBalance)}`,
        ),
      sources: ['资金汇总表预计余额'],
      href: financeUrl('/cash', { tab: 'summary', year, org: orgId }),
    };
  }

  if (/收入|支出|收支|达成/.test(text)) {
    const href = financeUrl('/cash', { tab: 'summary', year, org: orgId });
    if (
      cashRows.length === 0 ||
      cashRows.every(
        (row) =>
          row.plannedIncome == null &&
          row.actualIncome == null &&
          row.plannedExpense == null &&
          row.actualExpense == null,
      )
    ) {
      return {
        title: '暂无可用于分析的收支数据',
        body: '当前年度和主体范围内尚无收支记录，不能将缺失数据解释为零收入或零支出。',
        evidence: [],
        sources: [],
        href,
      };
    }
    const missing = cashRows.some(
      (row) =>
        row.plannedIncome == null ||
        row.actualIncome == null ||
        row.plannedExpense == null ||
        row.actualExpense == null,
    );
    const plannedIncome = cashRows.reduce((sum, row) => sum + (row.plannedIncome ?? 0), 0);
    const actualIncome = cashRows.reduce((sum, row) => sum + (row.actualIncome ?? 0), 0);
    const plannedExpense = cashRows.reduce((sum, row) => sum + (row.plannedExpense ?? 0), 0);
    const actualExpense = cashRows.reduce((sum, row) => sum + (row.actualExpense ?? 0), 0);
    return {
      title: `${year} 年收支执行概览`,
      body: missing
        ? '部分收支字段缺失；以下仅汇总已提供金额，暂不计算达成率或净流入。'
        : '达成率仅在计划金额大于 0 时计算；计划和实际分别汇总。',
      evidence: [
        `收入：计划 ${money(cashRows.some((row) => row.plannedIncome != null) ? plannedIncome : null)}，实际 ${money(cashRows.some((row) => row.actualIncome != null) ? actualIncome : null)}，达成率 ${missing ? '数据不完整' : plannedIncome > 0 ? `${((actualIncome / plannedIncome) * 100).toFixed(1)}%` : '无计划口径'}`,
        `支出：计划 ${money(cashRows.some((row) => row.plannedExpense != null) ? plannedExpense : null)}，实际 ${money(cashRows.some((row) => row.actualExpense != null) ? actualExpense : null)}，执行率 ${missing ? '数据不完整' : plannedExpense > 0 ? `${((actualExpense / plannedExpense) * 100).toFixed(1)}%` : '无计划口径'}`,
        `实际净流入：${missing ? '数据不完整，暂不计算' : money(actualIncome - actualExpense)}`,
      ],
      sources: ['资金汇总表计划值', '资金汇总表实际值'],
      href,
    };
  }

  if (/质量|缺失|异常数据/.test(text)) {
    const issues = quality?.issues ?? [];
    const affected = issues.reduce((sum, issue) => sum + issue.count, 0);
    return {
      title: affected > 0 ? `数据质量检查发现 ${affected} 项问题记录` : '数据质量检查未发现问题',
      body: '质量检查覆盖当前团队全部年度和主体，不受上方筛选影响。同一行可能命中多条规则，问题数量不是去重后的行数。',
      evidence: issues
        .filter((issue) => issue.count > 0)
        .map((issue) => `${issue.label}：${issue.count} 行（${issue.severity}）`)
        .slice(0, 8),
      sources: ['数据质量检查清单'],
      href: '/data-center',
    };
  }

  return {
    title: '当前问题缺少可验证的数据口径',
    body: '目前可可靠回答预算超支、收支达成、资金缺口和数据质量问题。利润归因等问题需要接入收入成本与归因模型后才能回答。',
    evidence: [],
    sources: [],
  };
}
