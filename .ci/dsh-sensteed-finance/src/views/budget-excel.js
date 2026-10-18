// 文件校验和幂等指纹由 Datasource 生成；客户端不解析或自行重建预算导入规则。
function financeBudgetExcelFile(file) {
  if (!file || !/\.xlsx$/i.test(file.name) || !file.size || file.size > 512 * 1024 || file.name.length > 200) throw new Error('请选择不超过 512 KB 的非空 .xlsx 文件，文件名最多 200 字')
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('文件读取失败，请重新选择'))
    reader.onload = () => resolve({ fileName: file.name, contentBase64: String(reader.result).split(',')[1] || '' })
    reader.readAsDataURL(file)
  })
}
function financeDownloadBudgetTemplate(data) {
  const bytes = Uint8Array.from(atob(data.contentBase64), char => char.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const link = document.createElement('a')
  link.href = url; link.download = data.fileName; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function BudgetFilingExcel({ card, costItems, onRefresh }) {
  const [file, setFile] = useState(null), [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const lock = useRef(false)
  const ready = !card.configurationRequired || (card.configurationImported && card.expenseMappings?.length > 0)
  const run = async action => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setMessage('')
    try { await action() } catch (cause) { setError(cause.message || '请求失败，请重试') }
    finally { lock.current = false; setBusy(false) }
  }
  const select = selected => run(async () => {
    setPreview(null); setFile(null)
    const body = await financeBudgetExcelFile(selected)
    const result = await financeRest(`/finance/budget-filing/${card.id}/excel/preview`, 'POST', body)
    setFile(body); setPreview(result.data)
  })
  const confirm = () => run(async () => {
    if (!ready || !file || !preview || preview.errors.length || !preview.rows.length) return
    const result = await financeRest(`/finance/budget-filing/${card.id}/excel/import`, 'POST', { ...file, previewFingerprint: preview.fingerprint })
    const notice = result.data.duplicate ? '该文件已经导入，本次未重复新增。' : `已追加 ${result.data.count} 条本人草稿，请在条目中提交初审。`
    setPreview(null); setFile(null); setMessage(notice); onRefresh(notice)
  })
  return h('section', { className: 'sf-inline-form sf-stack', 'aria-label': '预算 Excel 追加草稿' },
    h('p', null, '预算 Excel：整份校验后追加为本人草稿，不替换已有条目。最多 1000 行、512 KB。'),
    !ready ? h('p', { role: 'alert' }, '本部门费用配置尚未就绪，请联系财务维护。') : null,
    h('div', { className: 'sf-row' },
      h(GhostButton, { disabled: busy || !ready, onClick: () => run(async () => { const result = await financeRest(`/finance/budget-filing/${card.id}/excel/template`, 'POST', {}); financeDownloadBudgetTemplate(result.data) }) }, '下载预算 Excel 模板'),
      h(FormRow, { label: '选择预算 Excel 并预览' }, h('input', { type: 'file', accept: '.xlsx', 'aria-label': '选择预算 Excel 并预览', disabled: busy || !ready, onChange: event => { const chosen = event.target.files?.[0]; event.target.value = ''; if (chosen) void select(chosen) } }))),
    busy ? h('p', { role: 'status' }, '正在处理 Excel…') : null,
    error ? h('p', { role: 'alert', className: 'sf-neg' }, error) : null,
    message ? h('p', { role: 'status' }, message) : null,
    preview?.errors.length ? h('div', { role: 'alert' },
      h('p', null, `共 ${preview.errors.length} 行问题，整批未保存。请修正后重新上传。`),
      h('ul', { className: 'sf-budget-preview-errors' }, ...preview.errors.map(item => h('li', { key: item.row }, `第 ${item.row} 行：${item.message}`))))
      : preview ? h('div', { className: 'sf-stack' },
        h('p', null, `${file?.fileName} · ${preview.rows.length} 条 · 合计 ¥ ${budgetFilingMoney(preview.totalAmount)}`),
        h('div', { className: 'sf-budget-preview' }, h(Table, { tableId: `budget-excel-${card.id}`, rows: preview.rows, empty: '没有可追加的预算行', columns: [
          { key: 'costItemId', label: '费用科目及分类', render: row => { const mapping = card.expenseMappings?.find(item => item.code === row.expenseMappingCode); return mapping ? `${mapping.level2Name} · ${financeLabel(mapping.expenseType)}` : costItems.find(item => item.id === row.costItemId)?.name || row.costItemId } },
          { key: 'month', label: '月份', render: row => `${row.month}月` },
          { key: 'plannedAmount', label: '金额（元）', render: row => budgetFilingMoney(row.plannedAmount) },
          { key: 'description', label: '编制说明' },
        ] })),
        h('div', { className: 'sf-row' },
          h(PrimaryButton, { busy, disabled: !ready || !preview.rows.length, onClick: confirm }, `确认追加 ${preview.rows.length} 条本人草稿`),
          h(GhostButton, { disabled: busy, onClick: () => { setPreview(null); setFile(null) } }, '取消预览'))) : null)
}

function FilingExcelDraft({ assignmentId, disabled, onBusyChange, onApply }) {
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const lock = useRef(false)
  const run = async operation => {
    if (lock.current || disabled) return
    lock.current = true; setBusy(true); onBusyChange?.(true); setError('')
    try { await operation() } catch (cause) { setError(cause.message) }
    finally { lock.current = false; setBusy(false); onBusyChange?.(false) }
  }
  return h('section', { className: 'sf-stack', 'aria-label': '填报 Excel 导入' },
    h('p', { className: 'sf-note' }, 'Excel 先预览，再替换当前编辑内容；暂存或提交后才会保存，不直接写入正式数据。'),
    h('div', { className: 'sf-row' },
      h(GhostButton, { disabled: disabled || busy, onClick: () => run(async () => { const result = await financeRest(`/finance/filing/assignments/${assignmentId}/excel-template`, 'POST', {}); financeDownloadBudgetTemplate(result.data) }) }, '下载填报 Excel 模板'),
      h(FormRow, { label: '选择填报 Excel 并预览' }, h('input', { type: 'file', accept: '.xlsx', 'aria-label': '选择填报 Excel 并预览', disabled: disabled || busy, onChange: event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run(async () => { setPreview(null); const body = await financeBudgetExcelFile(file); const result = await financeRest(`/finance/filing/assignments/${assignmentId}/excel-preview`, 'POST', body); setPreview(result.data) }) } }))),
    error ? h('p', { role: 'alert' }, error) : null,
    preview ? h('div', { className: 'sf-stack' },
      h('p', null, `预览 ${preview.rows.length} 条 · 合计 ${formatNumber(preview.totalAmount)} 元`),
      ...(preview.errors || []).map(item => h('p', { key: item.row, role: 'alert' }, `第 ${item.row} 行：${item.message}`)),
      h(Table, { tableId: 'filing-excel-preview', rows: preview.rows.slice(0, 20), columns: financeColumns([['month', '月份'], ['plannedAmount', '金额（元）'], ['description', '编制说明']]), empty: '暂无可导入内容' }),
      preview.rows.length > 20 ? h('p', { className: 'sf-note' }, `当前预览前 20 条，确认后载入全部 ${preview.rows.length} 条。`) : null,
      h(PrimaryButton, { disabled: disabled || busy || !preview.rows.length || preview.errors.length > 0, onClick: () => { onApply(preview.rows); setPreview(null) } }, '确认替换当前编辑内容')) : null)
}
