// 片段 3/7：基础组件库（对齐前端视觉语言：去阴影卡片、outline 徽章、状态 pill、
// KPI 卡、行 hover 表格、pill 页签、分页器、居中 Dialog、Progress、统计卡）

function Glyph({ name, size = 16, className }) {
  const icons = {
    check: IconCheckOutlineRegular, warning: IconWarningOutlineRegular, close: IconCloseOutlineRegular,
    refresh: IconRefreshOutlineRegular, data: IconDataOutlineRegular, sparkle: IconSparkleRegular,
    goal: IconGoalOutlineRegular, clock: IconAlarmClockOutlineRegular, database: IconDatabaseOutlineRegular,
    loading: IconLoadingOutlineRegular, plan: IconPlanOutlineRegular, up: IconChevronUpOutlineRegular,
    down: IconChevronDownOutlineRegular, left: IconChevronLeftOutlineRegular, right: IconChevronRightOutlineRegular,
    plus: IconPlusOutlineRegular, trendUp: IconRightUpOutlineRegular, search: IconSearchOutlineRegular,
    send: IconSendOutlineRegular, shield: IconShieldOutlineRegular, trash: IconTrashOutlineRegular, user: IconUserOutlineRegular,
  }
  const Icon = icons[name]
  return Icon ? h(Icon, { size, className }) : null
}

/** 卡片：去阴影直角，标题行 border-b，金额卡注明单位 */
function Card({ title, unit, actions, children, className }) {
  return h('section', { className: `sf-card${className ? ` ${className}` : ''}` },
    title || actions ? h('div', { className: 'sf-card-head' },
      h('h2', null, title),
      unit ? h('span', { className: 'sf-card-unit' }, unit) : null,
      actions ? h('div', { className: 'sf-card-actions' }, actions) : null) : null,
    h('div', { className: 'sf-card-body' }, children))
}

/** KPI 卡：小标签 + 大数字 + 右上图标块 + 说明/涨跌行；onClick 时整卡可下钻 */
function KpiCard({ icon, label, value, hint, hintTone, onClick, negative }) {
  const clickable = typeof onClick === 'function'
  return h('article', {
    className: `sf-kpi${clickable ? ' is-clickable' : ''}${negative ? ' is-neg' : ''}`,
    onClick: clickable ? onClick : undefined,
    role: clickable ? 'link' : undefined, tabIndex: clickable ? 0 : undefined,
    onKeyDown: clickable ? event => { if (event.key === 'Enter') onClick() } : undefined,
  },
    h('div', { className: 'sf-kpi-top' }, h('span', { className: 'sf-kpi-label' }, label), h('span', { className: 'sf-kpi-icon' }, h(Glyph, { name: icon, size: 14 }))),
    h('strong', { className: 'sf-kpi-value' }, value ?? '—'),
    hint ? h('small', { className: `sf-kpi-hint${hintTone ? ` sf-hint-${hintTone}` : ''}` }, hint) : null)
}

/** outline 徽章：rose/amber/green/blue/sky/muted 语义色 */
function Badge({ tone = 'muted', children }) {
  return h('span', { className: `sf-badge sf-badge-${tone}` }, children)
}

/** 实心浅底 pill（状态列，对齐前端 bg-*-100/text-*-700 套路） */
function Pill({ tone = 'muted', children }) {
  return h('span', { className: `sf-pill sf-pill-${tone}` }, children)
}

function SeverityBadge({ severity, t }) {
  const key = SEVERITY_KEYS[severity] ?? 'sevInfo'
  return h(Pill, { tone: SEVERITY_TONES[severity] ?? 'sky' }, t(key))
}

/** 进度条（达成率/执行率）；ratio 0-1，tone: green/amber/rose */
function Progress({ value, tone }) {
  const parsed = finite(value)
  const clamped = parsed === null ? 0 : Math.max(0, Math.min(1, parsed))
  return h('div', { className: 'sf-progress' }, h('div', { className: `sf-progress-fill${tone ? ` is-${tone}` : ''}`, style: { width: `${clamped * 100}%` } }))
}

/**
 * BI 式表格：支持字段显隐、表头排序、行 hover 与行点击。
 * columns: { label, key?, sortKey?, sortValue?, render?(row), num?, stickyLeft?, width? }
 */
function Table({ columns, rows, empty, onRowClick, rowKey, minColumns, tableId }) {
  const storageKey = `dofe-finance-table:${tableId || columns.map(col => col.key || col.label).join('|')}`
  const columnIds = columns.map((col, index) => col.key || `column-${index}`)
  const columnSignature = columnIds.join('|')
  const [visibleIds, setVisibleIds] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null')
      return Array.isArray(saved) && saved.length ? saved.filter(id => columnIds.includes(id)) : columnIds
    } catch { return columnIds }
  })
  const sortStorageKey = `${storageKey}:sort`
  const [sort, setSort] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(sortStorageKey) || 'null')
      return saved && typeof saved.id === 'string' && (saved.direction === 'asc' || saved.direction === 'desc') ? saved : null
    } catch { return null }
  })
  useEffect(() => {
    setVisibleIds(current => {
      const next = current.filter(id => columnIds.includes(id))
      return next.length ? next : columnIds
    })
  }, [storageKey, columnSignature])
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(visibleIds)) } catch {}
  }, [storageKey, visibleIds])
  useEffect(() => {
    try {
      if (sort) localStorage.setItem(sortStorageKey, JSON.stringify(sort))
      else localStorage.removeItem(sortStorageKey)
    } catch {}
  }, [sortStorageKey, sort])

  const visibleColumns = columns
    .map((column, index) => ({ column, id: column.key || `column-${index}` }))
    .filter(({ id }) => visibleIds.includes(id))
  const activeSort = sort && columns.some((col, index) =>
    (col.key || `column-${index}`) === sort.id && col.sortable !== false && (col.sortKey || col.sortValue || col.key))
    ? sort
    : null
  const sortedRows = useMemo(() => {
    if (!activeSort) return rows || []
    const column = columns.find((col, index) => (col.key || `column-${index}`) === activeSort.id)
    if (!column) return rows || []
    const read = row => column.sortValue ? column.sortValue(row) : row[column.sortKey || column.key]
    return [...(rows || [])].sort((left, right) => {
      const leftValue = read(left)
      const rightValue = read(right)
      if (leftValue == null && rightValue == null) return 0
      if (leftValue == null) return 1
      if (rightValue == null) return -1
      const leftNumber = Number(leftValue)
      const rightNumber = Number(rightValue)
      const result = Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
        ? leftNumber - rightNumber
        : String(leftValue).localeCompare(String(rightValue), 'zh-CN', { numeric: true, sensitivity: 'base' })
      return activeSort.direction === 'desc' ? -result : result
    })
  }, [columns, rows, activeSort])

  const toggleSort = id => setSort(current => current?.id === id
    ? { id, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    : { id, direction: 'asc' })
  const fieldMenu = h('details', { className: 'sf-table-fields' },
    h('summary', { className: 'sf-table-tool' }, h(Glyph, { name: 'data', size: 13 }), '字段'),
    h('div', { className: 'sf-table-fields-menu' },
      h('strong', null, `显示字段（${visibleIds.length}/${columns.length}）`),
      h('span', { className: 'sf-table-fields-hint' }, '至少保留 1 个字段'),
      ...columns.map((col, index) => {
        const id = col.key || `column-${index}`
        const checked = visibleIds.includes(id)
        return h('label', { key: id, className: 'sf-table-field-option' },
          h('input', {
            type: 'checkbox', checked,
            disabled: checked && visibleIds.length === 1,
            onChange: () => setVisibleIds(current => checked ? current.filter(value => value !== id) : [...current, id]),
          }), h('span', null, col.label))
      }),
      h('button', { type: 'button', className: 'sf-link-button', onClick: () => setVisibleIds(columnIds) }, '恢复全部字段')))
  const headerCells = visibleColumns.map(({ column: col, id }) => {
    const sortable = col.sortable !== false && (col.sortKey || col.sortValue || col.key)
    const header = sortable
      ? h('button', { type: 'button', className: `sf-table-sort-button${activeSort?.id === id ? ' is-active' : ''}`, 'aria-label': `按${col.label}排序${activeSort?.id === id ? (activeSort.direction === 'asc' ? '，当前升序' : '，当前降序') : ''}`, onClick: () => toggleSort(id) }, col.label, h(Glyph, { name: activeSort?.id === id && activeSort.direction === 'desc' ? 'down' : 'up', size: 11 }))
      : col.label
    return h('th', { key: id, 'aria-sort': activeSort?.id === id ? (activeSort.direction === 'asc' ? 'ascending' : 'descending') : (sortable ? 'none' : undefined), className: `${col.num ? 'sf-num' : ''}${col.stickyLeft ? ' sf-sticky-col' : ''}`, style: col.width ? { width: col.width } : undefined }, header)
  })
  const bodyRows = sortedRows.map((row, rowIndex) => {
    const cells = visibleColumns.map(({ column: col, id }) => h('td', { key: id, className: `${col.num ? 'sf-num' : ''}${col.stickyLeft ? ' sf-sticky-col' : ''}` }, col.render ? col.render(row, rowIndex) : row[col.key] ?? '—'))
    return h('tr', { key: rowKey ? row[rowKey] ?? rowIndex : rowIndex, className: onRowClick ? 'is-clickable' : '', onClick: onRowClick ? () => onRowClick(row) : undefined }, ...cells)
  })
  return h('div', { className: 'sf-table-wrap' },
    h('div', { className: 'sf-table-toolbar' }, fieldMenu, activeSort ? h('span', { className: 'sf-table-sort-note' }, `当前页已按${columns.find((col, index) => (col.key || `column-${index}`) === activeSort.id)?.label || ''}${activeSort.direction === 'asc' ? '升序' : '降序'}`) : h('span', { className: 'sf-table-sort-note' }, '点击表头可排序'), activeSort ? h('button', { type: 'button', className: 'sf-link-button', onClick: () => setSort(null) }, '清除排序') : null),
    !rows?.length ? h('div', { className: 'sf-empty' }, empty) : h('div', { className: 'sf-table-scroll' }, h('table', { className: 'sf-table', style: minColumns ? { minWidth: minColumns } : undefined },
      h('thead', null, h('tr', null, ...headerCells)),
      h('tbody', null, ...bodyRows))))
}

/** 分页器：上一页/下一页 + 第 x 页（对齐前端 finance-pager） */
function Pager({ page, total, limit, onPage }) {
  const pages = Math.max(1, Math.ceil((total ?? 0) / (limit ?? PAGE_SIZE)))
  if (pages <= 1) return null
  return h('div', { className: 'sf-pager' },
    h('button', { type: 'button', disabled: page <= 1, onClick: () => onPage(page - 1) }, h(Glyph, { name: 'left', size: 12 })),
    h('span', null, `${page} / ${pages}`),
    h('button', { type: 'button', disabled: page >= pages, onClick: () => onPage(page + 1) }, h(Glyph, { name: 'right', size: 12 })))
}

/** pill 页签条（预算子视图/审批状态筛选；role=tablist 语义） */
function PillTabs({ tabs, value, onChange, t }) {
  return h('div', { className: 'sf-pilltabs', role: 'tablist' }, ...tabs.map(([id, labelKey]) =>
    h('button', { type: 'button', key: id, role: 'tab', 'aria-selected': value === id, className: value === id ? 'is-active' : '', onClick: () => onChange(id) }, t(labelKey))))
}

function FormRow({ label, children, wide }) {
  return h('label', { className: `sf-form-row${wide ? ' is-wide' : ''}` }, h('span', null, label), children)
}

function Field(props) {
  const { value, onChange, ...rest } = props
  return h('input', { ...rest, value: value ?? '', onChange: event => onChange(event.target.value) })
}

function Textarea(props) {
  const { value, onChange, ...rest } = props
  return h('textarea', { ...rest, value: value ?? '', onChange: event => onChange(event.target.value) })
}

function Select({ value, onChange, options, placeholder, disabled, ...rest }) {
  const props = { ...rest, disabled, onChange: event => onChange?.(event.target.value) }
  if (value !== undefined) props.value = value
  return h('select', props,
    placeholder ? h('option', { value: '' }, placeholder) : null,
    ...options.map(([id, label]) => h('option', { key: id, value: id }, label)))
}

function SearchSelect({ value, onChange, options = [], placeholder, disabled, allowCustom = false, customLabel = '使用当前输入值', ...rest }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [selection, setSelection] = useState(value ?? '')
  const rootRef = useRef(null)
  const inputRef = useRef(null)
  const chosen = value === undefined ? selection : value
  const selectedLabel = options.find(([id]) => id === chosen)?.[1] ?? (allowCustom && chosen ? String(chosen) : '')
  const displayValue = query || selectedLabel
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredOptions = options.filter(([, label]) => !normalizedQuery || String(label).toLocaleLowerCase().includes(normalizedQuery))
  const exactMatch = options.find(([, label]) => String(label) === query)
  const menuId = `sf-search-menu-${String(rest.name || placeholder).replace(/[^a-z0-9_-]/gi, '-')}`

  useEffect(() => {
    const handleOutsidePointerDown = event => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', handleOutsidePointerDown)
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown)
  }, [])

  const selectOption = (id, label) => {
    setSelection(id)
    setQuery(String(label))
    setOpen(false)
    onChange?.(id)
    inputRef.current?.setCustomValidity('')
  }

  const selectCustom = () => {
    const next = query.trim()
    if (!next) return
    setSelection(next)
    setQuery(next)
    setOpen(false)
    onChange?.(next)
    inputRef.current?.setCustomValidity('')
  }

  const clearSelection = () => {
    setSelection('')
    setQuery('')
    setOpen(false)
    onChange?.('')
    inputRef.current?.setCustomValidity('')
  }

  return h('div', { ref: rootRef, className: 'sf-search-select' },
    h('div', { className: 'sf-search-input-wrap' },
      h('input', { ...rest, ref: inputRef, name: undefined, type: 'search', value: displayValue, disabled, 'aria-label': `搜索${placeholder}`, placeholder: `搜索${placeholder}`, 'aria-expanded': open, 'aria-controls': menuId, 'aria-invalid': Boolean(query && !exactMatch && chosen !== query), onFocus: () => {
        setOpen(true)
        if (selectedLabel) {
          setQuery('')
          requestAnimationFrame(() => inputRef.current?.select())
        }
      }, onKeyDown: event => {
        if (event.key === 'Escape') {
          setOpen(false)
          event.currentTarget.blur()
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          setOpen(true)
          event.preventDefault()
          requestAnimationFrame(() => {
            const optionsInMenu = rootRef.current?.querySelectorAll('.sf-search-option')
            const option = event.key === 'ArrowUp' ? optionsInMenu?.[optionsInMenu.length - 1] : optionsInMenu?.[0]
            option?.focus()
          })
        }
      }, onChange: event => {
        const next = event.target.value
        setQuery(next)
        setOpen(true)
        const exact = options.find(([, label]) => String(label) === next)
        event.target.setCustomValidity(next && !exact ? '请选择列表中的选项，或确认自定义值' : '')
        if (exact) { setSelection(exact[0]); onChange?.(exact[0]); setQuery(String(exact[1])) }
        else { setSelection(''); onChange?.('') }
      }}),
      chosen && !disabled ? h('button', { type: 'button', className: 'sf-search-clear', onClick: clearSelection, 'aria-label': `清除${placeholder}` }, '×') : null),
    h('div', { className: 'sf-search-menu', id: menuId, role: 'listbox', hidden: !open },
      filteredOptions.length ? filteredOptions.map(([id, label]) => h('button', {
        key: id, type: 'button', role: 'option', 'aria-selected': String(id) === String(chosen), className: 'sf-search-option' + (String(id) === String(chosen) ? ' is-selected' : ''),
        onMouseDown: event => event.preventDefault(), onClick: () => selectOption(id, label),
      }, h('span', null, label), String(id) === String(chosen) ? h(Glyph, { name: 'check', size: 13 }) : null)) : h('p', { className: 'sf-search-empty' }, '没有匹配的选项'),
      allowCustom && query.trim() && !exactMatch ? h('button', {
        type: 'button', className: 'sf-search-custom', onMouseDown: event => event.preventDefault(), onClick: selectCustom,
      }, customLabel, `“${query.trim()}”`) : null),
    h('input', { type: 'hidden', name: rest.name, value: chosen }))
}

function MultiSearchSelect({ value = [], onChange, options = [], placeholder = '选项', disabled }) {
  const [query, setQuery] = useState('')
  const selectedIds = new Set(value)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredOptions = options.filter(([id, label]) => {
    if (!normalizedQuery) return true
    return String(label).toLocaleLowerCase().includes(normalizedQuery) || String(id).toLocaleLowerCase().includes(normalizedQuery)
  })
  const selectedOptions = options.filter(([id]) => selectedIds.has(id))
  const toggle = id => {
    const next = selectedIds.has(id)
      ? value.filter(current => current !== id)
      : [...value, id]
    onChange?.(next)
  }
  return h('div', { className: 'sf-multi-search-select' },
    h('div', { className: 'sf-multi-search-input' },
      h('input', {
        type: 'search', value: query, disabled,
        placeholder: '搜索' + placeholder,
        'aria-label': '搜索' + placeholder,
        onChange: event => setQuery(event.target.value),
      }),
      query ? h('button', { type: 'button', className: 'sf-multi-clear', disabled, onClick: () => setQuery(''), 'aria-label': '清除搜索' }, '×') : null),
    h('div', { className: 'sf-multi-summary', 'aria-live': 'polite' },
      h('span', null, '已选 ' + selectedOptions.length + ' / ' + options.length),
      selectedOptions.slice(0, 6).map(([id, label]) => h('button', {
        key: id, type: 'button', className: 'sf-multi-chip', disabled,
        onClick: () => toggle(id), 'aria-label': '移除' + label,
      }, label, ' ×')),
      selectedOptions.length > 6 ? h('span', { className: 'sf-multi-more' }, '另有 ' + (selectedOptions.length - 6) + ' 个') : null),
    h('div', { className: 'sf-multi-options', role: 'listbox', 'aria-multiselectable': true, 'aria-label': placeholder },
      filteredOptions.length ? filteredOptions.map(([id, label]) => h('button', {
        key: id, type: 'button', role: 'option', 'aria-selected': selectedIds.has(id),
        className: 'sf-multi-option' + (selectedIds.has(id) ? ' is-selected' : ''), disabled,
        onClick: () => toggle(id),
      }, h('span', { className: 'sf-multi-check', 'aria-hidden': true }, selectedIds.has(id) ? '✓' : ''), h('span', null, label)))
        : h('p', { className: 'sf-note' }, '没有匹配的部门')))
}

function CustomizableTextSelect({ name, options = [], placeholder, required }) {
  const customValue = '__custom__'
  const [value, setValue] = useState('')
  return h('div', { className: 'sf-custom-select' },
    h('select', { name: `${name}Choice`, value, required, onChange: event => setValue(event.target.value) },
      h('option', { value: '' }, placeholder),
      ...options.map(option => h('option', { key: option, value: option }, option)),
      h('option', { value: customValue }, '自定义值…')),
    value === customValue ? h(Field, { name: `${name}Custom`, required, placeholder: '仅本次记录使用' }) : null)
}

function Switch({ checked, onChange, label }) {
  return h('button', { type: 'button', className: `sf-switch${checked ? ' is-on' : ''}`, role: 'switch', 'aria-checked': checked, 'aria-label': label, onClick: () => onChange(!checked) },
    h('span', { className: 'sf-switch-knob' }))
}

/** 居中 Dialog：遮罩 + Escape 关闭 + 焦点移入；宽档 sm/md/lg */
function Dialog({ title, width = 'md', onClose, children, footer }) {
  useEffect(() => {
    const key = event => { if (event.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  const panelRef = useRef(null)
  useEffect(() => { requestAnimationFrame(() => panelRef.current?.focus?.()) }, [])
  return h('div', { className: 'sf-dialog-mask', onMouseDown: event => { if (event.target === event.currentTarget) onClose?.() } },
    h('div', { className: `sf-dialog sf-dialog-${width}`, role: 'dialog', 'aria-modal': true, 'aria-label': title, ref: panelRef, tabIndex: -1 },
      h('header', { className: 'sf-dialog-head' }, h('h3', null, title),
        h('button', { type: 'button', className: 'sf-icon-button', 'aria-label': 'close', onClick: onClose }, h(Glyph, { name: 'close', size: 14 }))),
      h('div', { className: 'sf-dialog-body' }, children),
      footer ? h('footer', { className: 'sf-dialog-foot' }, footer) : null))
}

/** 通知行 */
function Notice({ children, tone }) {
  return children ? h('p', { className: `sf-notice${tone ? ` sf-notice-${tone}` : ''}` }, children) : null
}

/** 主按钮 */
function PrimaryButton({ children, busy, ...rest }) {
  return h('button', { type: 'button', className: 'sf-btn sf-btn-primary', disabled: busy, ...rest }, children)
}
function GhostButton({ children, ...rest }) {
  return h('button', { type: 'button', className: 'sf-btn sf-btn-ghost', ...rest }, children)
}
function LinkButton({ children, ...rest }) {
  return h('button', { type: 'button', className: 'sf-link', ...rest }, children)
}

function LimitNote({ rows, limit, t }) {
  return rows?.length >= limit ? h('p', { className: 'sf-note' }, t('showFirst').replace('{n}', String(limit))) : null
}

function EmptyState({ children }) {
  return h('div', { className: 'sf-empty' }, children)
}

/**
 * 多系列分组柱图（纯 SVG）。
 * series: [{ key, label, tone('a'|'b'|'c') }]; data: [{ label, [seriesKey]: number|null }]
 * onBarClick(point) 可选：点柱下钻。
 */
function GroupedBars({ data, series, onBarClick }) {
  const points = (data || []).filter(Boolean)
  const hasAny = points.some(point => series.some(s => finite(point[s.key]) !== null))
  if (!points.length || !hasAny) return h('div', { className: 'sf-empty' }, '—')
  const width = 760, height = 210, left = 52, right = 12, top = 14, bottom = 28
  const max = Math.max(...points.flatMap(point => series.map(s => Math.abs(finite(point[s.key]) ?? 0))), 1)
  const plotBottom = height - bottom
  const band = (width - left - right) / points.length
  const barWidth = Math.max(4, Math.min(16, band / (series.length + 1)))
  const y = value => top + (plotBottom - top) * (1 - value / max)
  const labelEvery = Math.max(1, Math.ceil(points.length / 12))
  return h('div', { className: 'sf-chart-wrap' },
    h('div', { className: 'sf-chart-legend' }, ...series.map(s => h('span', { key: s.key }, h('i', { className: `sf-legend sf-legend-${s.tone}` }), s.label))),
    h('svg', { className: 'sf-chart', viewBox: `0 0 ${width} ${height}`, role: 'img' },
      ...[0, 0.5, 1].map((step, index) => h('line', { key: index, x1: left, x2: width - right, y1: y(max * step), y2: y(max * step), className: 'sf-grid-line' })),
      ...points.map((point, index) => {
        const center = left + band * index + band / 2
        const groupWidth = barWidth * series.length + 2 * (series.length - 1)
        const clickable = typeof onBarClick === 'function'
        return h('g', {
          key: point.label, className: clickable ? 'sf-bar-group is-clickable' : 'sf-bar-group',
          onClick: clickable ? () => onBarClick(point) : undefined,
        },
          ...series.map((s, sIndex) => {
            const value = finite(point[s.key])
            if (value === null) return null
            const x = center - groupWidth / 2 + sIndex * (barWidth + 2)
            return h('rect', { key: s.key, x, y: y(value), width: barWidth, height: Math.max(0, plotBottom - y(value)), className: `sf-bar sf-bar-${s.tone}` })
          }),
          index % labelEvery === 0 || index === points.length - 1 ? h('text', { x: center, y: height - 8, className: 'sf-chart-label', textAnchor: 'middle' }, point.label) : null)
      })))
}

/** 差异瀑布（预算 → 已打PR → 未打PR → 实际付款 → 差额），纯 CSS 柱 */
function Waterfall({ steps }) {
  const valid = steps.filter(step => finite(step.value) !== null)
  if (!valid.length) return h('div', { className: 'sf-empty' }, '—')
  const max = Math.max(...valid.map(step => Math.abs(finite(step.value))), 1)
  return h('div', { className: 'sf-waterfall' }, ...valid.map((step, index) => {
    const value = finite(step.value)
    const heightPct = Math.max(4, (Math.abs(value) / max) * 100)
    return h('div', { key: index, className: 'sf-waterfall-item' },
      h('div', { className: 'sf-waterfall-bar-area' },
        h('div', { className: `sf-waterfall-bar${step.tone ? ` is-${step.tone}` : ''}`, style: { height: `${heightPct}%` } })),
      h('span', { className: 'sf-waterfall-label' }, step.label),
      h('span', { className: 'sf-waterfall-value' }, wan(value)))
  }))
}

/** 占比条堆叠（费用构成）：segments [{label, value, tone}] */
function StackedShare({ segments }) {
  const total = segments.reduce((acc, s) => acc + (finite(s.value) ?? 0), 0)
  if (!total) return h('div', { className: 'sf-empty' }, '—')
  return h('div', { className: 'sf-share' },
    h('div', { className: 'sf-share-track' }, ...segments.map((s, index) => {
      const value = finite(s.value) ?? 0
      if (value <= 0) return null
      return h('div', { key: index, className: `sf-share-seg is-${s.tone || 'a'}`, style: { width: `${(value / total) * 100}%` } })
    })),
    h('div', { className: 'sf-share-legend' }, ...segments.map((s, index) =>
      h('span', { key: index }, h('i', { className: `sf-legend sf-legend-${s.tone || 'a'}` }), `${s.label} ${Math.round(((finite(s.value) ?? 0) / total) * 100)}%`))))
}

/** 正负对称条形（收支净额）：data [{label, value}]，零轴居中 */
function NetBars({ data }) {
  const points = (data || []).filter(point => finite(point.value) !== null)
  if (!points.length) return h('div', { className: 'sf-empty' }, '—')
  const max = Math.max(...points.map(point => Math.abs(finite(point.value))), 1)
  return h('div', { className: 'sf-netbars' }, ...points.map((point, index) => {
    const value = finite(point.value)
    const pct = (Math.abs(value) / max) * 50
    return h('div', { key: index, className: 'sf-netbar-row' },
      h('span', { className: 'sf-netbar-label' }, point.label),
      h('div', { className: 'sf-netbar-track' },
        h('div', { className: 'sf-netbar-half is-left' }, value < 0 ? h('div', { className: 'sf-netbar-bar is-rose', style: { width: `${pct}%` } }) : null),
        h('div', { className: 'sf-netbar-zero' }),
        h('div', { className: 'sf-netbar-half is-right' }, value >= 0 ? h('div', { className: 'sf-netbar-bar is-green', style: { width: `${pct}%` } }) : null)),
      h('span', { className: `sf-netbar-value${value < 0 ? ' sf-neg' : ' sf-pos'}` }, wan(value)))
  }))
}

/** 可点击统计卡（预警中心 4 卡）：激活时 ring 高亮 */
function StatCard({ label, value, tone, active, onClick }) {
  const clickable = typeof onClick === 'function'
  return h('button', {
    type: 'button', className: `sf-stat sf-stat-${tone}${active ? ' is-active' : ''}${clickable ? ' is-clickable' : ''}`,
    onClick: clickable ? onClick : undefined,
  }, h('strong', null, value ?? 0), h('span', null, label))
}
