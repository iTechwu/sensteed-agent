// Datasource 2027 年度配置录入：仅使用已导入的部门/费用映射，不能回退自由选科目。
function BudgetSaveReceipt({ line, onNavigate }) {
  if (!line?.id) return null
  return h('section', { className: 'sf-banner sf-banner-green sf-stack', role: 'status', 'aria-label': '预算保存回执' },
    h('strong', null, `预算行已保存并生效 · ${line.year} 年`),
    h('span', null, [line.orgName, line.departmentName, line.costItemName, line.month ? `${line.month}月` : '年度（不分月）', line.budgetAmount == null ? null : `${Number(line.budgetAmount).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元`].filter(Boolean).join(' · ')),
    h('span', null, `记录编号：${line.code || line.id}`),
    onNavigate ? h('div', { className: 'sf-row' },
      h(LinkButton, { onClick: () => onNavigate('budget', { view: 'lines', year: String(line.year), lineId: line.id }) }, '查看刚保存的预算行'),
      h(LinkButton, { onClick: () => onNavigate('budget', { view: 'lines', year: String(line.year) }) }, `查看 ${line.year} 年全部预算明细`)) : null)
}

function BudgetSavedRecordView({ ctx, t }) {
  const record = useFinanceResource(`/finance/budget/lines?year=${ctx.year}&lineId=${encodeURIComponent(ctx.drillParams.lineId)}&limit=1`, ctx.revision)
  return h('div', { className: 'sf-stack' },
    h(LinkButton, { onClick: () => ctx.onNavigate('budget', { view: 'lines', year: ctx.year }) }, `查看 ${ctx.year} 年全部预算明细`),
    h(FinanceResource, { resource: record },
      h(Card, { title: '刚保存的预算行' }, h(Table, { tableId: 'finance-saved-budget-line', rows: financeRows(record.data).filter(row => row.id === ctx.drillParams.lineId), empty: '未找到该记录或当前账号没有查看权限；请核对年度与记录编号。', columns: [
        ...financeColumns([['code', '记录编号'], ['orgName', '主体'], ['departmentName', '部门'], ['costItemName', '费用科目']]),
        { key: 'year', label: '年度', render: row => `${row.year}年` },
        { key: 'month', label: '月份', render: row => row.month ? `${row.month}月` : '年度（不分月）' },
        { key: 'budgetAmount', label: '预算金额（元）', render: row => Number(row.budgetAmount).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
        ...financeColumns([['note', '备注']]),
      ] }))))
}

// 所有年度仅使用草稿审核链；保留此组件名兼容已有入口。
function ConfiguredBudgetEntry({ year, onNavigate }) {
  return h('section', { className: 'sf-inline-form sf-stack', 'aria-label': '预算录入流程' },
    h('p', null, '财务代填保存为本人草稿，经过初审、终审、部门提交及财务确认后，进入预算版本。'),
    h('p', { className: 'sf-note' }, '在预算填报中选择年度、版本、活动和部门，经办人保留为当前录入人。已发布预算请通过预算调整流程变更。'),
    h('div', { className: 'sf-row' },
      h(LinkButton, { disabled: !onNavigate, onClick: () => onNavigate?.('budget-filing', { year: String(year) }) }, `前往 ${year} 年预算填报`),
      h(LinkButton, { disabled: !onNavigate, onClick: () => onNavigate?.('budget', { year: String(year), view: 'adjustments' }) }, '前往预算调整')))
}
