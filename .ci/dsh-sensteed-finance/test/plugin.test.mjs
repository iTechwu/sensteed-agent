import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const planMonths = new Function(await readFile(new URL('src/navigation.js', root), 'utf8') + '\nreturn financePlanMonths')()

function clientHarness(source, componentName, overrides = {}) {
  const state = []
  const effects = []
  let cursor = 0
  let effectCursor = 0
  let pending = []
  const useState = initial => {
    const index = cursor++
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
    return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
  }
  const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(Boolean) })
  const dependencies = {
    h, useState, useCallback: callback => callback,
    useRef: initial => useState(() => ({ current: initial }))[0],
    useId: () => useState(() => 'selector-' + Math.random())[0],
    useMemo: compute => compute(),
    useEffect: (effect, values) => {
      const index = effectCursor++
      if (!effects[index] || values.some((value, offset) => value !== effects[index].values[offset])) {
        pending.push(() => {
          effects[index]?.cleanup?.()
          effects[index] = { values, cleanup: effect() }
        })
      }
    },
    document: { addEventListener() {}, removeEventListener() {} },
    window: { innerWidth: 1024, innerHeight: 768, addEventListener() {}, removeEventListener() {} },
    requestAnimationFrame: callback => callback(),
    financePlanMonths: planMonths,
    yearOptions: () => [['2026', '2026']],
    budgetVersionLabel: version => version.name,
    PLAN_TYPES: [], EXPENSE_TYPES: [], ConfiguredBudgetEntry() {}, BudgetSaveReceipt() {},
    ...overrides,
  }
  const component = new Function(...Object.keys(dependencies), source + '\nreturn ' + componentName)(...Object.values(dependencies))
  return {
    render(props) { cursor = 0; effectCursor = 0; pending = []; return component(props) },
    flushEffects() { pending.forEach(effect => effect()); pending = [] },
  }
}

function clientNodes(node) {
  if (!node || typeof node !== 'object') return []
  return [node, ...(node?.children || []).flatMap(clientNodes)]
}

test('selector popups stay within the viewport and reposition on resize without leaking listeners', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8')
  const listeners = new Map()
  const viewport = {
    innerWidth: 1024, innerHeight: 768,
    addEventListener: (event, handler) => listeners.set(event, handler),
    removeEventListener: (event, handler) => { if (listeners.get(event) === handler) listeners.delete(event) },
  }
  let rect = { left: 950, top: 620, bottom: 656, width: 400 }
  const anchor = { current: { getBoundingClientRect: () => rect } }
  const harness = clientHarness(source + '\nfunction PopupHarness({ open, anchor }) { return useFinancePopupPosition(open, anchor) }', 'PopupHarness', { window: viewport })
  harness.render({ open: true, anchor })
  harness.flushEffects()
  let style = harness.render({ open: true, anchor })
  assert.equal(style.position, 'fixed')
  assert.equal(style.left, 616)
  assert.equal(style.width, 400)
  assert.equal(style.top, 'auto')
  assert.equal(style.bottom, 152)
  viewport.innerWidth = 390
  rect = { left: 300, top: 80, bottom: 112, width: 180 }
  listeners.get('resize')()
  style = harness.render({ open: true, anchor })
  assert.equal(style.left, 102)
  assert.equal(style.width, 280)
  assert.equal(style.top, 116)
  assert.equal(style.bottom, 'auto')
  harness.render({ open: false, anchor })
  harness.flushEffects()
  assert.equal(listeners.size, 0)
})

test('matrix and detail tables expose sortable raw values for formatted finance columns', async () => {
  const files = ['src/format.js', 'src/components.js', 'src/workflows.js', 'src/views/budget.js', 'src/views/cash.js']
  const source = (await Promise.all(files.map(file => readFile(new URL(file, root), 'utf8')))).join('\n')
  const budgetRow = { id: 'line-1', orgName: '主体一', month: 1, expenseType: 'FIXED_OPERATION', budgetAmount: 10000, prSubmittedAmount: 2000, prEstimatedAmount: 500, paidAmount: 1000 }
  const cases = [
    ['MatrixView', { budget: { summary: { list: [budgetRow] } }, onCell() {} }, 'total.budget', 10000],
    ['LinesView', { budget: { lines: { list: [budgetRow] } }, page: 1, onPage() {} }, 'budgetAmount', 10000],
    ['CashSummaryTable', { rows: [{ id: 'cash-1', year: 2026, orgName: '主体一', month: 1, projectedBalance: 3000 }] }, 'projectedBalance', 3000],
    ['PlansTab', { rows: [{ id: 'plan-1', plannedAmount: 12000, actualAmount: 2000 }], page: 1, onPage() {} }, 'plannedAmount', 12000],
    ['RevenueTab', { revenues: { list: [{ plannedAmount: 100, actualAmount: 80, varianceAmount: -20 }] }, page: 1, onPage() {} }, 'varianceAmount', -20],
  ]
  const tableIds = new Set()
  for (const [component, props, field, expected] of cases) {
    const harness = clientHarness(source, component, { EXPENSE_LABELS: {}, PAGE_SIZE: 30, BUDGET_LINE_LIMIT: 100 })
    const tree = harness.render({ ...props, t: key => key })
    const table = clientNodes(tree).find(node => node.type?.name === 'Table')
    assert.ok(table.props.tableId, component)
    assert.equal(tableIds.has(table.props.tableId), false)
    tableIds.add(table.props.tableId)
    assert.equal(new Set(table.props.columns.map(column => column.key)).size, table.props.columns.length, component)
    for (const column of table.props.columns) {
      assert.ok(column.key, component + ':' + column.label)
      if (column.key === 'actions') assert.equal(column.sortable, false)
    }
    const column = table.props.columns.find(column => column.key === field)
    const row = table.props.rows[0]
    assert.equal(column.sortValue ? column.sortValue(row) : row[column.key], expected, component)
    if (component === 'MatrixView') assert.match(row[table.props.columns[0].key], /主体一/)
    if (component === 'CashSummaryTable') assert.equal(row[table.props.columns[0].key], '主体一')
  }
})

test('finance enum codes are translated at every user-facing selector and data-center table', async () => {
  const files = ['src/head.js', 'src/workflows.js', 'src/views/budget.js', 'src/views/cash.js', 'src/views/datacenter.js']
  const source = (await Promise.all(files.map(file => readFile(new URL(file, root), 'utf8')))).join('\n')
  assert.match(source, /bizSystem:\s*'业务系统'/)
  assert.match(source, /docType:\s*'单据类型'/)
  assert.match(source, /options: EXPENSE_TYPES\.map\(\(\[id, label\]\) => \[id, t\(label\)\]\)/)
  assert.match(source, /options: PLAN_TYPES\.map\(\(\[id, label\]\) => \[id, t\(label\)\]\)/)
  assert.match(source, /financeLabel\(row\.bizSystem\)/)
  assert.match(source, /financeLabel\(row\.docType\)/)
  assert.match(source, /FINANCE_PLAN:\s*'财务计划'/)
  assert.match(source, /FEISHU_RAW_SNAPSHOT:\s*'飞书原始快照'/)
})


test('filing saves selected cost IDs before submission and preserves rows on failure', async () => {
  const components = await readFile(new URL('src/components.js', root), 'utf8')
  const entry = await readFile(new URL('src/views/entry.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/members.js', root), 'utf8')
  const assignment = {
    id: 'assignment-1', status: 'PENDING', task: { status: 'OPEN', month: 10 },
    rows: [{ costItemId: 'cost-1', month: 10, plannedAmount: 123.45, description: '十月费用' }],
  }
  let closed = false
  const calls = []
  const harness = clientHarness(components + '\n' + entry, 'AssignmentDialog')
  const props = { assignment, busy: false, t: key => key, onClose: () => { closed = true }, act: async (path, body) => { calls.push({ path, body }); return false } }
  let tree = harness.render(props)
  await tree.props.footer.find(button => button?.props.key === 'submit').props.onClick()
  assert.equal(closed, false)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, '/filing-assignments/assignment-1/rows')
  assert.equal(calls[0].body.rows[0].costItemId, 'cost-1')
  tree = harness.render(props)
  assert.ok(clientNodes(tree).some(node => node.props.role === 'alert' && node.children.includes('保存失败，填写内容已保留，请重试')))
  calls.length = 0
  tree = harness.render({ ...props, act: async (path, body) => { calls.push({ path, body }); return true } })
  await tree.props.footer.find(button => button?.props.key === 'submit').props.onClick()
  assert.equal(closed, true)
  assert.deepEqual(calls.map(call => call.path), ['/filing-assignments/assignment-1/rows', '/filing-assignments/assignment-1/submit'])
})

test('filing validates missing dimensions and keeps locked or closed assignments read-only', async () => {
  const components = await readFile(new URL('src/components.js', root), 'utf8')
  const entry = await readFile(new URL('src/views/entry.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/members.js', root), 'utf8')
  let writes = 0
  const props = {
    assignment: { id: 'assignment-1', status: 'DRAFT', task: { status: 'OPEN' }, rows: [{ month: 10, plannedAmount: 123 }] },
    busy: false, t: key => key, onClose() {}, act: async () => { writes++; return true },
  }
  const harness = clientHarness(components + '\n' + entry, 'AssignmentDialog')
  let tree = harness.render(props)
  await tree.props.footer.find(button => button?.props.key === 'submit').props.onClick()
  assert.equal(writes, 0)
  tree = harness.render(props)
  assert.ok(clientNodes(tree).some(node => node.props.role === 'alert'))
  for (const assignment of [
    { ...props.assignment, status: 'LOCKED' },
    { ...props.assignment, task: { status: 'CLOSED' } },
    { ...props.assignment, status: 'SUBMITTED', task: { status: 'OPEN', allowModify: false } },
  ]) {
    tree = harness.render({ ...props, assignment })
    assert.equal(tree.props.footer.some(button => ['save', 'submit'].includes(button?.props.key)), false)
    assert.ok(clientNodes(tree).filter(node => node.type?.name === 'Field').every(node => node.props.disabled))
  }
})

test('cost-item selector reads the authoritative public finance dictionary', async () => {
  let requested
  const { routes } = await loadHost({
    fetch: async url => { requested = new URL(url); return mcpJson({ list: [{ id: 'cost-1', name: '费用类别', active: true }] }) },
  })
  const response = await invokeRoute(routes.get(BASE), 'GET', BASE + '/cost-items')
  assert.equal(response.status, 200)
  assert.equal(requested.pathname, '/api/finance/cost-items')
})


test('entry fields support uncontrolled input and controlled callbacks', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8')
  for (const name of ['Field', 'Textarea']) {
    const harness = clientHarness(source, name)
    const input = harness.render({ name: 'description', required: true })
    assert.equal(Object.hasOwn(input.props, 'value'), false)
    assert.doesNotThrow(() => input.props.onChange({ target: { value: '费用说明' } }))
    let changed
    const controlled = harness.render({ value: '旧说明', onChange: value => { changed = value } })
    controlled.props.onChange({ target: { value: '新说明' } })
    assert.equal(changed, '新说明')
  }
})

test('search drafts and Escape preserve the committed department; explicit selection submits ID', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8')
  const changes = []
  const harness = clientHarness(source, 'SearchSelect')
  const props = { value: 'dept-1', options: [['dept-1', '财务部'], ['dept-2', '市场部']], placeholder: '部门', onChange: value => changes.push(value) }
  let tree = harness.render(props)
  const input = () => clientNodes(tree).find(node => node.props.role === 'combobox')
  input().props.onFocus()
  tree = harness.render(props)
  input().props.onChange({ target: { value: '市场' } })
  tree = harness.render(props)
  assert.deepEqual(changes, [])
  assert.equal(clientNodes(tree).find(node => node.props.type === 'hidden').props.value, 'dept-1')
  let stopped = false
  tree.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() { stopped = true } })
  tree = harness.render(props)
  assert.equal(input().props.value, '财务部')
  assert.equal(stopped, true)
  input().props.onFocus()
  tree = harness.render(props)
  clientNodes(tree).find(node => node.props.role === 'option' && node.props.key === 'dept-2').props.onClick()
  assert.deepEqual(changes, ['dept-2'])
  tree = harness.render({ ...props, value: '' })
  assert.equal(input().props.value, '')
})

test('entry picker matches web: button opens search, Escape preserves selection and choosing closes it', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8')
  const changes = []
  const harness = clientHarness(source, 'SearchSelect')
  const props = { buttonTrigger: true, name: 'costItemId', value: 'travel', placeholder: '费用科目', options: [['travel', '差旅费'], ['office', '办公费']], onChange: value => changes.push(value) }
  let tree = harness.render(props)
  const trigger = () => clientNodes(tree).find(node => node.props.className === 'sf-search-trigger')
  const search = () => clientNodes(tree).find(node => node.props.type === 'search')
  assert.equal(trigger().props['aria-expanded'], false)
  assert.ok(clientNodes(tree).some(node => node.children.includes('差旅费')))
  trigger().props.onClick(); tree = harness.render(props)
  search().props.onChange({ target: { value: '办公' } }); tree = harness.render(props)
  tree.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); tree = harness.render(props)
  assert.equal(trigger().props['aria-expanded'], false)
  assert.deepEqual(changes, [])
  assert.equal(clientNodes(tree).find(node => node.props.type === 'hidden').props.value, 'travel')
  trigger().props.onClick(); tree = harness.render(props)
  assert.equal(search().props.value, '')
  clientNodes(tree).find(node => node.props.role === 'option' && node.props.key === 'office').props.onClick()
  tree = harness.render(props)
  assert.deepEqual(changes, ['office'])
  assert.equal(trigger().props['aria-expanded'], false)
})

test('custom search requires confirmation and form reset clears both visible and submitted values', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8')
  let reset
  let validity
  const inputElement = {
    setCustomValidity: message => { validity = message }, focus() {},
    getBoundingClientRect: () => ({ left: 20, top: 40, bottom: 70, width: 200 }),
    form: { addEventListener: (_event, handler) => { reset = handler }, removeEventListener() {} },
  }
  const harness = clientHarness(source, 'SearchSelect')
  const props = { name: 'costItemNameChoice', required: true, allowCustom: true, options: [], placeholder: '费用项' }
  let tree = harness.render(props)
  let input = clientNodes(tree).find(node => node.props.role === 'combobox')
  input.props.ref.current = inputElement
  harness.flushEffects()
  assert.match(validity, /请选择/)
  input.props.onChange({ target: { value: '  临时费用  ' } })
  tree = harness.render(props)
  harness.flushEffects()
  assert.match(validity, /请选择/)
  assert.equal(clientNodes(tree).find(node => node.props.type === 'hidden').props.value, '')
  clientNodes(tree).find(node => node.props.role === 'option').props.onClick()
  tree = harness.render(props)
  harness.flushEffects()
  assert.equal(validity, '')
  assert.equal(clientNodes(tree).find(node => node.props.type === 'hidden').props.value, '临时费用')
  reset()
  tree = harness.render(props)
  harness.flushEffects()
  assert.equal(clientNodes(tree).find(node => node.props.role === 'combobox').props.value, '')
  assert.equal(clientNodes(tree).find(node => node.props.type === 'hidden').props.value, '')
  assert.match(validity, /请选择/)
})

test('custom text and one matching directory option require an explicit choice on Enter', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8')
  const changes = []
  const inputElement = { focus() {} }
  const harness = clientHarness(source, 'SearchSelect')
  const props = { value: '', options: [['vendor-1', '上海供应商']], allowCustom: true, placeholder: '付款方', onChange: value => changes.push(value) }
  let tree = harness.render(props)
  const input = clientNodes(tree).find(node => node.props.role === 'combobox')
  input.props.ref.current = inputElement
  input.props.onChange({ target: { value: '上海' } })
  tree = harness.render(props)
  tree.props.onKeyDown({ key: 'Enter', target: inputElement, preventDefault() {} })
  assert.deepEqual(changes, [])
  const choices = clientNodes(tree).filter(node => node.props.role === 'option')
  assert.equal(choices[0].props.className.includes('sf-search-custom'), true)
  choices[0].props.onClick()
  assert.deepEqual(changes, ['上海'])
})

test('directory searches are isolated and sync refreshes data with an explicit result', async () => {
  const components = await readFile(new URL('src/components.js', root), 'utf8')
  const entry = await readFile(new URL('src/views/entry.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/members.js', root), 'utf8')
  const requests = []
  let failContacts = true
  let write
  const harness = clientHarness(components + '\n' + entry, 'EntryView', {
    api: async path => { requests.push(path); if (path.startsWith('/contacts?') && failContacts) throw new Error('offline'); return { data: { list: [] } } },
    post: async (path, body) => { write = { path, body }; return { data: { users: 2, departments: 1, departmentMatched: 1, userMatched: 2, skipped: false } } },
  })
  const props = { ctx: { year: 2026, departments: [], orgs: [], revision: 1 }, t: key => key }
  let tree = harness.render(props)
  harness.flushEffects()
  await new Promise(resolve => setImmediate(resolve))
  tree = harness.render(props)
  clientNodes(tree).find(node => node.type?.name === 'PillTabs').props.onChange('org')
  tree = harness.render(props)
  let directory = clientNodes(tree).find(node => node.type?.name === 'DirectoryCard')
  assert.equal(directory.props.contacts.error, true)
  directory.props.setKeyword('财务')
  failContacts = false
  tree = harness.render(props)
  harness.flushEffects()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests.filter(path => path === '/filing-tasks').length, 1)
  assert.equal(requests.filter(path => path.startsWith('/contacts?')).length, 2)
  tree = harness.render(props)
  directory = clientNodes(tree).find(node => node.type?.name === 'DirectoryCard')
  const cardHarness = clientHarness(components + '\n' + entry, 'DirectoryCard')
  const card = cardHarness.render(directory.props)
  await card.props.actions.find(node => node.props.key === 'sync').props.onClick()
  assert.deepEqual(write, { path: '/contacts-sync', body: {} })
  tree = harness.render(props)
  assert.match(clientNodes(tree).find(node => node.type?.name === 'Notice').children.join(''), /同步完成：人员 2/)
  harness.flushEffects()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests.filter(path => path.startsWith('/contacts?')).length, 3)
})

test('employment registration resets person dimensions, blocks duplicate writes, and retains failed input', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/entry.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/members.js', root), 'utf8')
  let finish
  const writes = []
  const closed = []
  const harness = clientHarness(source, 'EmploymentDialog')
  const props = {
    contacts: [{ systemUserId: 'user-1', name: '张三' }, { systemUserId: 'user-2', name: '李四' }],
    departments: [{ id: 'dept-1', name: '财务部' }], t: key => key,
    onClose: () => closed.push(true),
    act: (path, body) => { writes.push({ path, body }); return new Promise(resolve => { finish = resolve }) },
  }
  const controls = tree => clientNodes(tree).filter(node => ['SearchSelect', 'Field'].includes(node.type?.name))
  let tree = harness.render(props)
  controls(tree)[0].props.onChange('user-1')
  tree = harness.render(props)
  controls(tree)[1].props.onChange('dept-1')
  controls(tree)[2].props.onChange('2026-10-10')
  tree = harness.render(props)
  controls(tree)[0].props.onChange('user-2')
  tree = harness.render(props)
  assert.equal(controls(tree)[1].props.value, '')
  assert.equal(controls(tree)[2].props.value, '')
  controls(tree)[1].props.onChange('dept-1')
  controls(tree)[2].props.onChange('2026-10-10')
  tree = harness.render(props)
  const submit = tree.props.footer.find(node => node.props.key === 'ok').props.onClick
  const first = submit()
  await submit()
  assert.equal(writes.length, 1)
  tree = harness.render(props)
  assert.ok(controls(tree).every(node => node.props.disabled))
  assert.equal(clientNodes(tree).find(node => node.type === 'fieldset').props.disabled, true)
  finish(false)
  await first
  tree = harness.render(props)
  assert.equal(controls(tree)[2].props.value, '2026-10-10')
  assert.ok(clientNodes(tree).some(node => node.props.role === 'alert' && node.children.includes('登记失败，请检查字段或稍后重试。已保留输入。')))
  assert.equal(closed.length, 0)
  tree = harness.render({ ...props, departments: [] })
  assert.equal(tree.props.footer.find(node => node.props.key === 'ok').props.disabled, true)
  tree = harness.render(props)
  const second = tree.props.footer.find(node => node.props.key === 'ok').props.onClick()
  finish(true)
  await second
  assert.equal(closed.length, 1)
  assert.deepEqual(writes[0], { path: '/employment-records', body: {
    systemUserId: 'user-2', departmentId: 'dept-1',
    startDate: new Date('2026-10-10T00:00:00').toISOString(), sourceRef: 'manual',
  } })
})

test('employment picker loads an independent directory and failed records are retryable', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/entry.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/members.js', root), 'utf8')
  const requests = []
  const harness = clientHarness(source, 'EntryView', {
    api: async path => {
      requests.push(path)
      if (path.startsWith('/employment-records')) throw new Error('offline')
      return { data: { list: path === '/contacts?limit=100' ? [{ name: '张三', systemUserId: 'user-1' }] : [] } }
    },
  })
  const props = { ctx: { year: 2026, departments: [], orgs: [], revision: 1 }, t: key => key }
  let tree = harness.render(props)
  harness.flushEffects()
  await new Promise(resolve => setImmediate(resolve))
  tree = harness.render(props)
  clientNodes(tree).find(node => node.type?.name === 'PillTabs').props.onChange('org')
  tree = harness.render(props)
  const directory = clientNodes(tree).find(node => node.type?.name === 'DirectoryCard')
  directory.props.setOnlyUnmapped(true)
  directory.props.onDialog({ kind: 'employment' })
  tree = harness.render(props)
  harness.flushEffects()
  await new Promise(resolve => setImmediate(resolve))
  tree = harness.render(props)
  assert.ok(requests.includes('/contacts?limit=100'))
  const dialog = clientNodes(tree).find(node => node.type?.name === 'EmploymentDialog')
  assert.equal(dialog.props.contacts[0].systemUserId, 'user-1')
  const card = clientNodes(tree).find(node => node.type?.name === 'EmploymentCard')
  assert.equal(card.props.employments.error, true)
  const cardHarness = clientHarness(source, 'EmploymentCard')
  const cardTree = cardHarness.render(card.props)
  assert.ok(clientNodes(cardTree).some(node => node.props.role === 'alert'))
  assert.equal(clientNodes(cardTree).find(node => node.type?.name === 'Table').props.empty, null)
  const retry = clientNodes(cardTree).find(node => node.type?.name === 'LinkButton' && node.children.includes('重试加载'))
  retry.props.onClick()
  harness.render(props)
  harness.flushEffects()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests.filter(path => path.startsWith('/employment-records')).length, 2)
})

test('employment columns use local dates, raw chronological sorts, ongoing labels and readable sources', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/entry.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/members.js', root), 'utf8')
  const start = new Date(2026, 9, 10).toISOString()
  const rows = [
    { id: 'old', departmentId: 'dept-1', startDate: '2025-01-01T00:00:00Z', endDate: start, sourceRef: 'manual' },
    { id: 'new', departmentId: 'dept-2', startDate: start, endDate: null, sourceRef: 'feishu-contact:test' },
  ]
  const harness = clientHarness(source, 'EmploymentCard')
  const tree = harness.render({ employments: { list: rows, total: 51 }, t: key => key, onDialog() {} })
  const table = clientNodes(tree).find(node => node.type?.name === 'Table')
  assert.equal(table.props.rows[0].id, 'new')
  const column = key => table.props.columns.find(item => item.key === key)
  assert.equal(column('startDate').render(rows[1]), '2026-10-10 00:00')
  assert.equal(column('startDate').sortValue(rows[1]), new Date(start).getTime())
  assert.equal(column('endDate').label, '结束日期')
  assert.equal(column('endDate').render(rows[1]), '至今')
  assert.equal(column('sourceRef').render(rows[0]), '人工补录')
  assert.equal(column('sourceRef').render(rows[1]), '通讯录同步')
  assert.equal(column('departmentName').render(rows[0]), 'dept-1')
  assert.ok(clientNodes(tree).some(node => node.children.includes('仅展示前 2 条记录，排序仅作用于已加载记录。')))
})

test('entry lists distinguish loading, empty, and failed requests with retry actions', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/entry.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/members.js', root), 'utf8')
  let retries = 0
  const props = { busy: false, t: key => key, act() {}, onDialog() {}, onRetry: () => { retries += 1 } }
  const sectionHarness = clientHarness(source, 'FilingSection')
  const errorTree = sectionHarness.render({ ...props, tasks: { list: [], error: true } })
  assert.equal(errorTree.children[0].type?.name, 'Table')
  assert.equal(errorTree.children[0].props.rows.length, 0)
  assert.equal(errorTree.children[0].props.empty.type?.name, 'ListLoadError')
  const errorHarness = clientHarness(source, 'ListLoadError')
  const errorView = errorHarness.render({ label: '填报任务', onRetry: props.onRetry })
  assert.equal(errorView.props.role, 'alert')
  assert.match(errorView.children[0].children.join(''), /填报任务加载失败/)
  errorView.children[1].props.onClick()
  assert.equal(retries, 1)

  const loadingTree = sectionHarness.render({ ...props, tasks: null })
  assert.equal(loadingTree.children[0].type?.name, 'Table')
  assert.equal(loadingTree.children[0].props.empty, 'loading')
  const emptyTree = sectionHarness.render({ ...props, tasks: { list: [] } })
  assert.equal(emptyTree.children[0].props.empty, 'empty')
  const myHarness = clientHarness(source, 'MyFilingSection')
  assert.equal(myHarness.render({ ...props, assignments: null }).children[0].props.empty, 'loading')
  assert.equal(myHarness.render({ ...props, assignments: { list: [], error: true } }).children[0].props.empty.type?.name, 'ListLoadError')
  const membersHarness = clientHarness(source, 'MembersCard')
  assert.equal(membersHarness.render({ ...props, members: { list: [], error: true } }).children[0].type?.name, 'ListLoadError')
  assert.equal(membersHarness.render({ ...props, members: { list: [], forbidden: true } }).children[0].props.role, 'status')
})

test('client preserves HTTP status so member permission failures are distinguished from network errors', async () => {
  const head = await readFile(new URL('src/head.js', root), 'utf8')
  const requestSource = head.slice(head.indexOf('async function api('), head.indexOf('// One idempotency key'))
  const workflows = await readFile(new URL('src/workflows.js', root), 'utf8')
  const financeErrorText = new Function(workflows + '\nreturn financeErrorText')()
  const read = new Function('fetch', 'AbortSignal', 'BASE', 'REQUEST_TIMEOUT_MS', 'financeErrorText', requestSource + '\nreturn api')
  const response = status => ({ ok: status === 200, status, json: async () => status === 200 ? { data: { list: [] } } : { error: 'permission_denied' } })
  const denied = read(async () => response(403), { timeout: () => undefined }, '/finance', 30000, financeErrorText)
  await assert.rejects(denied('/members'), error => error.status === 403 && error.message.includes('权限'))
  const unavailable = read(async () => response(503), { timeout: () => undefined }, '/finance', 30000, financeErrorText)
  await assert.rejects(unavailable('/members'), error => error.status === 503)

  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/entry.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/members.js', root), 'utf8')
  const harness = clientHarness(source, 'EntryView', { api: path => path === '/members' ? denied(path) : Promise.resolve({ data: { list: [] } }) })
  const props = { ctx: { year: 2026, orgs: [], departments: [], revision: 1 }, t: key => key }
  let tree = harness.render(props)
  harness.flushEffects()
  await new Promise(resolve => setImmediate(resolve))
  tree = harness.render(props)
  clientNodes(tree).find(node => node.type?.name === 'PillTabs').props.onChange('org')
  tree = harness.render(props)
  assert.ok(clientNodes(tree).some(node => node.type?.name === 'FinanceMembersView'))
})

test('member field settings remain available without rows and all writes lock while busy', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/entry.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/members.js', root), 'utf8')
  const harness = clientHarness(source, 'MembersCard')
  const props = { t: key => ({ roleNameDEPT_COLLABORATOR: '信息协同人' }[key] || key), act() {} }
  for (const members of [null, { list: [] }, { error: true }, { forbidden: true }]) {
    const tree = harness.render({ ...props, members })
    assert.ok(clientNodes(tree).some(node => node.type?.name === 'Table'))
  }
  const row = { id: 'm1', userId: 'user-1', name: '张三', role: 'DEPT_COLLABORATOR', enabled: true }
  const tree = harness.render({ ...props, members: { list: [row] }, busy: true })
  const table = clientNodes(tree).find(node => node.type?.name === 'Table')
  const roleColumn = table.props.columns.find(column => column.key === 'role')
  assert.equal(roleColumn.sortValue(row), '信息协同人')
  assert.equal(roleColumn.render(row), '信息协同人')
  assert.ok(clientNodes(table.props.columns.find(column => column.key === 'actions').render(row)).filter(node => node.type?.name === 'GhostButton').every(node => node.props.disabled))
})

test('task form and all custom selectors are locked while submitting', async () => {
  const components = await readFile(new URL('src/components.js', root), 'utf8')
  const entry = await readFile(new URL('src/views/entry.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/members.js', root), 'utf8')
  const harness = clientHarness(components + '\n' + entry, 'CreateTaskDialog')
  const tree = harness.render({ year: 2026, departments: [{ id: 'dept-1', name: '财务部' }], members: { list: [] }, busy: true, t: key => key, onClose() {}, act() {} })
  assert.equal(clientNodes(tree).find(node => node.type === 'fieldset').props.disabled, true)
  assert.ok(clientNodes(tree).filter(node => ['SearchSelect', 'MultiSearchSelect'].includes(node.type?.name)).every(node => node.props.disabled))
})

test('department multi-select closes when keyboard focus leaves or controls become disabled', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8')
  const harness = clientHarness(source, 'MultiSearchSelect')
  const props = { value: ['dept-1'], options: [['dept-1', '财务部']], placeholder: '部门' }
  let tree = harness.render(props)
  clientNodes(tree).find(node => node.props['aria-expanded'] === false).props.onClick()
  tree = harness.render(props)
  tree.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: {} })
  tree = harness.render(props)
  assert.equal(clientNodes(tree).some(node => node.props.role === 'listbox'), false)
  clientNodes(tree).find(node => node.props['aria-expanded'] === false).props.onClick()
  tree = harness.render({ ...props, disabled: true })
  harness.flushEffects()
  tree = harness.render({ ...props, disabled: true })
  assert.equal(clientNodes(tree).some(node => node.props.role === 'listbox'), false)
  tree = harness.render(props)
  assert.equal(clientNodes(tree).some(node => node.props.role === 'listbox'), false)
})

test('department multi-select adds filtered results without losing previous choices', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8')
  let selected
  const harness = clientHarness(source, 'MultiSearchSelect')
  const props = { value: ['dept-1'], onChange: value => { selected = value }, options: [['dept-1', '财务部'], ['dept-2', '市场部'], ['dept-3', '研发部']], placeholder: '部门' }
  let tree = harness.render(props)
  assert.equal(clientNodes(tree).some(node => node.props.role === 'listbox'), false)
  clientNodes(tree).find(node => node.props['aria-expanded'] === false).props.onClick()
  tree = harness.render(props)
  clientNodes(tree).find(node => node.type === 'input').props.onChange({ target: { value: '市场' } })
  tree = harness.render(props)
  clientNodes(tree).find(node => node.children.includes('全选当前结果')).props.onClick()
  assert.deepEqual(selected, ['dept-1', 'dept-2'])
  tree = harness.render({ ...props, value: selected })
  tree.children[0].props.onKeyDown({ key: 'Escape', preventDefault() {} })
  tree = harness.render({ ...props, value: selected })
  assert.equal(clientNodes(tree).some(node => node.props.role === 'listbox'), false)
})

async function budgetEntryHarness(overrides = {}) {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/entry.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/members.js', root), 'utf8')
  const values = { orgId: 'org-1', year: '2026', expenseType: 'FIXED_OPERATION', departmentId: 'dept-1', costItemId: 'travel', budgetAmount: '1250.50', ...overrides.values }
  const writes = [], reads = []
  let resetCount = 0
  const formElement = { reset() { resetCount++ } }
  const props = { year: 2026, orgs: [{ id: 'org-1', name: '有谦' }, { id: 'group', type: 'GROUP', name: '集团' }], departments: [{ id: 'dept-1', name: '产品工程' }], ...overrides.props, role: overrides.role, t: key => key }
  const harness = clientHarness(source, 'EntryPanel', {
    FormData: class { constructor(form) { assert.equal(form, formElement) } get(key) { return values[key] } },
    api: async path => {
      reads.push(path)
      if (overrides.api) return overrides.api(path)
      return { data: { list: path === '/cost-items' ? [{ id: 'travel', name: '差旅费', active: true }, { id: 'old', name: '已停用', active: false }] : path.startsWith('/budget-versions') ? [{ id: 'version-1', year: Number(values.year), isPrimary: true, name: '已发布主版本' }] : [] } }
    },
    post: async (path, body) => { writes.push({ path, body }); if (overrides.post) await overrides.post(path, body) },
  })
  const render = () => harness.render(props)
  const settle = async () => { render(); harness.flushEffects(); await new Promise(resolve => setImmediate(resolve)); return render() }
  const switchKind = kind => { clientNodes(render()).find(node => node.type?.name === 'PillTabs').props.onChange(kind); return render() }
  const submit = () => render().props.onSubmit({ currentTarget: formElement, preventDefault() {} })
  render(); await settle(); switchKind('budget'); await settle()
  return { render, settle, switchKind, submit, values, reads, writes, get resetCount() { return resetCount } }
}

test('table settings stay isolated across lists and numeric sorts keep missing values last', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8')
  const values = new Map([
    ['dofe-finance-table:second', JSON.stringify(['name'])],
    ['dofe-finance-table:second:sort', JSON.stringify({ id: 'name', direction: 'desc' })],
  ])
  const harness = clientHarness(source, 'Table', {
    localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
  })
  const props = { tableId: 'first', columns: [{ key: 'name', label: '名称' }, { key: 'amount', label: '金额', num: true }], rows: [{ id: 'low', name: '低', amount: 20 }, { id: 'high', name: '高', amount: 100 }, { id: 'missing', name: '空', amount: null }], rowKey: 'id' }
  harness.render(props); harness.flushEffects()
  let tree = harness.render(props); harness.flushEffects()
  clientNodes(tree).find(node => node.props['aria-label']?.startsWith('按金额排序')).props.onClick()
  tree = harness.render(props); harness.flushEffects()
  const rowIds = () => clientNodes(tree).filter(node => node.type === 'tr' && node.props.key).map(node => node.props.key)
  assert.deepEqual(rowIds(), ['low', 'high', 'missing'])
  clientNodes(tree).find(node => node.props['aria-label']?.startsWith('按金额排序')).props.onClick()
  tree = harness.render(props); harness.flushEffects()
  assert.deepEqual(rowIds(), ['high', 'low', 'missing'])
  harness.render({ ...props, tableId: 'second' }); harness.flushEffects()
  tree = harness.render({ ...props, tableId: 'second' }); harness.flushEffects()
  assert.deepEqual(clientNodes(tree).filter(node => node.type === 'th').map(node => node.props.key), ['name'])
  assert.equal(JSON.parse(values.get('dofe-finance-table:second:sort')).id, 'name')
})


// 前缀路由注册名：子路径用例统一从 BASE 拼接，避免散落完整字面量
const BASE = '/api/desktop/sensteed/finance'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** Datasource REST 标准应答。 */
function mcpJson(data, status = 200) {
  return jsonResponse({ code: 0, msg: 'ok', data }, status)
}

/** 宿主 ctx 桩：抓取前缀路由、工具与 systemPrompt 段 */
async function loadHost(overrides = {}) {
  const routes = new Map()
  const tools = new Map()
  const sections = []
  const { apply } = await import('../index.js')
  const upstreamFetch = overrides.fetch || globalThis.fetch
  const fetch = async (url, init) => {
    const response = await upstreamFetch(url, init)
    if (!new URL(url).pathname.endsWith('/permissions/workspace-access')) return response
    const body = await response.clone().json().catch(() => null)
    return body?.data?.allowed === undefined ? mcpJson({ allowed: true }) : response
  }
  // 凭据桩：默认仅这三个引用有存储值；overrides.credentialRefs 提供时整体替换（模拟引用缺省场景）
  const credentialRefs = new Map(Object.entries(overrides.credentialRefs ?? {
    DATASOURCE_INTERNAL_API_SECRET: 'cred-secret',
    DATASOURCE_TENANT_ID: 'tenant-1',
    DATASOURCE_OPERATOR_ID: 'op-1',
  }))
  apply({
    hubMcp: { register() { return { async dispose() {} } } },
    credentials: { async resolve(name) { return credentialRefs.has(name) ? { value: credentialRefs.get(name), source: 'file' } : undefined } },
    effect(factory) { return factory() },
    logger: { warn() {} },
    webServer: { port: 1, register(value) { routes.set(value.path, value); return () => {} } },
    dofeAccess: () => ({ ready: true, financeAllowed: true }),
    tools: { schemas: () => [{ name: 'mcp__finance__query' }], register(value) { tools.set(value.name, value); return () => {} } },
    systemPrompt: { section(value) { sections.push(value); return () => {} } },
    settings: overrides.settings,
    dofeAuth: overrides.dofeAuth ?? { getDatasourceSession: () => ({ accessToken: 'feishu-test-token', tenantId: 'tenant-1', operator: 'op-1' }) },
  }, { ...overrides, fetch })
  return { routes, tools, sections }
}

async function invokeRoute(route, method, url, body, headers = {}) {
  let status = 0
  let raw = ''
  const merged = {
    // 渲染进程同源请求的浏览器默认头（宿主 sameOrigin 校验依赖）
    origin: 'http://127.0.0.1:1',
    'sec-fetch-site': 'same-origin',
    ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
    ...headers,
  }
  const req = {
    method,
    url: url || route.path,
    headers: merged,
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(JSON.stringify(body)) },
  }
  const res = {
    writeHead(value) { status = value; return this },
    end(value = '') { raw += value },
  }
  await route.handler(req, res)
  return { status, body: raw ? JSON.parse(raw) : undefined, headers: merged }
}

// 客户端片段清单（与 scripts/build.mjs 的 FILES 保持一致；顺序即依赖顺序）
const CLIENT_FILES = [
  'src/head.js', 'src/format.js', 'src/components.js', 'src/styles.js', 'src/workflows.js', 'src/navigation.js', 'src/permission-catalog.js',
  'src/views/overview.js', 'src/views/budget.js', 'src/views/operations.js', 'src/views/cash.js',
  'src/views/alerts.js', 'src/views/datacenter.js', 'src/views/entry.js', 'src/views/configured-entry.js', 'src/views/analyze.js',
  'src/views/bom.js', 'src/views/notifications.js', 'src/views/permissions.js', 'src/views/members.js', 'src/views/review.js', 'src/views/sources.js', 'src/views/comparisons.js', 'src/views/facts.js', 'src/views/engine.js', 'src/views/filing.js',
  'src/shell.js',
]

test('BOM entry checks the effective cost permission separately from workspace access', async () => {
  for (const permissions of [[], ['cost.engineering.read']]) {
    const { routes } = await loadHost({ fetch: async url => String(url).endsWith('/permissions/me')
      ? mcpJson({ permissions }) : mcpJson({ allowed: true }) })
    const response = await invokeRoute(routes.get(BASE), 'GET', BASE + '/access?permission=cost.engineering.read')
    assert.equal(response.status, 200)
    assert.equal(response.body.allowed, permissions.length > 0)
  }
  const { routes } = await loadHost({ fetch: async url => String(url).endsWith('/permissions/me')
    ? mcpJson({}, 503) : mcpJson({ allowed: true }) })
  assert.equal((await invokeRoute(routes.get(BASE), 'GET', BASE + '/access?permission=cost.engineering.read')).status, 503)
})

test('BOM list and detail reuse the live session and expose only CE read routes', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => {
    calls.push({ url: String(url), init })
    return mcpJson({ list: [], nodes: [], total: 0 })
  } })
  const route = routes.get(BASE)
  for (const [path, upstream] of [
    ['/bom/packages?page=2&limit=20&tenantId=forged&year=2026', '/api/ce/packages?page=2&limit=20'],
    ['/bom/packages/pkg-1', '/api/ce/packages/pkg-1'],
    ['/bom/packages/pkg-1/rollup', '/api/ce/packages/pkg-1/rollup'],
  ]) {
    const result = await invokeRoute(route, 'GET', BASE + path)
    assert.equal(result.status, 200)
    const call = calls.at(-1)
    assert.equal(new URL(call.url).pathname + new URL(call.url).search, upstream)
    assert.equal(call.init.headers.authorization, 'Bearer feishu-test-token')
  }
  assert.equal((await invokeRoute(route, 'POST', BASE + '/bom/packages', {})).status, 404)
  assert.equal((await invokeRoute(route, 'GET', BASE + '/bom/packages/pkg-1/delete')).status, 404)
})
async function readClientSource() {
  const chunks = []
  for (const file of CLIENT_FILES) chunks.push(await readFile(new URL(file, root), 'utf8'))
  return chunks.join('\n')
}

test('manifest wires the MCP client and the web client', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.name, '@dofe/dsh-sensteed-finance')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
})

test('registers a prefix route, a bootstrap tool, and finance guidance', async () => {
  const { routes, tools, sections } = await loadHost()
  assert.equal(routes.get(BASE).kind, 'prefix')
  assert.ok(tools.get('sensteed_finance_bootstrap'))
  assert.equal(sections[0].name, 'sensteed:finance-guidance')
  assert.match(sections[0].text({}), /finance_analysis_brief/u)
  assert.match(sections[0].text({}), /财务口吻/u)
})

test('GET routes call the public Datasource REST API', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => {
    calls.push({ url: String(url), init })
    const path = new URL(url).pathname
    if (path.endsWith('/overview')) return mcpJson({ metrics: [], trend: [], byOrg: [] })
    if (path.endsWith('/orgs')) return mcpJson({ list: [{ id: 'org-1', name: '主体A' }] })
    if (path.endsWith('/alerts/summary')) return mcpJson({ total: 0 })
    if (path.endsWith('/data-quality')) return mcpJson({})
    return mcpJson({ list: [], total: 0, page: 1, limit: 20 })
  } })
  const route = routes.get(BASE)
  const brief = await invokeRoute(route, 'GET', BASE + '/brief?year=2026')
  assert.equal(brief.status, 200)
  assert.equal(brief.body.ok, true)
  assert.equal(brief.body.data.year, 2026)
  assert.ok(calls.some(item => item.url.startsWith('https://ds.hozonauto.com/api/finance/')), 'uses public Datasource REST origin')
  assert.ok(calls.every(item => !item.url.includes('/mcp')), 'no direct MCP endpoint remains')
  assert.equal(calls.find(item => !item.url.endsWith('/permissions/workspace-access')).init.headers.authorization, 'Bearer feishu-test-token', 'REST uses the live Feishu session')

  const quality = await invokeRoute(route, 'GET', BASE + '/quality')
  assert.equal(quality.status, 200)
  assert.ok(quality.body.quality, 'quality block present')
  assert.ok(quality.body.batches, 'batches block present')

  const missing = await invokeRoute(route, 'GET', BASE + '/nope')
  assert.equal(missing.status, 404)
})

test('checks workspace access before proxying finance data', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => {
    calls.push(String(url))
    if (String(url).endsWith('/permissions/workspace-access')) return mcpJson({ allowed: false })
    return mcpJson({ list: [] })
  } })
  const result = await invokeRoute(routes.get(BASE), 'GET', BASE + '/overview')
  assert.equal(result.status, 403)
  assert.equal(result.body.ok, false)
  assert.equal(calls.length, 1)
  assert.match(calls[0], /permissions\/workspace-access/u)
})

test('reports permission service outages separately from a denied workspace', async () => {
  const { routes } = await loadHost({ fetch: async () => mcpJson({ allowed: false }, 503) })
  const route = routes.get(BASE)
  const access = await invokeRoute(route, 'GET', BASE + '/access')
  assert.equal(access.status, 503)
  assert.equal(access.body.ok, false)
  assert.equal(access.body.allowed, undefined)
  const data = await invokeRoute(route, 'GET', BASE + '/overview')
  assert.equal(data.status, 503)
})

test('accepts the public Datasource REST success envelope with code 200', async () => {
  const { routes } = await loadHost({ fetch: async () => jsonResponse({
    code: 200,
    msg: 'ok',
    data: { list: [] },
  }) })
  const result = await invokeRoute(routes.get(BASE), 'GET', BASE + '/context')
  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  assert.deepEqual(result.body.data, { orgs: [], departments: [] })
})

test('write routes map to REST resources with path ids', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => { calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : undefined }); return mcpJson({ created: { id: 'row-1' } }) } })
  const route = routes.get(BASE)
  const created = await invokeRoute(route, 'POST', BASE + '/payment-plans', { orgId: 'org-1', planType: 'PURCHASE', year: 2026, description: '测试', plannedAmount: 100 })
  assert.equal(created.status, 200)
  const businessCalls = () => calls.filter(item => !item.url.endsWith('/permissions/workspace-access'))
  assert.match(businessCalls()[0].url, /\/api\/finance\/payment-plans/u)
  assert.equal(businessCalls()[0].init.method, 'POST')
  assert.equal(businessCalls()[0].body.tenantId, undefined)
  assert.equal(businessCalls()[0].body.operator, undefined)

  const patched = await invokeRoute(route, 'POST', BASE + '/revenue-plans/row-9/actuals', { actualAmount: 50 })
  assert.equal(patched.status, 200)
  assert.match(businessCalls()[1].url, /\/api\/finance\/revenue-plans\/row-9\/actuals/u)
  assert.equal(businessCalls()[1].init.method, 'PATCH')

  const rung = await invokeRoute(route, 'POST', BASE + '/alerts/run', { year: 2026 })
  assert.equal(rung.status, 200)
  assert.match(businessCalls()[2].url, /\/api\/finance\/alerts\/run/u)

  const bad = await invokeRoute(route, 'POST', BASE + '/nope', {})
  assert.equal(bad.status, 404)
})

test('requires Feishu login and ignores client-supplied tenant and operator', async () => {
  const calls = []
  let session
  const { routes } = await loadHost({
    dofeAuth: { getDatasourceSession: () => session },
    fetch: async (_url, init) => { calls.push(init.body ? JSON.parse(init.body) : {}); return mcpJson({ ok: true }) },
  })
  const route = routes.get(BASE)
  assert.equal((await invokeRoute(route, 'POST', BASE + '/payment-plans', { operator: 'spoof' })).status, 401)
  assert.equal(calls.length, 0)
  session = { accessToken: 'feishu-test-token', tenantId: 'tenant-1', operator: 'sso-1' }
  await invokeRoute(route, 'POST', BASE + '/payment-plans', { tenantId: 'other', operator: 'spoof' })
  assert.equal(calls[0].operator, undefined)
  assert.equal(calls[0].tenantId, undefined)
  assert.equal(calls[0].idempotencyKey, undefined)
  session = undefined
  assert.equal((await invokeRoute(route, 'GET', BASE + '/quality')).status, 401)
})

test('same-origin guard rejects foreign-origin and non-loopback requests', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => { calls.push({}); return mcpJson({ ok: true }) } })
  const route = routes.get(BASE)
  // 跨源 POST（网页 CSRF 形态）：403 且不落上游
  const csrf = await invokeRoute(route, 'POST', BASE + '/payment-plans', { orgId: 'org-1' }, { origin: 'https://evil.example' })
  assert.equal(csrf.status, 403)
  // 非本机回环来源：403
  let status = 0
  const req = { method: 'GET', url: BASE + '/brief', headers: { origin: 'http://127.0.0.1:1' }, socket: { remoteAddress: '10.0.0.9' }, async *[Symbol.asyncIterator]() {} }
  const res = { writeHead(value) { status = value; return this }, end() {} }
  await route.handler(req, res)
  assert.equal(status, 403)
  assert.equal(calls.length, 0, 'rejected requests must not reach the MCP upstream')
})

test('read and write operator come from the live Feishu session', async () => {
  const calls = []
  const { routes } = await loadHost({
    dofeAuth: { getDatasourceSession: () => ({ accessToken: 'token', tenantId: 'tenant-1', operator: 'sso-2' }) },
    fetch: async (url, init) => { calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : {} }); return mcpJson({ ok: true }) },
  })
  const route = routes.get(BASE)
  await invokeRoute(route, 'POST', BASE + '/payment-plans', { orgId: 'org-1', plannedAmount: 1 })
  assert.equal(calls.at(-1).body.operator, undefined)
  // GET 侧 operatorArg 同样吃到 SSO 身份
  await invokeRoute(route, 'GET', BASE + '/saved-views')
  assert.match(calls.at(-1).url, /\/api\/finance\/saved-views/u)
})

test('new read routes map to public REST resources', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => { calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : {} }); return mcpJson({ list: [] }) } })
  const route = routes.get(BASE)
  const cases = [
    ['/departments?x=1', 'finance_get_departments'],
    ['/alerts-summary?year=2026', 'finance_get_alert_summary'],
    ['/alert-rules', 'finance_get_alert_rules'],
    ['/budget-versions?year=2026', 'finance_get_budget_versions'],
    ['/budget-version-diff?year=2026&baseVersionId=b1&targetVersionId=t1', 'finance_get_budget_version_diff'],
    ['/carryover-rules', 'finance_get_carryover_rules'],
    ['/saved-views', 'finance_get_saved_views'],
    ['/members', 'finance_get_members'],
    ['/employment-records', 'finance_get_employment_records'],
    ['/contacts?onlyUnmapped=1', 'finance_directory_contacts_query'],
    ['/data-source-configs', 'finance_get_data_source_configs'],
    ['/data-source-runs?status=FAILED', 'finance_get_data_source_runs'],
    ['/data-source-metrics?days=7', 'finance_get_data_source_metrics'],
    ['/budget-adjustments?status=SUBMITTED', 'finance_budget_adjustment_list'],
    ['/plan-adjustments', 'finance_plan_adjustment_list'],
    ['/allocations?page=1', 'finance_allocation_list'],
    ['/allocations-pool?year=2026', 'finance_allocation_pool_query'],
    ['/availability?year=2026', 'finance_budget_availability_query'],
    ['/filing-tasks?status=OPEN', 'finance_filing_task_list'],
    ['/filing-assignments?year=2026', 'finance_filing_assignments_query'],
  ]
  for (const [path, tool] of cases) {
    const response = await invokeRoute(route, 'GET', BASE + path)
    assert.equal(response.status, 200, path)
    assert.match(calls.at(-1).url, /^https:\/\/ds\.hozonauto\.com\/api\//u, path)
  }
  // operator 解析：query 优先，缺省用凭据
  await invokeRoute(route, 'GET', BASE + '/saved-views?operator=op-query')
  assert.doesNotMatch(calls.at(-1).url, /op-query/u)
  await invokeRoute(route, 'GET', BASE + '/saved-views')
  assert.match(calls.at(-1).url, /\/saved-views/u)
})

test('new write routes merge path captures into REST resources', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => { calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : {} }); return mcpJson({ ok: true }) } })
  const route = routes.get(BASE)

  // 版本生命周期：路径 id 注入
  await invokeRoute(route, 'POST', BASE + '/budget-versions/ver-1/action', { action: 'activate' })
  assert.match(calls.at(-1).url, /\/api\/finance\/budget\/versions\/ver-1\/activate/u)

  // 填报重开：路径捕获注入 id + action
  await invokeRoute(route, 'POST', BASE + '/filing-assignments/as-1/reopen', { reason: '数据填错' })
  assert.match(calls.at(-1).url, /\/api\/finance\/filing\/assignments\/as-1\/reopen/u)

  // 填报行暂存：路径捕获映射为 assignmentId
  await invokeRoute(route, 'POST', BASE + '/filing-assignments/as-1/rows', { rows: [{ plannedAmount: 10 }] })
  assert.match(calls.at(-1).url, /\/api\/finance\/filing\/assignments\/as-1\/rows/u)
  assert.equal(calls.at(-1).init.method, 'PUT')

  // 预算调整审批：approve/reject 合一到 review 工具
  await invokeRoute(route, 'POST', BASE + '/budget-adjustments/adj-1/reject', { note: '预算依据不足' })
  assert.match(calls.at(-1).url, /\/api\/finance\/budget\/adjustments\/adj-1\/reject/u)

  // 提交走独立工具，路径捕获映射为 adjustmentId
  await invokeRoute(route, 'POST', BASE + '/budget-adjustments/adj-1/submit', {})
  assert.match(calls.at(-1).url, /\/api\/finance\/budget\/adjustments\/adj-1\/submit/u)

  // 排款调增审批 / 过账 / 数据源启停（无 operator 工具）
  await invokeRoute(route, 'POST', BASE + '/plan-adjustments/pa-1/approve', { note: '同意' })
  assert.match(calls.at(-1).url, /\/api\/finance\/payment-plan-adjustments\/pa-1\/approve/u)
  await invokeRoute(route, 'POST', BASE + '/allocations/al-1/remove', {})
  assert.match(calls.at(-1).url, /\/api\/finance\/allocations\/al-1\/remove/u)
  await invokeRoute(route, 'POST', BASE + '/data-source-configs/ds-1/active', { active: false })
  assert.match(calls.at(-1).url, /\/api\/data-source\/configs\/ds-1\/active/u)
  assert.equal(calls.at(-1).body.active, false)
  assert.equal(calls.at(-1).body.operator, undefined)
  await invokeRoute(route, 'POST', BASE + '/data-source-configs', { scope: 'HEADQUARTERS', kind: 'DSS', displayName: '总部 DSS' })
  assert.match(calls.at(-1).url, /\/api\/data-source\/configs$/u)
  assert.equal(calls.at(-1).init.method, 'PUT')
  assert.equal(calls.at(-1).body.displayName, '总部 DSS')
  assert.equal(calls.at(-1).body.operator, undefined)
  await invokeRoute(route, 'POST', BASE + '/data-source-sync', { scope: 'HEADQUARTERS', bizSystem: 'OA' })
  assert.match(calls.at(-1).url, /\/api\/data-source\/runs\/sync$/u)
  assert.equal(calls.at(-1).init.method, 'POST')
  assert.equal(calls.at(-1).body.bizSystem, 'OA')
})

test('bootstrap tool reports tenant and orgs', async () => {
  const { tools } = await loadHost({ fetch: async () => mcpJson({ orgs: [{ id: 'org-1', name: '主体A' }] }) })
  const result = await tools.get('sensteed_finance_bootstrap').execute({})
  assert.equal(result.ok, true)
  assert.equal(result.result.tenantId, 'tenant-1')
  assert.equal(result.result.orgs[0].name, '主体A')
})

test('context normalizes organizations and departments for the selectors', async () => {
  const { routes } = await loadHost({ fetch: async (url) => {
    const path = new URL(url).pathname
    return mcpJson(path.endsWith('/orgs') ? { orgs: [{ id: 'org-1', name: '主体' }] } : { list: [{ id: 'dept-1', name: '部门' }] })
  } })
  const result = await invokeRoute(routes.get(BASE), 'GET', BASE + '/context')
  assert.equal(result.body.data.orgs[0].id, 'org-1')
  assert.equal(result.body.data.departments[0].id, 'dept-1')
})

test('distinguishes expired login from denied finance permissions', async () => {
  for (const status of [401, 403]) {
    const { tools } = await loadHost({ fetch: async url =>
      String(url).endsWith('/permissions/workspace-access')
        ? mcpJson({ allowed: true })
        : new Response('', { status }) })
    const result = await tools.get('sensteed_finance_bootstrap').execute()
    assert.equal(result.ok, false)
    if (status === 401) assert.match(result.error, /登录已失效.*重新登录/u)
    else {
      assert.match(result.error, /操作权限.*财务负责人/u)
      assert.doesNotMatch(result.error, /重新登录/u)
    }
  }
})

test('REST business errors are failures, not successful writes', async () => {
  for (const data of [{ error: 'forbidden', hint: '没有操作权限' }, { error: 'budget_exceeded' }]) {
    const { routes } = await loadHost({ fetch: async () => jsonResponse({ code: 1, msg: data.hint || data.error }, 200) })
    const result = await invokeRoute(routes.get(BASE), 'POST', BASE + '/allocations', {})
    assert.equal(result.status, 502)
    assert.equal(result.body.ok, false)
    assert.equal(result.body.error, data.hint || data.error)
  }
})

test('scope changes replace group totals with the selected organization', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url) => {
    const parsed = new URL(url)
    const selectedOrg = parsed.searchParams.get('orgId')
    calls.push(parsed.pathname)
    return mcpJson(parsed.pathname.endsWith('/overview') && !selectedOrg ? { group: true } : { selectedOrg })
  } })
  const result = await invokeRoute(routes.get(BASE), 'GET', BASE + '/brief?year=2026&orgId=org-1')
  assert.equal(result.body.data.overview.selectedOrg, 'org-1')
  assert.equal(result.body.data.budget.selectedOrg, 'org-1')
  assert.equal(result.body.data.cash.selectedOrg, 'org-1')
  assert.equal(calls.filter(path => !path.endsWith('/permissions/workspace-access')).length, 7)
})

test('keeps the secret out of URLs and never fabricates upstream data', async () => {
  const { routes } = await loadHost({ fetch: async () => new Response('denied', { status: 403 }) })
  const route = routes.get(BASE)
  const response = await invokeRoute(route, 'GET', BASE + '/brief')
  assert.equal(response.status, 403)
  assert.equal(response.body.ok, false)
  assert.match(response.body.error, /财务操作权限/)
  const source = await readFile(new URL('index.js', root), 'utf8')
  assert.doesNotMatch(source, /api_key|MODELS_API_KEY/u)
})

test('MCP registration is owned by the desktop login lifecycle without machine secrets', async () => {
  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
  assert.doesNotMatch(patch, /authorizationCredential|INTERNAL_API_SECRET|mcp-finance/u)
})

test('client source wires sidebar entry, overlay, tabs, and skill-backed analysis entries', async () => {
  const source = await readClientSource()
  for (const token of ['sidebar.footer.action', "name: 'main'", 'sf-overlay', 'ANALYSIS_ENTRIES', '/brief', 'backfillActual', 'runDone', 'analysis_forecast', 'PillTabs', 'BudgetView', 'sf-pilltabs', 'sf-table-fields', 'sf-table-sort-button', 'sf-sidebar-brand', 'CustomizableTextSelect', 'MultiSearchSelect', 'textChoice', '新建预算行', 'targetYear', 'adjTargetMonth']) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  }
  assert.match(source, /if \(await act\('\/budget-adjustments',[\s\S]*?\)\) onClose\(\)/u)
  for (const skill of ['finance-monthly-risk', 'finance-cost-structure', 'finance-cash-pressure', 'finance-budget-review', 'finance-revenue-attainment', 'finance-data-quality', 'finance-cost-cash-forecast', 'finance-budget-version-health', 'finance-alert-rules-audit']) {
    assert.match(source, new RegExp(`skill: '${skill}'`, 'u'))
  }
  assert.ok(source.includes('return `/${entry.skill}\\n${context}`'))
  assert.match(source, /const id = await sessions\.create\(\)/u)
  assert.doesNotMatch(source, /sf-task-departments/u, 'department assignment must use the searchable multi-select')
  assert.doesNotMatch(source, /fetch\(`https?:\/\//u, 'client must only call same-origin routes')
})

test('search selectors use the shared accessible popup instead of browser datalist', async () => {
  const source = await readClientSource()
  assert.match(source, /function SearchSelect\(/u)
  assert.match(source, /className: 'sf-search-menu'/u)
  assert.match(source, /'aria-controls': menuId/u)
  assert.doesNotMatch(source, /h\('datalist'/u)
  assert.match(source, /className: 'sf-search-clear'/u)
  assert.match(source, /全选当前结果/u)
  assert.match(source, /清空已选/u)
  assert.match(source, /className: 'sf-multi-trigger'/u)
  assert.match(source, /className: 'sf-multi-menu'/u)
})

test('table keeps column identities after hiding fields and offers settings when empty', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8')
  const element = (type, props, ...children) => ({ type, props: props || {}, children })
  const storage = { getItem: () => JSON.stringify(['column-1', 'column-2']), setItem() {} }
  const table = new Function('h', 'useState', 'useEffect', 'useMemo', 'useRef', 'localStorage', `${source}\nreturn Table`)(
    element,
    initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    () => {},
    compute => compute(),
    initial => ({ current: initial }),
    storage,
  )
  const columns = [{ label: 'A', sortKey: 'a' }, { label: 'B', sortKey: 'b' }, { label: 'C', sortKey: 'c' }]
  const descendants = node => [node, ...(node?.children || []).flatMap(child => child && typeof child === 'object' ? descendants(child) : [])]
  const filled = descendants(table({ columns, rows: [{ a: 1, b: 2, c: 3 }], empty: '暂无数据' }))
  assert.deepEqual(filled.filter(node => node?.type === 'th').map(node => node.props.key), ['column-1', 'column-2'])
  const empty = descendants(table({ columns, rows: [], empty: '暂无数据' }))
  assert.ok(empty.some(node => node?.type === 'summary' && node.props.className === 'sf-table-tool'))
  assert.ok(empty.some(node => node?.props?.className === 'sf-empty'))
})

test('table column settings search labels and preserve column identities', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8')
  const values = new Map()
  const harness = clientHarness(source, 'Table', {
    localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
  })
  const props = { tableId: 'searchable', columns: [{ key: 'org', label: '主体' }, { key: 'amount', label: '预算金额' }], rows: [{ id: 'one', org: '甲', amount: 100 }], rowKey: 'id' }
  let tree = harness.render(props)
  const search = () => clientNodes(tree).find(node => node.props['aria-label'] === '搜索展示字段')
  search().props.onChange({ target: { value: '预算' } })
  tree = harness.render(props)
  assert.deepEqual(clientNodes(tree).filter(node => node.props.className === 'sf-table-field-option').map(node => node.props.key), ['amount'])
  search().props.onChange({ target: { value: '不存在' } })
  tree = harness.render(props)
  assert.ok(clientNodes(tree).some(node => node.children.includes('没有匹配字段')))
})

test('table restores the action column from old preferences and keeps one data field visible', async () => {
  const values = new Map([['dofe-finance-table:actions', JSON.stringify(['name'])]])
  const source = await readFile(new URL('src/components.js', root), 'utf8')
  const harness = clientHarness(source, 'Table', {
    localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
  })
  const tree = harness.render({ tableId: 'actions', columns: [{ key: 'name', label: '名称' }, { key: 'amount', label: '金额' }, { key: 'actions', label: '操作', sortable: false }], rows: [{ name: '甲', amount: 10 }] })
  assert.deepEqual(clientNodes(tree).filter(node => node.type === 'th').map(node => node.props.key), ['name', 'actions'])
  const options = clientNodes(tree).filter(node => node.props.className === 'sf-table-field-option')
  assert.equal(options.find(node => node.props.key === 'actions').children[0].props.disabled, true)
  assert.equal(options.find(node => node.props.key === 'name').children[0].props.disabled, true)
})

test('busy primary actions stay disabled when validation explicitly enables the button', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8')
  const harness = clientHarness(source, 'PrimaryButton')
  assert.equal(harness.render({ busy: true, disabled: false }).props.disabled, true)
  assert.equal(harness.render({ busy: false, disabled: true }).props.disabled, true)
  assert.equal(harness.render({ busy: false, disabled: false }).props.disabled, false)
})

test('department popup handles arrow navigation and Escape without closing the task dialog', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8')
  const focus = []
  const items = [{ focus: () => focus.push('first') }, { focus: () => focus.push('second') }]
  const harness = clientHarness(source, 'MultiSearchSelect')
  const props = { value: [], options: [['one', '甲部门'], ['two', '乙部门']], onChange() {} }
  let tree = harness.render(props)
  tree.children[0].props.onClick()
  tree = harness.render(props)
  tree.props.ref.current = { querySelectorAll: () => items, querySelector: () => ({ focus: () => focus.push('trigger') }) }
  let stopped = 0
  const event = key => ({ key, preventDefault() {}, stopPropagation() { stopped++ } })
  tree.props.onKeyDown(event('ArrowDown'))
  tree.props.onKeyDown(event('Escape'))
  tree = harness.render(props)
  assert.deepEqual(focus, ['first', 'trigger'])
  assert.equal(stopped, 2)
  assert.equal(clientNodes(tree).some(node => node.props.role === 'listbox'), false)
})

test('task selectors use member names, accept custom names and initialize departments after loading only once', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/entry.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/members.js', root), 'utf8')
  const harness = clientHarness(source, 'CreateTaskDialog', { api: async () => ({ data: { list: [] } }) })
  const props = { year: 2026, departments: [], members: { list: [{ name: '张三' }, { name: '张三' }, { name: '停用', enabled: false }] }, t: key => key, act() {}, onClose() {} }
  let tree = harness.render(props)
  harness.flushEffects()
  const owner = clientNodes(tree).find(node => node.type?.name === 'SearchSelect' && node.props.placeholder === 'taskOwner')
  assert.deepEqual(owner.props.options, [['张三', '张三']])
  assert.equal(owner.props.allowCustom, true)
  const loaded = { ...props, departments: [{ id: 'one', name: '甲部门' }] }
  harness.render(loaded); harness.flushEffects()
  tree = harness.render(loaded)
  const picker = () => clientNodes(tree).find(node => node.type?.name === 'MultiSearchSelect')
  assert.deepEqual(picker().props.value, ['one'])
  picker().props.onChange([])
  harness.render(loaded); harness.flushEffects()
  tree = harness.render(loaded)
  assert.deepEqual(picker().props.value, [])
})

test('task version loading can retry and stale departments cannot be submitted', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/entry.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/members.js', root), 'utf8')
  let requests = 0
  let writes = 0
  const harness = clientHarness(source, 'CreateTaskDialog', { api: async () => {
    if (++requests === 1) throw new Error('offline')
    return { data: { list: [{ id: 'draft', name: '草稿', status: 'DRAFT' }, { id: 'locked', name: '锁定', status: 'LOCKED' }] } }
  } })
  const props = { year: 2026, departments: [{ id: 'one', name: '甲部门' }], orgs: [{ id: 'org-1', name: '测试主体' }], t: key => key, act: async () => { writes++; return true }, onClose() {} }
  let tree = harness.render(props)
  harness.flushEffects()
  await new Promise(resolve => setImmediate(resolve))
  clientNodes(tree).find(node => node.type?.name === 'Field' && node.props.maxLength === 150).props.onChange('年度预算')
  clientNodes(tree).find(node => node.props.type === 'datetime-local').props.onChange('2026-12-20T18:00')
  clientNodes(tree).find(node => node.type?.name === 'Select' && node.props.value === 'PAYMENT_PLAN').props.onChange('BUDGET')
  tree = harness.render(props)
  assert.equal(tree.props.footer[1].props.disabled, true)
  clientNodes(tree).find(node => node.children.includes('重新加载版本')).props.onClick()
  harness.render(props); harness.flushEffects()
  await new Promise(resolve => setImmediate(resolve))
  tree = harness.render(props)
  const version = clientNodes(tree).find(node => node.type?.name === 'SearchSelect' && node.props.placeholder === 'version')
  assert.deepEqual(version.props.options, [['draft', '草稿']])
  version.props.onChange('draft')
  clientNodes(tree).find(node => node.type?.name === 'SearchSelect' && node.props.placeholder === 'taskOrg').props.onChange('org-1')
  tree = harness.render(props)
  assert.equal(tree.props.footer[1].props.disabled, false)
  tree = harness.render({ ...props, departments: [] })
  assert.equal(tree.props.footer[1].props.disabled, true)
  await tree.props.footer[1].props.onClick()
  assert.equal(writes, 0)
})

test('dialog Escape closes one layer and focus stays in the form then returns to its opener', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8')
  const focuses = []
  const document = { activeElement: { focus: () => focuses.push('opener') } }
  let cleanup
  let closed = 0
  const harness = clientHarness(source, 'Dialog', { document, useEffect: effect => { cleanup = effect() } })
  const tree = harness.render({ title: '创建填报任务', onClose: () => closed++ })
  const panel = tree.children[0]
  const first = { focus: () => focuses.push('first'), closest: () => null, getClientRects: () => [1] }
  const last = { focus: () => focuses.push('last'), closest: () => null, getClientRects: () => [1] }
  panel.props.ref.current = { querySelectorAll: () => [first, last], focus: () => focuses.push('panel') }
  document.activeElement = last
  panel.props.onKeyDown({ key: 'Tab', preventDefault() {} })
  document.activeElement = first
  panel.props.onKeyDown({ key: 'Tab', shiftKey: true, preventDefault() {} })
  let stopped = false
  panel.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() { stopped = true } })
  cleanup()
  assert.equal(closed, 1)
  assert.equal(stopped, true)
  assert.deepEqual(focuses, ['first', 'last', 'opener'])
})

test('plugin year and budget version choices match the web labels and preserve an out-of-window selection', async () => {
  const source = await readFile(new URL('src/format.js', root), 'utf8')
  const helpers = new Function(source + '\nreturn { yearOptions, budgetVersionLabel }')()
  const currentYear = new Date().getFullYear()
  assert.deepEqual(helpers.yearOptions().map(([value]) => Number(value)), Array.from({ length: 7 }, (_, index) => currentYear + 2 - index))
  assert.equal(helpers.yearOptions(2010).at(-1)[0], '2010')
  assert.equal(helpers.budgetVersionLabel({ year: 2026, type: 'ROLLING', status: 'DRAFT', frozenThroughMonth: 9, isPrimary: true, lineCount: 12, budgetTotal: 12345.6, publishedAt: '2026-10-01T00:00:00Z' }), '2026 年滚动预算 · 草稿（冻结至 9 月） · 主版本 · 12 行 · ¥12,345.60 · 发布于 2026-10-01')
})

test('filing task dialog submits the same dimensions and keeps failures open', async () => {
  const components = await readFile(new URL('src/components.js', root), 'utf8')
  const entry = await readFile(new URL('src/views/entry.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/members.js', root), 'utf8')
  const format = await readFile(new URL('src/format.js', root), 'utf8')
  const element = (type, props, ...children) => ({ type, props: props || {}, children })
  const createDialog = values => {
    let index = 0
    return new Function('h', 'useState', 'useEffect', `${format}\n${components}\n${entry}\nreturn CreateTaskDialog`)(
      element,
      initial => [index in values ? values[index++] : (index++, initial), () => {}],
      () => {},
    )
  }
  const values = ['十月资金填报', 'org-1', 'PAYMENT_PLAN', '10', '', null, ['dept-1'], '2026-10-10T12:00', '填写说明', '负责人', '审核人', true, false, true]
  let closed = false
  let payload
  const dialog = createDialog(values)({
    year: 2026, departments: [{ id: 'dept-1', name: '部门一' }], orgs: [{ id: 'org-1', name: '主体一' }], busy: false, t: key => key,
    onClose: () => { closed = true }, act: async (_path, body) => { payload = body; return false },
  })
  await dialog.props.footer[1].props.onClick()
  assert.equal(closed, false)
  assert.equal(payload.month, 10)
  assert.deepEqual(payload.departments, [{ departmentId: 'dept-1', orgId: 'org-1' }])
  assert.equal(payload.orgId, undefined)
  assert.equal(payload.instructions, '填写说明')
  assert.equal(payload.freezeCurrentMonth, false)
  assert.equal(payload.startAsDraft, true)

  const budget = createDialog(['年度预算', 'org-1', 'BUDGET', '10', 'version-1', [{ id: 'version-1', name: '预算版本' }], ['dept-1'], '2026-10-10T12:00'])({
    year: 2026, departments: [{ id: 'dept-1', name: '部门一' }], orgs: [{ id: 'org-1', name: '主体一' }], busy: false, t: key => key,
    onClose: () => { closed = true }, act: async (_path, body) => { payload = body; return true },
  })
  await budget.props.footer[1].props.onClick()
  assert.equal(closed, true)
  assert.equal(payload.versionId, 'version-1')
  assert.equal(payload.month, undefined)
})

test('clicking the sidebar button renders the dashboard without render-time reference errors', async () => {
  // 回归：hook 依赖数组在渲染期求值，引用未声明标识符（曾经的 focusReady）会让
  // 看板首渲染即抛 ReferenceError，shell.overlay slot entry 崩溃，表现为“点击看板无反应”。
  // 桩 React 会真正调用函数组件（仅顶层一层），让渲染期错误在测试里当场抛出。
  globalThis.window = { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} }
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail } }
  globalThis.document = { activeElement: null, createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } }
  globalThis.requestAnimationFrame = () => 0
  const source = await readClientSource()
  const module = { exports: {} }
  let renderDepth = 0
  const createElement = (type, props, ...children) => {
    const merged = { ...props, children }
    if (typeof type === 'function' && renderDepth === 0) {
      renderDepth += 1
      try { return type(merged) } finally { renderDepth -= 1 }
    }
    return { type, props: merged }
  }
  const reactStub = {
    createElement,
    useCallback: callback => callback,
    Fragment: 'Fragment',
    useState: initial => [initial === null ? true : (typeof initial === 'function' ? initial() : initial), () => {}],
    useRef: initial => ({ current: initial }),
    useEffect: () => {},
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
  const primitivesStub = new Proxy({}, { get: (_target, key) => key === 'Tooltip' ? props => props.children : () => null })
  const requireStub = name => {
    if (name === 'react') return reactStub
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub
    throw new Error(`unexpected require: ${name}`)
  }
  new Function('require', 'module', 'exports', `${source}\nmodule.exports = { apply, Button, Overlay }`)(requireStub, module, module.exports)
  const { apply, Button, Overlay } = module.exports

  const registered = {}
  apply({
    hubMcp: { register() { return { async dispose() {} } } },
    effect(factory) { return factory() },
    locale: { register() {}, bind: () => key => key },
    slots: { inject(_key, register) { register() }, register(options, component) { registered[options.name] = component; return () => {} } },
    get: () => undefined,
  })
  assert.equal(typeof registered.main, 'function', 'finance must register a native main page')
  assert.equal(registered['shell.overlay'], undefined, 'finance must leave the shell overlay layer free')

  const closed = Overlay({ t: key => key })
  assert.equal(closed, null, 'closed overlay renders nothing')

  // 点侧栏按钮 → openOverlay 置 opened=true（点击链路本身不许出错）
  const button = Button({ wide: true, t: key => key })
  const findClick = node => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findClick(child)
        if (found) return found
      }
      return undefined
    }
    if (!node || typeof node !== 'object') return undefined
    if (node.props?.onClick) return node.props.onClick
    for (const child of [].concat(node.props?.children ?? [])) {
      const found = findClick(child)
      if (found) return found
    }
    return undefined
  }
  const onClick = findClick(button)
  assert.equal(typeof onClick, 'function', 'sidebar button must carry the open handler')
  onClick({ currentTarget: null })

  // 打开状态的首渲染：曾因 focusReady 未定义在这里抛 ReferenceError
  const opened = Overlay({ t: key => key })
  assert.match(String(opened?.props?.className), /\bsf-overlay\b/, 'opened overlay must render the dashboard shell')
  assert.match(String(opened?.props?.className), /\bsf-root\b/, 'overlay must carry the sf-root token scope')
})

test('client field names match the finance contract schemas', async () => {
  const source = await readClientSource()
  // 契约字段回归：FinanceMetric/trend 扁平 *Amount、BudgetSummary {list,totals}、PaymentPlan remainingAmount
  for (const token of ['budgetAmount', 'prSubmittedAmount', 'paidAmount', 'summary?.list', 'summary?.totals', 'remainingAmount', 'data?.list', "name: 'departmentId'", "name: 'planMonth'"]) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'), token)
  }
  // `.rows ||` 已不再陈旧：版本 diff 契约（BudgetVersionDiffResponse.rows）合法使用该字段
  for (const stale of ['taxFreeAmount', "metric.key === 'budgetTotal'"]) {
    assert.doesNotMatch(source, new RegExp(stale.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'), stale)
  }
})

test('client build concatenates every registered fragment', async () => {
  // 防回归：新增 src 片段必须登记进 build.mjs 的 FILES（列表与测试 CLIENT_FILES 同步）
  const build = await readFile(new URL('scripts/build.mjs', root), 'utf8')
  for (const file of CLIENT_FILES) assert.match(build, new RegExp(file.replace(/\//g, '\\/'), 'u'), file)
})

test('public contract adapter exposes finance workflows without accepting arbitrary upstream paths or identities', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => {
    calls.push({ url: String(url), init }); return mcpJson({ list: [], permissions: ['cash.plan.read'] })
  } })
  const route = routes.get(BASE)
  for (const [method, path, body] of [
    ['POST', '/rest/finance/cost-items', { code: 'TRAVEL', name: '差旅费', tenantId: 'forged' }],
    ['GET', '/rest/finance/notifications?category=SYSTEM&unread=true&recipientId=forged', null],
    ['POST', '/rest/ce/packages/pkg-1/nodes', { nodes: [{ name: '物料', partNo: 'A', qty: 1 }], tenantId: 'forged', operator: 'forged' }],
    ['PUT', '/rest/budget-engine/versions/v-1/params', { version: 'P1', params: { openingBalance: 1, safetyLine: 0 } }],
    ['PATCH', '/rest/finance/alerts/a-1/status', { status: 'RESOLVED', note: '已处理' }],
  ]) {
    const result = await invokeRoute(route, method, BASE + path, body, { 'content-type': 'application/json' })
    assert.equal(result.status, 200)
    const call = calls.at(-1)
    assert.equal(new URL(call.url).origin, 'https://ds.hozonauto.com')
    assert.equal(call.init.method, method)
    assert.equal(new URL(call.url).searchParams.has('recipientId'), false)
    assert.equal(call.init.headers.authorization, 'Bearer feishu-test-token')
    if (body) assert.equal(JSON.parse(call.init.body).tenantId, undefined)
  }
  assert.equal((await invokeRoute(route, 'GET', BASE + '/rest/internal/users')).status, 404)
  assert.equal((await invokeRoute(route, 'POST', BASE + '/rest/ce/packages/pkg-1/delete', {})).status, 404)
})

test('overview tolerates unavailable optional datasets and scopes every aggregate consistently', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async url => {
    const path = new URL(url); calls.push(path)
    if (path.pathname.endsWith('/data-quality')) return mcpJson({}, 403)
    return mcpJson({ list: [], metrics: {} })
  } })
  const result = await invokeRoute(routes.get(BASE), 'GET', BASE + '/brief?year=2026&orgId=org-1')
  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  assert.ok(result.body.data.errors.dataQuality)
  for (const path of calls.filter(path => /overview|budget\/summary|cash-summary/.test(path.pathname))) {
    assert.equal(path.searchParams.get('orgId'), 'org-1')
  }
})

test('public writes retain upstream authorization failures and reject cross-origin mutations', async () => {
  let requested = 0
  const { routes } = await loadHost({ fetch: async () => { requested++; return mcpJson({}, 403) } })
  const route = routes.get(BASE)
  const denied = await invokeRoute(route, 'PUT', BASE + '/rest/budget-engine/versions/v-1/params', { version: 'P1', params: {} }, { 'content-type': 'application/json' })
  assert.equal(denied.status, 403)
  const before = requested
  const foreign = await invokeRoute(route, 'PATCH', BASE + '/rest/finance/alerts/a-1/status', { status: 'RESOLVED' }, { 'content-type': 'application/json', origin: 'https://other.example' })
  assert.equal(foreign.status, 403)
  assert.equal(requested, before)
})

test('query changes discard stale financial results and recover after a failed request', async () => {
  const source = await readFile(new URL('src/workflows.js', root), 'utf8')
  const requests = []
  const harness = clientHarness(source + '\nfunction ResourceHarness({ path }) { return useFinanceResource(path, 0) }', 'ResourceHarness', { api: path => new Promise((resolve, reject) => requests.push({ path, resolve, reject })) })
  harness.render({ path: '/data-source/records?scope=HEADQUARTERS' }); harness.flushEffects()
  harness.render({ path: '/data-source/records?scope=HEZHONG' }); harness.flushEffects()
  requests[1].resolve({ data: { list: ['合众'] } }); await Promise.resolve()
  requests[0].resolve({ data: { list: ['总部'] } }); await Promise.resolve()
  assert.deepEqual(harness.render({ path: '/data-source/records?scope=HEZHONG' }).data.list, ['合众'])
  harness.render({ path: '/data-source/records?scope=HEADQUARTERS' }); harness.flushEffects()
  requests[2].reject(new Error('暂不可用')); await Promise.resolve(); await Promise.resolve()
  const failed = harness.render({ path: '/data-source/records?scope=HEADQUARTERS' })
  assert.equal(failed.data, null)
  assert.equal(failed.error, '暂不可用')
  failed.retry(); harness.render({ path: '/data-source/records?scope=HEADQUARTERS' }); harness.flushEffects()
  requests[3].resolve({ data: { list: ['恢复'] } }); await Promise.resolve()
  assert.deepEqual(harness.render({ path: '/data-source/records?scope=HEADQUARTERS' }).data.list, ['恢复'])
})

test('payment facts hide unpublished amounts and separate scope and currency without client sums', async () => {
  let data = { batches: 0, payable: { amount: '999' } }
  const isolated = clientHarness(await readFile(new URL('src/views/facts.js', root), 'utf8'), 'FactsView', {
    useFinanceResource: () => ({ data, loading: false }), FinanceResource() {}, Card() {}, Table() {}, EmptyState() {}, Select() {}, React: { Fragment: 'fragment' }, financeColumns: value => value,
  })
  let tree = isolated.render({ ctx: { year: '2026', revision: 0 } })
  assert(clientNodes(tree).some(node => node.children.includes('尚无已发布批次，暂不展示金额。')))
  assert.equal(clientNodes(tree).filter(node => node.type?.name === 'Table').length, 0)
  data = { batches: 2, byScope: [{ scope: 'HEADQUARTERS', byCurrency: [{ currency: 'CNY', payableAmount: '100', paidAmount: '50' }, { currency: 'USD', payableAmount: '10', paidAmount: '5' }] }, { scope: 'HEZHONG', byCurrency: [{ currency: 'CNY', payableAmount: '80', paidAmount: '20' }] }] }
  tree = isolated.render({ ctx: { year: '2026', revision: 0 } })
  const table = clientNodes(tree).find(node => node.props.tableId === 'finance-facts-currency')
  assert.deepEqual(table.props.rows.map(row => [row.scope, row.currency, row.payableAmount]), [['总部', 'CNY', '100'], ['总部', 'USD', '10'], ['合众', 'CNY', '80']])
})

test('cash viewers cannot schedule, increase or backfill plans', async () => {
  const source = (await Promise.all(['src/components.js', 'src/format.js', 'src/views/cash.js'].map(file => readFile(new URL(file, root), 'utf8')))).join('\n')
  for (const [component, props, forbidden] of [
    ['PlansTab', { rows: [{ id: 'p-1' }], page: 1 }, ['schedule', 'increase']],
    ['RevenueTab', { revenues: { list: [{ id: 'r-1' }] }, page: 1 }, ['backfill']],
  ]) {
    const harness = clientHarness(source, component, { PAGE_SIZE: 20 })
    const tree = harness.render({ ...props, canWrite: false, t: key => key, onPage() {} })
    const table = clientNodes(tree).find(node => node.type?.name === 'Table')
    const actions = table.props.columns.find(column => column.key === 'actions').render(table.props.rows[0])
    assert(!clientNodes(actions).some(node => node.children.some(child => forbidden.includes(child))))
  }
})


test('expense and payment type options have translated labels in both locales', async () => {
  const head = await readFile(new URL('src/head.js', root), 'utf8')
  const constants = head.slice(head.indexOf('const EXPENSE_TYPES'), head.indexOf('const LEDGER_LIMIT'))
  const dictionary = head.slice(head.indexOf('const copy ='), head.indexOf('\n// ---- 打开/关闭状态'))
  const { expenses, plans, copy } = new Function(constants + '\n' + dictionary + '\nreturn { expenses: EXPENSE_TYPES, plans: PLAN_TYPES, copy }')()
  for (const locale of ['zh', 'en']) {
    for (const [, key] of [...expenses, ...plans]) assert.ok(copy[locale][key], `${locale}: ${key}`)
  }
})

test('budget entry preserves the upstream missing published version message', async () => {
  const message = '年度 2027 暂无已发布预算版本，请先导入数据'
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => {
    calls.push({ url: String(url), method: init.method })
    return jsonResponse({ statusCode: 404, message, error: 'Not Found' }, 404)
  } })
  const result = await invokeRoute(routes.get(BASE), 'POST', BASE + '/budget-lines', { year: 2027, budgetAmount: 300000 })
  assert.match(calls.at(-1).url, /\/api\/finance\/budget\/lines$/)
  assert.equal(result.status, 404)
  assert.equal(result.body.error, message)
})


test('both REST adapters retain actionable 400/404 errors without showing route diagnostics', async () => {
  for (const path of ['/budget-lines', '/rest/finance/budget/lines']) {
    for (const [status, body, expected] of [
      [400, { message: ['请选择主体', '预算金额必须大于 0'] }, '请选择主体；预算金额必须大于 0'],
      [404, { msg: '主体不存在' }, '主体不存在'],
      [404, { message: 'Cannot POST /api/finance/budget/lines' }, '未找到对应的财务资源'],
      [503, null, '财务服务暂不可用'],
    ]) {
      const { routes } = await loadHost({ fetch: async () => jsonResponse(body, status) })
      const result = await invokeRoute(routes.get(BASE), 'POST', BASE + path, {})
      assert.equal(result.status, status)
      assert.ok(result.body.error.includes(expected))
      assert.doesNotMatch(result.body.error, /upstream_http_|Cannot POST/)
    }
  }
})

test('backfill supports revenue and payment independently when the other history fails', async () => {
  for (const kind of ['payment', 'revenue']) {
    const harness = await budgetEntryHarness({ values: { planId: 'plan-1', actualAmount: '0' }, api: async path => {
      const resource = kind === 'payment' ? '/payment-plans' : '/revenue-plans'
      if (path.startsWith(resource)) return { data: { list: [{ id: 'plan-1', description: '实际回填', itemName: '收入回填' }] } }
      throw new Error('unavailable')
    } })
    harness.switchKind('backfill')
    await harness.settle()
    const selector = clientNodes(harness.render()).find(node => node.type?.name === 'Select' && node.props.value === 'payment')
    selector.props.onChange(kind)
    await harness.settle()
    clientNodes(harness.render()).find(node => node.props.name === 'planId').props.onChange('plan-1')
    await harness.submit()
    assert.deepEqual(harness.writes, [{ path: `/${kind === 'payment' ? 'payment-plans' : 'revenue-plans'}/plan-1/actuals`, body: { actualAmount: 0 } }])
    assert.equal(harness.resetCount, 1)
  }
})

test('department roles cannot see direct financial entry while finance staff can', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/entry.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/members.js', root), 'utf8')
  for (const financeWriter of [false, true]) {
    const harness = clientHarness(source, 'EntryView')
    const tree = harness.render({ ctx: { year: 2026, orgs: [], departments: [], financeWriter }, t: key => key })
    assert.equal(clientNodes(tree).some(node => node.type?.name === 'EntryPanel'), financeWriter)
  }
})


test('empty custom fields explain creation and keep unconfirmed text visible and invalid after blur', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8')
  for (const required of [false, true]) {
    let validity = ''
    const harness = clientHarness(source, 'SearchSelect')
    const props = { name: 'itemNameChoice', placeholder: '收入项目', allowCustom: true, preserveDraft: true, required, options: [] }
    let tree = harness.render(props)
    const inputElement = { focus() {}, setCustomValidity: value => { validity = value } }
    clientNodes(tree).find(node => node.props.role === 'combobox').props.ref.current = inputElement
    harness.flushEffects()
    clientNodes(tree).find(node => node.props.role === 'combobox').props.onFocus()
    tree = harness.render(props)
    assert.ok(clientNodes(tree).some(node => node.type === 'p' && node.children.some(text => typeof text === 'string' && /输入.*新增/.test(text))))
    clientNodes(tree).find(node => node.props.role === 'combobox').props.onChange({ target: { value: '  新收入项目  ' } })
    tree = harness.render(props)
    tree.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null })
    tree = harness.render(props)
    harness.flushEffects()
    assert.equal(clientNodes(tree).find(node => node.props.role === 'combobox').props.value, '  新收入项目  ')
    assert.equal(clientNodes(tree).find(node => node.props.name === 'itemNameChoice').props.value, '')
    assert.match(validity, /确认/)
    clientNodes(tree).find(node => node.props.role === 'combobox').props.onFocus()
    tree = harness.render(props)
    tree.props.onKeyDown({ key: 'Enter', target: inputElement, preventDefault() {} })
    tree = harness.render(props)
    harness.flushEffects()
    assert.equal(clientNodes(tree).find(node => node.props.name === 'itemNameChoice').props.value, '新收入项目')
    assert.equal(validity, '')
  }
})

test('cold-start revenue accepts confirmed custom values and refreshes history only after saving', async () => {
  let fail = true
  const harness = await budgetEntryHarness({ values: { itemNameChoice: '新项目', payerNameChoice: '新付款方', incomeTypeNameChoice: '销售收入', plannedAmount: '50000', month: '6' }, post: async () => { if (fail) throw new Error('保存失败') } })
  harness.switchKind('revenue')
  const before = harness.reads.filter(path => path.startsWith('/revenue-plans')).length
  await harness.submit()
  assert.equal(harness.resetCount, 0)
  fail = false
  await harness.submit()
  assert.deepEqual(harness.writes[1], { path: '/revenue-plans', body: { orgId: 'org-1', year: 2026, itemName: '新项目', plannedAmount: 50000, month: 6, payerName: '新付款方', incomeTypeName: '销售收入' } })
  await harness.settle()
  assert.ok(harness.reads.filter(path => path.startsWith('/revenue-plans')).length > before)
})

test('empty backfill offers creation for the selected plan type', async () => {
  const harness = await budgetEntryHarness()
  harness.switchKind('backfill')
  await harness.settle()
  const type = clientNodes(harness.render()).find(node => node.type?.name === 'Select' && node.props.value === 'payment')
  type.props.onChange('revenue')
  await harness.settle()
  const create = clientNodes(harness.render()).find(node => node.type?.name === 'LinkButton' && node.children.includes('createRevenuePlan'))
  assert.ok(create)
  create.props.onClick()
  assert.equal(clientNodes(harness.render()).find(node => node.type?.name === 'PillTabs').props.value, 'revenue')
})

test('direct-entry amounts render business labels rather than unresolved translation keys', async () => {
  const head = await readFile(new URL('src/head.js', root), 'utf8')
  const dictionary = head.slice(head.indexOf('const copy ='), head.indexOf('\n// ---- 打开/关闭状态'))
  const copy = new Function(dictionary + '\nreturn copy')()
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/entry.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/members.js', root), 'utf8')
  for (const [locale, expected] of [['zh', '计划金额（元） *'], ['en', 'Planned amount（CNY） *']]) {
    const harness = clientHarness(source, 'EntryPanel')
    const props = { year: 2026, orgs: [], departments: [], t: key => copy[locale][key] ?? key }
    for (const kind of ['payment', 'revenue']) {
      clientNodes(harness.render(props)).find(node => node.type?.name === 'PillTabs').props.onChange(kind)
      assert.ok(clientNodes(harness.render(props)).some(node => node.type?.name === 'FormRow' && node.props.label === expected))
    }
  }
})

test('cash plan columns translate actual, remaining and variance amounts', async () => {
  const head = await readFile(new URL('src/head.js', root), 'utf8')
  const copy = new Function(head.slice(head.indexOf('const copy ='), head.indexOf('\n// ---- 打开/关闭状态')) + '\nreturn copy')()
  const source = (await Promise.all(['src/components.js', 'src/format.js', 'src/views/cash.js'].map(file => readFile(new URL(file, root), 'utf8')))).join('\n')
  for (const [component, props, expected] of [
    ['PlansTab', { rows: [], page: 1 }, ['计划金额', '实际金额', '剩余金额']],
    ['RevenueTab', { revenues: { list: [] }, page: 1 }, ['计划金额', '实际金额', '差额']],
  ]) {
    const harness = clientHarness(source, component, { PAGE_SIZE: 20 })
    const tree = harness.render({ ...props, t: key => copy.zh[key] ?? key, onPage() {} })
    const table = clientNodes(tree).find(node => node.type?.name === 'Table')
    for (const label of expected) assert.ok(table.props.columns.some(column => column.label === label), component + ': ' + label)
  }
})

test('button custom picker exposes pending drafts to the form until explicitly confirmed', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8')
  const harness = clientHarness(source, 'SearchSelect')
  const props = { name: 'payerNameChoice', buttonTrigger: true, allowCustom: true, preserveDraft: true, options: [], placeholder: '付款方' }
  let tree = harness.render(props)
  clientNodes(tree).find(node => node.props.className === 'sf-search-trigger').props.onClick()
  tree = harness.render(props)
  clientNodes(tree).find(node => node.props.type === 'search').props.onChange({ target: { value: ' 新付款方 ' } })
  tree = harness.render(props)
  tree.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
  tree = harness.render(props)
  assert.equal(clientNodes(tree).find(node => node.props.name === 'payerNameChoiceDraft').props.value, '新付款方')
  tree.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null })
  tree = harness.render(props)
  assert.equal(clientNodes(tree).find(node => node.props.name === 'payerNameChoiceDraft')?.props.value, '新付款方')
  assert.ok(clientNodes(tree).find(node => node.props.className === 'sf-search-trigger').children.some(node => node.children?.includes('新付款方')))
  clientNodes(tree).find(node => node.props.className === 'sf-search-trigger').props.onClick()
  tree = harness.render(props)
  clientNodes(tree).find(node => node.props.role === 'option').props.onClick()
  tree = harness.render(props)
  assert.equal(clientNodes(tree).find(node => node.props.name === 'payerNameChoiceDraft').props.value, '')
  assert.equal(clientNodes(tree).find(node => node.props.name === 'payerNameChoice').props.value, '新付款方')
})

test('entry blocks unconfirmed text and clears the warning once a value is confirmed', async () => {
  const harness = await budgetEntryHarness({ values: { itemNameChoice: '收入', payerNameChoiceDraft: '未确认付款方', plannedAmount: '100' } })
  harness.switchKind('revenue')
  await harness.submit()
  assert.equal(harness.writes.length, 0)
  assert.equal(harness.resetCount, 0)
  const field = clientNodes(harness.render()).find(node => node.type?.name === 'CustomizableTextSelect' && node.props.name === 'payerName')
  field.props.onChange('未确认付款方')
  assert.equal(clientNodes(harness.render()).some(node => node.type?.name === 'Notice'), false)
})


test('business links retain the filing destination, task and year rather than landing on direct entry', async () => {
  const source = await readFile(new URL('src/navigation.js', root), 'utf8')
  const resolve = new Function(source + '\nreturn financeBusinessDestination')()
  assert.deepEqual(resolve('/zh-CN/data-entry?tab=tasks&task=task-1&year=2027'), { tab: 'filing', params: { section: 'assignments', taskId: 'task-1', year: '2027' } })
  assert.deepEqual(resolve('/filing/records?task=task-2&year=2026'), { tab: 'filing', params: { section: 'mine', taskId: 'task-2', year: '2026' } })
  assert.deepEqual(resolve('/budget/comparison/monthly-roll?year=2025'), { tab: 'comparisons', params: { mode: 'monthly', year: '2025' } })
  assert.equal(resolve('/budget/comparison/yearly').params.mode, 'yearly')
  assert.equal(resolve('/budget/comparison/versions').params.mode, 'versions')
  assert.equal(resolve('/data-entry').tab, 'entry')
  for (const path of ['https://outside.example/review', '//outside.example/review', '/unknown', '/budget/unknown', null, '/\\outside.example/review']) assert.equal(resolve(path), null)
  assert.deepEqual(resolve('/cash?year=NaN&org=company-1'), { tab: 'cash', params: { orgId: 'company-1' } })
})

test('navigation gives each task one destination and preserves role boundaries', async () => {
  const source = await readFile(new URL('src/workflows.js', root), 'utf8') + '\n' + await readFile(new URL('src/navigation.js', root), 'utf8')
  const { items, allowed } = new Function(source + '\nreturn { items: FINANCE_NAVIGATION.flatMap(([, items]) => items), allowed: financeNavigationAllowed }')()
  assert.equal(new Set(items.map(item => item[0])).size, items.length)
  const filler = { role: 'DEPT_FILLER', financeWriter: false, permissions: ['budget.submission.edit'] }
  const staff = { ...filler, role: 'FINANCE_STAFF', financeWriter: true }
  const find = id => items.find(item => item[0] === id)
  assert.equal(allowed(find('entry'), filler), false)
  assert.equal(allowed(find('entry'), staff), true)
  assert.equal(allowed(find('filing-tasks'), filler), true)
  assert.equal(allowed(find('filing-activities'), staff), false)
  assert.equal(allowed(find('filing-activities'), { ...staff, permissions: [...staff.permissions, 'budget.activity.manage'] }), true)
  assert.equal(allowed(find('identity-members'), staff), false)
  assert.equal(allowed(find('identity-members'), { ...staff, role: 'FINANCE_OWNER' }), true)
})

test('filing destinations load their own context without mounting direct entry or identity maintenance', async () => {
  const source = await readFile(new URL('src/views/filing.js', root), 'utf8')
  for (const section of ['assignments', 'department', 'mine', 'tasks']) {
    const paths = []
    const harness = clientHarness(source, 'FilingParityView', {
      useFinanceAction: () => ({ revision: 0 }),
      useFinanceResource: path => { paths.push(path); return { data: { list: [] } } },
      financeRows: data => data?.list || [], financeColumns: () => [],
      FinanceResource() {}, KpiCard() {}, Select() {}, GhostButton() {}, Notice() {}, Card() {}, Table() {}, Pager() {},
    })
    const tree = harness.render({ ctx: { year: '2027', role: 'FINANCE_OWNER', financeWriter: true, permissions: ['budget.activity.manage'], departments: [], drillParams: { section, taskId: 'task-1' } }, t: key => key })
    assert.ok(!clientNodes(tree).some(node => ['EntryPanel', 'EntryView'].includes(node.type?.name)))
    assert.ok(paths.some(path => path?.includes(section === 'tasks' ? '/filing/tasks?' : '/filing/assignments?')))
    if (section !== 'tasks') assert.ok(paths.some(path => path?.includes('taskId=task-1')))
    if (section === 'mine') assert.ok(paths.some(path => path?.includes('submittedByMe=true')))
  }
})

test('cost category creation locks duplicate requests, preserves errors and prevents parent submission on Enter', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/entry.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/members.js', root), 'utf8')
  const writes = [], created = []
  let reject
  const harness = clientHarness(source, 'CostItemCreator', { financeRest: (...args) => { writes.push(args); return new Promise((resolve, failure) => { reject = failure }) } })
  const props = { t: key => key, onCreated: item => created.push(item) }
  let tree = harness.render(props)
  const fields = clientNodes(tree).filter(node => node.type?.name === 'Field')
  fields[0].props.onChange(' TRAVEL '); fields[1].props.onChange(' 差旅费 ')
  tree = harness.render(props)
  const save = clientNodes(tree).find(node => node.type?.name === 'PrimaryButton').props.onClick
  const pending = save(); await save()
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0], ['/finance/cost-items', 'POST', { code: 'TRAVEL', name: '差旅费' }])
  reject(new Error('编号已存在')); await pending
  tree = harness.render(props)
  assert.ok(clientNodes(tree).some(node => node.props.role === 'alert' && node.children.includes('编号已存在')))
  assert.equal(clientNodes(tree).find(node => node.type?.name === 'Field').props.value, ' TRAVEL ')
  let prevented = false
  tree.props.onKeyDown({ key: 'Enter', target: { tagName: 'INPUT' }, nativeEvent: { isComposing: true }, preventDefault() { prevented = true } })
  assert.equal(prevented, true)
  assert.equal(writes.length, 1)
  assert.equal(created.length, 0)
})

test('backfill labels expose the same identifying dimensions as the web', async () => {
  const source = await readFile(new URL('src/views/entry.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/members.js', root), 'utf8')
  const label = new Function(source + '\nreturn financePlanOptionLabel')()
  assert.equal(label({ id: 'abcdef01-1', description: '设备款', orgName: '甲公司', year: 2026, planMonth: 6, plannedAmount: 1250.5 }, 'payment'), '设备款 · 甲公司 · 2026年6月 · 计划 ¥1,250.50 · #abcdef01')
  assert.match(label({ id: 'revenue1', year: 2026, plannedAmount: 0 }, 'revenue'), /年度（不分月） · 计划 ¥0.00/)
})


test('payment plan detail shows the saved actual payment date', async () => {
  const source = (await Promise.all(['src/components.js', 'src/format.js', 'src/views/cash.js', 'src/views/cash-evidence.js'].map(file => readFile(new URL(file, root), 'utf8')))).join('\n')
  const harness = clientHarness(source, 'PlanDetailDialog', { PLAN_LABELS: {}, financeEnumLabel: value => value, financeDisplayValue: value => value })
  const tree = harness.render({ plan: { planType: 'OTHER', actualPaidAt: '2026-11-11T16:00:00.000Z' }, ctx: { financeWriter: false, permissions: [] }, t: key => key, onClose() {} })
  assert.ok(clientNodes(tree).some(node => node.children.includes('2026-11-12')))
  const empty = harness.render({ plan: { planType: 'OTHER', actualPaidAt: null }, ctx: { financeWriter: false, permissions: [] }, t: key => key, onClose() {} })
  assert.ok(clientNodes(empty).some(node => node.children.includes('actualPaidDate')))
})

test('closing payment remainder requires a reason, retains failure input and closes only on success', async () => {
  const source = (await Promise.all(['src/components.js', 'src/format.js', 'src/views/cash.js'].map(file => readFile(new URL(file, root), 'utf8')))).join('\n')
  const harness = clientHarness(source, 'CloseRemainingDialog')
  const writes = []; let closed = 0; let saved = false
  const props = { plan: { id: 'p1', remainingAmount: 99000 }, t: key => key, busy: false,
    onClose: () => closed++, act: async (...args) => { writes.push(args); return saved } }
  let tree = harness.render(props)
  assert.equal(tree.props.footer[1].props.disabled, true)
  clientNodes(tree).find(node => node.type?.name === 'Textarea').props.onChange('合同结算完成')
  tree = harness.render(props)
  await tree.props.footer[1].props.onClick()
  assert.deepEqual(writes[0], ['/rest/finance/payment-plans/p1/close-remaining', { reason: '合同结算完成' }])
  assert.equal(closed, 0)
  assert.equal(clientNodes(harness.render(props)).find(node => node.type?.name === 'Textarea').props.value, '合同结算完成')
  tree = harness.render({ ...props, busy: true })
  assert.equal(tree.props.footer[1].props.disabled, true)
  saved = true
  tree = harness.render(props)
  await tree.props.footer[1].props.onClick()
  assert.equal(closed, 1)
})

test('only finance writers can close a positive, open payment remainder', async () => {
  const source = (await Promise.all(['src/components.js', 'src/format.js', 'src/views/cash.js'].map(file => readFile(new URL(file, root), 'utf8')))).join('\n')
  for (const [canWrite, row, expected] of [
    [true, { remainingAmount: 99000, status: '部分支付' }, true],
    [false, { remainingAmount: 99000 }, false],
    [true, { remainingAmount: 0 }, false],
    [true, { remainingAmount: 99000, status: '剩余不再执行' }, false],
  ]) {
    const harness = clientHarness(source, 'PlansTab', { PAGE_SIZE: 20 })
    const tree = harness.render({ rows: [row], canWrite, t: key => key, onPage() {} })
    const table = clientNodes(tree).find(node => node.type?.name === 'Table')
    const actions = table.props.columns.find(column => column.key === 'actions').render(row)
    assert.equal(clientNodes(actions).some(node => node.children.includes('closeRemaining')), expected)
  }
})

test('changing backfill plan type resets the plan, amount and date together', async () => {
  const harness = await budgetEntryHarness()
  harness.switchKind('backfill')
  const before = harness.render()
  clientNodes(before).find(node => node.type?.name === 'Select' && node.props.value === 'payment').props.onChange('revenue')
  const after = harness.render()
  assert.notEqual(after.props.key, before.props.key, 'uncontrolled inputs must remount together')
  assert.equal(clientNodes(after).find(node => node.type?.name === 'Select' && node.props.value === 'revenue').props.value, 'revenue')
})

test('public close-remaining forwards only the new product action and preserves denial', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => {
    calls.push({ url: String(url), init }); return mcpJson({}, 403)
  } })
  const result = await invokeRoute(routes.get(BASE), 'POST', BASE + '/rest/finance/payment-plans/p1/close-remaining', { reason: '合同结算完成' }, { 'content-type': 'application/json' })
  assert.equal(result.status, 403)
  const call = calls.at(-1)
  assert.equal(new URL(call.url).pathname, '/api/finance/payment-plans/p1/close-remaining')
  assert.equal(call.init.method, 'POST')
  assert.equal(JSON.parse(call.init.body).reason, '合同结算完成')
})

test('budget receipt navigates to the saved year and exact record and never shows another row', async () => {
  const source = await readFile(new URL('src/views/configured-entry.js', root), 'utf8')
  const navigations = []
  const line = { id: 'record-1', year: 2027, budgetAmount: 1250.5 }
  const receipt = clientHarness(source, 'BudgetSaveReceipt', { LinkButton() {} })
  const tree = receipt.render({ line, onNavigate: (...args) => navigations.push(args) })
  clientNodes(tree).find(node => node.children.includes('查看刚保存的预算行')).props.onClick()
  assert.deepEqual(navigations[0], ['budget', { view: 'lines', year: '2027', lineId: 'record-1' }])
  const paths = []
  const record = clientHarness(source, 'BudgetSavedRecordView', {
    useFinanceResource: path => { paths.push(path); return { data: { list: [{ id: 'wrong-record' }, line] } } },
    financeRows: data => data.list, financeColumns: () => [], LinkButton() {}, FinanceResource() {}, Card() {}, Table() {},
  })
  const detail = record.render({ ctx: { year: '2027', revision: 0, drillParams: { lineId: 'record-1' } } })
  assert.match(paths[0], /year=2027&lineId=record-1/)
  assert.deepEqual(clientNodes(detail).find(node => node.type?.name === 'Table').props.rows, [line])
})

test('budget filing uses the web destination and the public row workflow instead of the generic assignment editor', async () => {
  const navigation = await readFile(new URL('src/navigation.js', root), 'utf8')
  const destination = new Function(navigation + '\nreturn financeBusinessDestination')()
  assert.deepEqual(destination('/filing/budget?year=2027&task=11111111-1111-4111-8111-111111111111'), { tab: 'budget-filing', params: { year: '2027', taskId: '11111111-1111-4111-8111-111111111111' } })
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => { calls.push({ url: String(url), init }); return mcpJson({ id: 'row-1' }) } })
  for (const [method, path, body] of [
    ['GET', '/finance/budget-filing?year=2027&taskId=task-1', null],
    ['GET', '/finance/feishu/organization-directory', null],
    ['POST', '/finance/budget-filing/as-1/rows', { action: 'SAVE', row: { plannedAmount: 10 } }],
    ['POST', '/finance/budget-filing/as-1/department', { action: 'SUBMIT' }],
    ['POST', '/finance/budget-filing/tasks/task-1/copy', { title: '第二轮', reason: '调整' }],
  ]) {
    assert.equal((await invokeRoute(routes.get(BASE), method, BASE + '/rest' + path, body, { 'content-type': 'application/json' })).status, 200)
    assert.equal(new URL(calls.at(-1).url).pathname, '/api' + path.split('?')[0])
  }
})

test('budget row form rejects stale categories, invalid months and monetary precision before saving', async () => {
  const source = await readFile(new URL('src/views/budget-filing.js', root), 'utf8')
  const parse = new Function(source + '\nreturn financeBudgetRowBody')()
  const value = { costItemId: 'c1', month: '12', plannedAmount: '1250.50', description: '  设备升级  ' }
  assert.deepEqual(parse(value, [{ id: 'c1' }]), { costItemId: 'c1', month: 12, plannedAmount: 1250.5, description: '设备升级' })
  for (const patch of [{ costItemId: 'stale' }, { month: 13 }, { month: 1.5 }, { plannedAmount: '' }, { plannedAmount: 0 }, { plannedAmount: '1.00001' }, { plannedAmount: 1e12 }, { description: '  ' }]) assert.throws(() => parse({ ...value, ...patch }, [{ id: 'c1' }]))
})

test('budget card only offers server-approved actions and carries the row revision to review', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/budget-filing.js', root), 'utf8')
  const writes = [], notices = []
  const harness = clientHarness(source, 'BudgetFilingCard', { useFinanceAction: () => ({ run: async (path, body) => { writes.push({ path, body }); return { id: 'r1' } }, report: message => notices.push(message) }) })
  const props = { card: { id: 'a1', taskId: 't1', title: '预算', departmentActions: [], canCreate: false, rows: [{ id: 'r1', revision: 7, reviewStatus: 'INITIAL_REVIEW', actions: ['INITIAL_APPROVE'], plannedAmount: 10, month: 1 }] }, costItems: [], onRefresh: message => notices.push(message) }
  const tree = harness.render(props)
  const buttons = clientNodes(tree).filter(node => node.type?.name === 'GhostButton')
  assert.deepEqual(buttons.map(node => node.children.join('')), ['初审通过'])
  await buttons[0].props.onClick()
  assert.deepEqual(writes, [{ path: '/finance/budget-filing/a1/rows', body: { action: 'INITIAL_APPROVE', rowId: 'r1', revision: 7 } }])
  assert.ok(notices.includes('条目进度已更新'))
})

test('budget rejection retains the entered reason after failure and locks immediate duplicate confirmation', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/budget-filing.js', root), 'utf8')
  let rejectWrite, writes = 0
  const harness = clientHarness(source, 'BudgetFilingDecisionDialog')
  const props = { decision: { action: 'REJECT', row: { id: 'r1' } }, onClose() {}, onSave: () => { writes++; return new Promise((resolve, reject) => { rejectWrite = reject }) } }
  let tree = harness.render(props)
  clientNodes(tree).find(node => node.type?.name === 'Textarea').props.onChange('请补充依据')
  tree = harness.render(props)
  const confirm = tree.props.footer.find(node => node.props.key === 'confirm').props.onClick
  const pending = confirm()
  await confirm()
  assert.equal(writes, 1)
  tree = harness.render(props)
  assert.equal(tree.props.dismissDisabled, true)
  rejectWrite(new Error('记录版本已变更，请刷新核对'))
  await pending
  tree = harness.render(props)
  assert.equal(clientNodes(tree).find(node => node.type?.name === 'Textarea').props.value, '请补充依据')
  assert.ok(clientNodes(tree).some(node => node.props.role === 'alert' && node.children.includes('记录版本已变更，请刷新核对')))
  assert.equal(tree.props.dismissDisabled, false)
})

test('budget draft save preserves fields after a denial and cannot be sent twice before a rerender', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/budget-filing.js', root), 'utf8')
  let writes = 0, rejectWrite
  const harness = clientHarness(source, 'BudgetFilingRowDialog')
  const props = { card: { year: 2027, title: '年度', departmentName: '研发部' }, row: { id: 'r1', revision: 3, costItemId: 'c1', month: 2, plannedAmount: 25.5, description: '试验费用' }, costItems: [{ id: 'c1', name: '材料' }], onClose() {}, onSave: () => { writes++; return new Promise((resolve, reject) => { rejectWrite = reject }) } }
  let tree = harness.render(props)
  const form = clientNodes(tree).find(node => node.type === 'form')
  const pending = form.props.onSubmit({ preventDefault() {} })
  await form.props.onSubmit({ preventDefault() {} })
  assert.equal(writes, 1)
  rejectWrite(new Error('填报窗口已关闭'))
  await pending
  tree = harness.render(props)
  assert.equal(clientNodes(tree).find(node => node.type?.name === 'Field' && node.props['aria-label'] === '金额（元）').props.value, '25.5')
  assert.ok(clientNodes(tree).some(node => node.props.role === 'alert' && node.children.includes('填报窗口已关闭')))
})

test('busy dialogs cannot be dismissed by Escape, backdrop or the close button', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8')
  let closed = 0
  const harness = clientHarness(source, 'Dialog')
  const tree = harness.render({ title: '保存中', dismissDisabled: true, onClose: () => closed++ })
  tree.props.onMouseDown({ target: 1, currentTarget: 1 })
  const panel = clientNodes(tree).find(node => node.props.role === 'dialog')
  panel.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
  assert.equal(closed, 0)
  assert.equal(clientNodes(tree).find(node => node.props['aria-label'] === '关闭').props.disabled, true)
})

test('business links preserve cash subpages and PR types so the same link opens the same content', async () => {
  const source = await readFile(new URL('src/navigation.js', root), 'utf8')
  const resolve = new Function(source + '\nreturn financeBusinessDestination')()
  assert.deepEqual(resolve('/cash?tab=revenue&year=2027&org=company-1'), { tab: 'cash', params: { view: 'revenue', year: '2027', orgId: 'company-1' } })
  assert.deepEqual(resolve('/budget?view=ledger&recordType=ESTIMATED&month=10&year=2027'), { tab: 'budget', params: { view: 'ledger', recordType: 'ESTIMATED', month: '10', year: '2027' } })
  assert.deepEqual(resolve('/alerts?status=RESOLVED&severity=WARN'), { tab: 'alerts', params: { status: 'RESOLVED', severity: 'WARN' } })
  assert.equal(resolve('/filing/budget?task=broken'), null)
  assert.deepEqual(resolve('/cash?tab=arbitrary&month=99'), { tab: 'cash', params: {} })
  assert.deepEqual(resolve('/cash?tab=accuracy&year=2027&org=company-1'), { tab: 'cash', params: { view: 'accuracy', year: '2027', orgId: 'company-1' } })
  // 旧资金审批链接迁移：调整审批入口收敛到审核队列的付款计划调整类别
  assert.deepEqual(resolve('/cash?tab=adjustments'), { tab: 'review', params: { section: 'plans' } })
})

test('execution rate follows the web submitted-PR basis and never treats an unknown amount as zero', async () => {
  const source = await readFile(new URL('src/format.js', root), 'utf8')
  const rate = new Function(source + '\nreturn execRateOf')()
  assert.equal(rate(50, 20, 100), 0.5)
  assert.equal(rate(0, 20, 100), 0)
  assert.equal(rate(null, 20, 100), null)
  assert.equal(rate(50, 20, 0), null)
})

test('ledger and cash requests preserve the dimensions supplied by a business link', async () => {
  const components = await readFile(new URL('src/components.js', root), 'utf8')
  const format = await readFile(new URL('src/format.js', root), 'utf8')
  const ctx = { year: '2027', orgId: 'org-1', orgs: [], departments: [], revision: 0, financeWriter: false, permissions: [], drillParams: { view: 'ledger', month: '10', recordType: 'ESTIMATED' } }
  const requests = []
  const budget = clientHarness(components + '\n' + format + '\n' + await readFile(new URL('src/views/budget.js', root), 'utf8'), 'BudgetView', {
    api: async path => { requests.push(path); return { data: { list: [] } } }, PAGE_SIZE: 20, BUDGET_LINE_LIMIT: 200,
  })
  budget.render({ ctx, t: key => key }); budget.flushEffects()
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(requests.some(path => path.startsWith('/pr?') && path.includes('recordType=ESTIMATED') && path.includes('month=10') && path.includes('orgId=org-1')))
  const cash = clientHarness(components + '\n' + await readFile(new URL('src/views/cash.js', root), 'utf8'), 'CashView', {
    api: async path => { requests.push(path); return { data: { list: [] } } }, PAGE_SIZE: 20,
  })
  cash.render({ ctx: { ...ctx, drillParams: { view: 'revenue' } }, t: key => key }); cash.flushEffects()
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(requests.some(path => path.startsWith('/revenue-plans?year=2027&orgId=org-1')))
})

test('bootstrap and public CE evidence read every page', async () => {
  const rows=Array.from({length:201},(_,i)=>({id:String(i),name:'主体'+i}))
  const calls=[]
  const {routes,tools}=await loadHost({fetch:async url=>{
    const u=new URL(url); calls.push(u)
    const page=Number(u.searchParams.get('page')||1), limit=Number(u.searchParams.get('limit')||200)
    return mcpJson({list:rows.slice((page-1)*limit,page*limit),total:201,page,limit})
  }})
  const bootstrap=await tools.get('sensteed_finance_bootstrap').execute({})
  assert.equal(bootstrap.ok,true)
  assert.equal(bootstrap.result.orgs.length,201)
  const result=await invokeRoute(routes.get(BASE),'GET',BASE+'/rest/ce/packages/p/quotes')
  assert.equal(result.status,200)
  assert.equal(result.body.data.list.length,201)
  assert.equal(calls.filter(u=>u.pathname.endsWith('/quotes')).length,2)
})
test('public later-page denial never returns partial evidence',async()=>{
  const rows=Array.from({length:200},(_,i)=>({id:String(i)}))
  const {routes}=await loadHost({fetch:async url=>new URL(url).searchParams.get('page')==='2' ? mcpJson({},403) : mcpJson({list:rows,total:201,page:1,limit:200})})
  const result=await invokeRoute(routes.get(BASE),'GET',BASE+'/rest/ce/packages/p/quotes')
  assert.equal(result.body.ok,false)
  assert.equal(result.body.data,undefined)
})

test('every entry year routes budget work into reviewed drafts without requesting published versions or posting formal lines', async () => {
  const harness = await budgetEntryHarness()
  let tree = harness.render()
  assert.equal(tree.type, 'div')
  assert.ok(!clientNodes(tree).some(node => node.props.name === 'budgetAmount'))
  assert.equal(harness.reads.some(path => path.startsWith('/budget-versions')), false)
  clientNodes(tree).find(node => node.props.name === 'year').props.onChange('2027')
  tree = harness.render()
  assert.equal(clientNodes(tree).find(node => node.type?.name === 'ConfiguredBudgetEntry').props.year, '2027')
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/configured-entry.js', root), 'utf8')
  const navigations = []
  const panel = clientHarness(source, 'ConfiguredBudgetEntry')
  for (const year of ['2026', '2027', '2028']) {
    const result = panel.render({ year, onNavigate: (...args) => navigations.push(args) })
    const links = clientNodes(result).filter(node => node.type?.name === 'LinkButton')
    links.forEach(link => link.props.onClick())
    assert.deepEqual(navigations.slice(-2), [['budget-filing', { year, }], ['budget', { year, view: 'adjustments' }]])
    assert.equal(clientNodes(result).some(node => node.type === 'form'), false)
  }
  assert.equal(harness.writes.length, 0)
})

test('budget notification links retain version and reject invalid scoped identifiers', async () => {
  const source = await readFile(new URL('src/navigation.js', root), 'utf8')
  const destination = new Function(source + '\nreturn financeBusinessDestination')()
  const versionId = '33333333-3333-4333-8333-333333333333'
  assert.deepEqual(destination(`/filing/budget?year=2027&version=${versionId}`), { tab: 'budget-filing', params: { year: '2027', versionId } })
  assert.equal(destination('/filing/budget?version=broken'), null)
  assert.equal(destination('/filing/budget?version='), null)
  assert.deepEqual(destination('/budget?year=2027&view=adjustments'), { tab: 'budget', params: { year: '2027', view: 'adjustments' } })
})

test('budget filing queries the accessible versions and preserves linked scope while resolving an older year', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/budget-filing.js', root), 'utf8')
  const paths = [], navigations = []
  const versionId = '33333333-3333-4333-8333-333333333333'
  const harness = clientHarness(source, 'BudgetFilingView', {
    financeLabel: value => value, financeRows: data => data?.list || [], BudgetFilingCard() {}, FinanceResource() {},
    useFinanceResource: path => { paths.push(path); return { data: path.includes('/versions?') ? { list: [], total: 0 } : { list: [{ id: 'a1', year: 2026 }], total: 1 }, retry() {} } },
  })
  const ctx = { year: '2027', drillParams: { versionId }, onNavigate: (...args) => navigations.push(args) }
  const tree = harness.render({ ctx })
  harness.flushEffects()
  assert.match(paths[0], new RegExp('versionId=' + versionId))
  assert.ok(paths.every(path => !path.includes('year=')))
  assert.deepEqual(navigations[0], ['budget-filing', { versionId, year: '2026' }])
  clientNodes(tree).find(node => node.props['aria-label'] === '预算版本').props.onChange('another')
  assert.deepEqual(navigations.at(-1), ['budget-filing', { year: '2027', versionId: 'another' }])
})

test('configured filing uses the card snapshot, resets dependent mappings and retains failed amounts', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/budget-filing.js', root), 'utf8')
  const writes = []
  const card = { year: 2027, configurationRequired: true, configurationImported: true, expenseMappings: [{ code: 'mapping-a', costItemId: 'c1', level1Name: '研发', level2Name: '试验材料', expenseType: 'MODEL_SPECIFIC', sourceCode: 'A1' }, { code: 'mapping-b', costItemId: 'c2', level1Name: '管理', level2Name: '差旅', expenseType: 'FIXED_OPERATION', sourceCode: 'B1' }] }
  const harness = clientHarness(source, 'BudgetFilingRowDialog', { financeLabel: value => value })
  const props = { card, costItems: [], onSave: async body => { writes.push(body); throw new Error('当前活动已截止') } }
  const render = () => harness.render(props)
  const picker = label => clientNodes(render()).find(node => node.props['aria-label'] === label)
  assert.equal(picker('费用科目与分类').props.disabled, true)
  picker('一级费用类别').props.onChange('研发')
  picker('费用科目与分类').props.onChange('mapping-a')
  picker('金额（元）').props.onChange('1250.50')
  picker('编制说明').props.onChange('样件试验')
  await clientNodes(render()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  assert.deepEqual(writes[0].row, { costItemId: 'c1', expenseMappingCode: 'mapping-a', month: 1, plannedAmount: 1250.5, description: '样件试验' })
  assert.equal(picker('金额（元）').props.value, '1250.50')
  assert.ok(clientNodes(render()).some(node => node.props.role === 'alert' && node.children.includes('当前活动已截止')))
  picker('一级费用类别').props.onChange('管理')
  assert.equal(picker('费用科目与分类').props.value, '')
  await clientNodes(render()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  assert.equal(writes.length, 1)
  const parse = new Function(source + '\nreturn financeBudgetRowBody')()
  assert.throws(() => parse({ costItemId: 'c1', expenseMappingCode: 'mapping-b' }, [{ id: 'c1' }], card))
  assert.throws(() => parse({ costItemId: 'c1', expenseMappingCode: 'mapping-a' }, [], { ...card, configurationImported: false }))
})

test('budget Excel routes preserve preview fingerprints and only expose exact public endpoints', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => { calls.push({ url: String(url), body: init.body }); return mcpJson({ id: 'a1' }) } })
  const body = { fileName: '预算.xlsx', contentBase64: 'ZGF0YQ==', previewFingerprint: 'a'.repeat(64) }
  for (const [method, path] of [['GET', '/finance/budget-filing/versions?year=2027&page=2&limit=100'], ['GET', '/finance/budget-filing/a1/history?page=2&limit=20'], ...['template', 'preview', 'import'].map(action => ['POST', `/finance/budget-filing/a1/excel/${action}`])]) {
    const result = await invokeRoute(routes.get(BASE), method, BASE + '/rest' + path, method === 'GET' ? null : body, { 'content-type': 'application/json' })
    assert.equal(result.status, 200)
    assert.equal(new URL(calls.at(-1).url).pathname, '/api' + path.split('?')[0])
    if (path.endsWith('/import')) assert.equal(JSON.parse(calls.at(-1).body).previewFingerprint, body.previewFingerprint)
  }
  const before = calls.length
  const denied = await invokeRoute(routes.get(BASE), 'POST', BASE + '/rest/finance/budget-filing/a1/excel/execute', body, { 'content-type': 'application/json' })
  assert.equal(denied.status, 404)
  assert.equal(calls.length, before)
})

test('budget Excel requires whole-file preview, preserves failed import and locks duplicate clicks', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/budget-excel.js', root), 'utf8')
  const writes = [], notices = []
  let rejectSave
  const preview = { fingerprint: 'a'.repeat(64), errors: [], rows: [{ costItemId: 'c1', month: 1, plannedAmount: 20, description: '试验' }], totalAmount: 20 }
  class Reader { readAsDataURL() { this.result = 'data:application/octet-stream;base64,ZGF0YQ=='; this.onload() } }
  const harness = clientHarness(source, 'BudgetFilingExcel', { FileReader: Reader, budgetFilingMoney: String, financeRest: async (path, method, body) => { writes.push({ path, method, body }); if (path.endsWith('/preview')) return { data: preview }; return new Promise((resolve, reject) => { rejectSave = reject }) } })
  const props = { card: { id: 'a1' }, costItems: [{ id: 'c1', name: '试验材料' }], onRefresh: text => notices.push(text) }
  const render = () => harness.render(props)
  const upload = async () => clientNodes(render()).find(node => node.type === 'input').props.onChange({ target: { files: [{ name: '预算.xlsx', size: 4 }], value: '' } })
  await upload(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(writes.length, 1)
  assert.ok(writes[0].path.endsWith('/preview'))
  const button = clientNodes(render()).find(node => node.type?.name === 'PrimaryButton')
  const pending = button.props.onClick(); await button.props.onClick()
  assert.equal(writes.length, 2)
  assert.equal(writes[1].body.previewFingerprint, preview.fingerprint)
  rejectSave(new Error('活动已截止')); await pending
  assert.ok(clientNodes(render()).some(node => node.props.role === 'alert' && node.children.includes('活动已截止')))
  assert.ok(clientNodes(render()).find(node => node.type?.name === 'PrimaryButton'))
  assert.equal(notices.length, 0)
  preview.errors = [{ row: 3, message: '部门不匹配' }]
  await upload(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(clientNodes(render()).some(node => node.type?.name === 'PrimaryButton'), false)
  assert.ok(clientNodes(render()).some(node => node.children.includes('第 3 行：部门不匹配')))
})

test('budget Excel rejects unsupported or oversized files before reading and blocks unconfigured departments', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/budget-excel.js', root), 'utf8')
  const file = new Function(source + '\nreturn financeBudgetExcelFile')()
  for (const value of [{ name: '预算.xls', size: 10 }, { name: '预算.xlsx', size: 0 }, { name: '预算.xlsx', size: 524289 }]) assert.throws(() => file(value))
  const harness = clientHarness(source, 'BudgetFilingExcel')
  const tree = harness.render({ card: { configurationRequired: true, configurationImported: false }, costItems: [] })
  assert.equal(clientNodes(tree).find(node => node.type === 'input').props.disabled, true)
  assert.equal(clientNodes(tree).find(node => node.type?.name === 'GhostButton').props.disabled, true)
})

test('budget history paginates the authorized contract and separates missing snapshots from empty ones', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/budget-history.js', root), 'utf8')
  const paths = []
  const harness = clientHarness(source, 'BudgetFilingHistory', {
    BUDGET_FILING_STAGES: {}, budgetFilingMoney: String, financeRows: data => data.list, FinanceResource() {},
    useFinanceResource: path => { paths.push(path); return { data: { total: 25, roundChanges: [], list: [{ id: 'old', actorName: '财务', at: '2026-10-01', action: 'SAVE', snapshotAvailable: false }, { id: 'new', actorName: '财务', at: '2026-10-02', action: 'SUBMIT', snapshotAvailable: true, before: [], after: [] }] } } },
  })
  let tree = harness.render({ id: 'a1' })
  assert.equal(clientNodes(tree).filter(node => node.children.includes('历史记录未保存条目快照，无法还原当时明细。')).length, 1)
  clientNodes(tree).find(node => node.type?.name === 'Pager').props.onPage(2)
  tree = harness.render({ id: 'a1' })
  assert.equal(paths.at(-1), '/finance/budget-filing/a1/history?page=2&limit=20')
})

const permissionSource = async () => await readFile(new URL('src/permission-catalog.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/permissions.js', root), 'utf8')
test('complete policies replace permissions, clearing all functions clears scopes and preserves an audit reason', async () => {
  const parse = new Function(await permissionSource() + '\nreturn financePolicyRequest')()
  const people = [{ userId: 'u1' }], roles = [{ id: 'FINANCE_OWNER', enabled: true }]
  const value = { subjectType: 'USER', userIds: ['u1', 'u1'], permissions: [], scopes: [{ scopeType: 'GLOBAL' }], reason: ' 全部关闭 ' }
  assert.deepEqual(parse(value, people, roles, [], []), { path: '/finance/permission-policies/batch', body: { userIds: ['u1'], permissions: [], scopes: [], reason: '全部关闭' } })
  assert.throws(() => parse({ ...value, userIds: ['unknown'] }, people, roles, [], []), /可用成员/)
  assert.throws(() => parse({ ...value, permissions: ['cash.plan.read'], scopes: [{ scopeType: 'ORG', orgId: 'missing' }] }, people, roles, [], []), /主体/)
  assert.throws(() => parse({ ...value, permissions: ['cash.plan.read'], scopes: [{ scopeType: 'SELF', yearFrom: '2028', yearTo: '2027' }] }, people, roles, [], []), /起始年度/)
  const role = parse({ ...value, subjectType: 'ROLE', subjectId: 'FINANCE_OWNER', permissions: ['cash.plan.read'], scopes: [{ scopeType: 'SELF', yearFrom: '2027' }] }, people, roles, [], [])
  assert.equal(role.path, '/finance/permission-policies'); assert.equal(role.body.subjectType, 'ROLE'); assert.equal(role.body.scopes[0].yearFrom, 2027)
})
test('department member snapshot includes descendants, deduplicates and excludes disabled or unbound identities without looping on cycles', async () => {
  const select = new Function(await permissionSource() + '\nreturn financePolicyDepartmentPeople')()
  const directory = { departments: [{ id: 'a', parentId: 'c' }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'b' }], members: [{ userId: 'u1', departmentIds: ['a', 'b'] }, { userId: 'u2', departmentIds: ['c'] }, { userId: 'off', departmentIds: ['b'], identityEnabled: false }, { userId: 'local', departmentIds: ['b'], source: 'LOCAL_MIRROR' }, { departmentIds: ['b'] }] }
  assert.deepEqual(select(directory, ['a']), ['u1', 'u2'])
})
test('permission replacement invalidates confirmation when ranges change and retains failed input while locking double submission', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await permissionSource()
  let reject, calls = []
  const harness = clientHarness(source, 'FinancePolicyDialog')
  const props = { initialTab: 'USER', people: [{ userId: 'u1', name: '测试成员' }], roles: [], directory: { departments: [] }, orgs: [], departments: [], onSave: body => { calls.push(body); return new Promise((resolve, fail) => { reject = fail }) } }
  const render = () => harness.render(props), nodes = () => clientNodes(render())
  nodes().find(node => node.props.placeholder === '选择成员').props.onChange(['u1'])
  nodes().find(node => node.props.placeholder === '选择功能权限').props.onChange(['cash.plan.read'])
  nodes().find(node => node.props['aria-label'] === '变更原因').props.onChange('复核范围')
  const confirm = () => nodes().find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } })
  confirm()
  nodes().find(node => node.props['aria-label'] === '起始年度 1').props.onChange('2027')
  const submit = () => nodes().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await submit(); assert.equal(calls.length, 0)
  confirm(); const pending = submit(); await submit(); assert.equal(calls.length, 1)
  reject(new Error('成员状态已变化')); await pending
  assert.equal(nodes().find(node => node.props['aria-label'] === '变更原因').props.value, '复核范围')
  assert.ok(nodes().some(node => node.props.role === 'alert' && node.children.includes('成员状态已变化')))
})
test('policy management follows effective permission even on custom roles and never offers additive grants', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await permissionSource()
  const paths = []
  const harness = clientHarness(source, 'PermissionsView', { useFinanceAction: () => ({ revision: 0 }), useFinanceResource: path => { paths.push(path); return { data: { list: [] } } }, financeRows: data => data?.list || [], FinanceResource() {}, FinanceEvidence() {} })
  const tree = harness.render({ ctx: { role: 'custom-role', permissions: ['finance.permission.manage'], orgs: [], departments: [] } })
  assert.ok(paths.includes('/finance/permission-policies'))
  assert.ok(paths.includes('/finance/permissions/organization-directory'))
  assert.equal(paths.includes('/finance/permissions'), false)
  assert.ok(clientNodes(tree).some(node => node.props.title === '功能与数据权限' && node.props.actions?.[0]?.children.includes('配置完整权限')))
})
test('policy replacement and role management expose exact public contracts including PUT and retain empty arrays', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => { calls.push({ url: String(url), init }); return mcpJson({ list: [], total: 0, page: 1, limit: 200 }) } })
  const body = { userIds: ['u1'], permissions: [], scopes: [], reason: '撤回权限' }
  for (const [method, path] of [['GET', '/finance/permission-policies'], ['GET', '/finance/access-roles'], ['GET', '/finance/permissions/organization-directory'], ['PUT', '/finance/permission-policies/batch'], ['PUT', '/finance/permission-policies'], ['POST', '/finance/permission-policies/p1/remove'], ['POST', '/finance/access-roles'], ['PUT', '/finance/access-roles/r1'], ['POST', '/finance/access-roles/r1/remove'], ['POST', '/finance/member-roles/batch']]) {
    const response = await invokeRoute(routes.get(BASE), method, BASE + '/rest' + path, method === 'GET' ? null : body, { 'content-type': 'application/json' })
    assert.equal(response.status, 200, method + path)
    assert.equal(new URL(calls.at(-1).url).pathname, '/api' + path)
    if (method === 'PUT') assert.deepEqual(JSON.parse(calls.at(-1).init.body), body)
  }
})

test('512 KB Excel fits the exact upload body limit without expanding ordinary finance write limits', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => { calls.push(String(url)); return mcpJson({ id: 'preview' }) } })
  const file = { fileName: '预算.xlsx', contentBase64: Buffer.alloc(512 * 1024).toString('base64') }
  for (const action of ['preview', 'import']) {
    const result = await invokeRoute(routes.get(BASE), 'POST', BASE + '/rest/finance/budget-filing/a1/excel/' + action, { ...file, previewFingerprint: 'a'.repeat(64) }, { 'content-type': 'application/json' })
    assert.equal(result.status, 200)
  }
  const before = calls.length
  for (const [path, body] of [['/finance/payment-plans', file], ['/finance/budget-filing/a1/excel/import', { ...file, contentBase64: 'a'.repeat(800 * 1024) }]]) {
    const result = await invokeRoute(routes.get(BASE), 'POST', BASE + '/rest' + path, body, { 'content-type': 'application/json' })
    assert.equal(result.status, 400)
    assert.equal(result.body.error, 'body too large')
  }
  assert.equal(calls.length, before)
})

test('1 MB cash-evidence JSON fits exact upload routes without relaxing ordinary finance writes', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => { calls.push(String(url)); return mcpJson({ id: 'ok' }) } })
  const snapshot = { blob: 'a'.repeat(1100 * 1024) }
  for (const path of ['/finance/cash-evidence/snapshots', '/finance/cash-evidence/settlements']) {
    const result = await invokeRoute(routes.get(BASE), 'POST', BASE + '/rest' + path, snapshot, { 'content-type': 'application/json' })
    assert.equal(result.status, 200)
  }
  const ordinary = await invokeRoute(routes.get(BASE), 'POST', BASE + '/rest/finance/payment-plans', snapshot, { 'content-type': 'application/json' })
  assert.equal(ordinary.status, 400)
  assert.equal(ordinary.body.error, 'body too large')
  const capture = await invokeRoute(routes.get(BASE), 'POST', BASE + '/rest/finance/cash-evidence/snapshots/capture', { orgId: 'org-1', year: 2027, month: 1, currency: 'CNY', kind: 'BASELINE', note: 'x' }, { 'content-type': 'application/json' })
  assert.equal(capture.status, 200)
  const accuracy = await invokeRoute(routes.get(BASE), 'GET', BASE + '/rest/finance/cash-evidence/accuracy?baselineId=a&executionId=b&page=1&limit=20')
  assert.equal(accuracy.status, 200)
})

test('role assignment accepts finance-disabled identities but never disabled SSO identities or local mirrors', async () => {
  const source = await permissionSource() + '\n' + await readFile(new URL('src/views/members.js', root), 'utf8')
  const { people, select, body } = new Function(source + '\nreturn { people: financePolicyPeople, select: financePolicyDepartmentPeople, body: financeMemberRoleBody }')()
  const directory = { departments: [{ id: 'a' }, { id: 'b', parentId: 'a' }], members: [
    { userId: 'active', enabled: true, identityEnabled: true, departmentIds: ['a'] },
    { userId: 'reactivate', enabled: false, identityEnabled: true, departmentIds: ['b'] },
    { userId: 'blocked', enabled: true, identityEnabled: false, departmentIds: ['b'] },
    { userId: 'mirror', enabled: true, identityEnabled: true, source: 'LOCAL_MIRROR', departmentIds: ['b'] },
    { userId: null, enabled: true, departmentIds: ['b'] },
  ] }
  assert.deepEqual(select(directory, ['a']), ['active'])
  assert.deepEqual(select(directory, ['a'], 'role'), ['active', 'reactivate'])
  const eligible = people(directory, 'role'), roles = [{ id: 'custom-role', name: '资金主管', enabled: true }, { id: 'disabled', enabled: false }]
  const value = { userIds: ['reactivate', 'reactivate'], role: 'custom-role', reason: ' 岗位调整 ' }
  assert.deepEqual(body(value, eligible, roles), { userIds: ['reactivate'], role: 'custom-role', reason: '岗位调整' })
  for (const patch of [{ userIds: [] }, { userIds: ['blocked'] }, { reason: '   ' }, { role: 'disabled' }, { role: 'unknown' }, { userIds: Array.from({ length: 501 }, (_, i) => String(i)) }]) assert.throws(() => body({ ...value, ...patch }, eligible, roles))
})

test('member role confirmation preserves rejected input and prevents immediate duplicate assignment and dismissal', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await permissionSource() + '\n' + await readFile(new URL('src/views/members.js', root), 'utf8')
  let reject, calls = []
  const harness = clientHarness(source, 'FinanceMemberRoleDialog')
  const props = { initial: { userIds: ['u1'], role: 'custom' }, people: [{ userId: 'u1', name: '测试成员' }], roles: [{ id: 'custom', name: '资金主管', enabled: true }], directory: {}, policies: new Set(['u1']), onClose() {}, onSave: body => { calls.push(body); return new Promise((_, fail) => { reject = fail }) } }
  const nodes = () => clientNodes(harness.render(props))
  nodes().find(node => node.props['aria-label'] === '变更原因').props.onChange('职责调整')
  assert.ok(nodes().some(node => node.props.role === 'status' && node.children.join('').includes('1 人保留成员独立权限')))
  const submit = () => nodes().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  const pending = submit(); await submit()
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { userIds: ['u1'], role: 'custom', reason: '职责调整' })
  assert.equal(nodes().find(node => node.type?.name === 'Dialog').props.dismissDisabled, true)
  assert.ok(nodes().filter(node => ['SearchSelect', 'MultiSearchSelect', 'Textarea'].includes(node.type?.name)).every(node => node.props.disabled))
  reject(new Error('成员身份已停用，整批未保存')); await pending
  assert.equal(nodes().find(node => node.props['aria-label'] === '变更原因').props.value, '职责调整')
  assert.ok(nodes().some(node => node.props.role === 'alert' && node.children.includes('成员身份已停用，整批未保存')))
})

test('members route owns custom roles and removal confirmation without unrelated filing requests', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await permissionSource() + '\n' + await readFile(new URL('src/views/members.js', root), 'utf8')
  const paths = [], writes = [], row = { id: 'm1', userId: 'u1', name: '测试成员', enabled: true, role: 'FINANCE_STAFF', customRoleId: 'custom' }
  const data = { '/finance/members': { list: [row] }, '/finance/access-roles': { list: [{ id: 'custom', name: '资金主管', enabled: true }] }, '/finance/permission-policies': { list: [{ subjectType: 'USER', subjectId: 'u1' }] }, '/finance/permissions/organization-directory': { members: [{ userId: 'u1', enabled: true }], departments: [] } }
  const harness = clientHarness(source, 'FinanceMembersView', { financeRows: data => data?.list || [], useFinanceResource: path => { paths.push(path); return { data: data[path] } }, useFinanceAction: () => ({ revision: 0, run: async (...args) => writes.push(args) }), FinanceResource() {}, FinanceFormDialog() {}, Notice() {} })
  const props = { ctx: { revision: 1 }, t: key => key }, render = () => harness.render(props)
  let tree = render()
  assert.deepEqual([...new Set(paths)], Object.keys(data))
  assert.ok(clientNodes(tree).some(node => node.type?.name === 'FinanceRoleManager'))
  const card = clientNodes(tree).find(node => node.type?.name === 'MembersCard')
  assert.ok(card.props.policies.has('u1'))
  card.props.onRemove(row)
  assert.equal(writes.length, 0)
  tree = render()
  const confirmation = clientNodes(tree).find(node => node.type?.name === 'FinanceFormDialog')
  assert.match(confirmation.props.title, /测试成员/)
  assert.match(confirmation.props.description, /不会删除 SSO/)
  await confirmation.props.onSubmit()
  assert.deepEqual(writes, [['/finance/members/m1/remove', {}]])
  const tableHarness = clientHarness(source, 'MembersCard')
  const table = clientNodes(tableHarness.render(card.props)).find(node => node.type?.name === 'Table')
  assert.equal(table.props.columns.find(column => column.key === 'role').render(row), '资金主管')
  assert.equal(table.props.columns.find(column => column.key === 'policy').render(row), '成员独立配置')
})

test('identity directory and employment pages only load their task resources', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/entry.js', root), 'utf8')
  for (const directorySection of ['directory', 'employment']) {
    const paths = []
    const harness = clientHarness(source, 'EntryView', { FinanceMembersView() {}, api: async path => { paths.push(path); return { data: { list: [] } } } })
    harness.render({ ctx: { year: 2026, orgs: [], departments: [], revision: 1 }, t: key => key, directoryOnly: true, directorySection })
    harness.flushEffects()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(paths, directorySection === 'directory' ? ['/contacts?limit=100&'] : ['/employment-records?limit=50'])
  }
})

test('filing sidebar changes preserve the active task and year but clear task scope when leaving the activity', async () => {
  const source = await readFile(new URL('src/navigation.js', root), 'utf8')
  const { items, params } = new Function(source + '\nreturn { items: FINANCE_NAVIGATION.flatMap(([,items])=>items), params: financeSidebarParams }')()
  for (const [id, section] of [['filing-tasks', 'assignments'], ['filing-department', 'department'], ['filing-records', 'mine']]) {
    const item = items.find(row => row[0] === id)
    assert.ok(item, id)
    assert.deepEqual(params(item, 'filing', { section: 'department', taskId: 'task-2025' }, 2025), { section, taskId: 'task-2025', year: '2025' })
  }
  for (const id of ['filing-activities', 'identity-members', 'cash']) {
    const item = items.find(row => row[0] === id)
    assert.equal(params(item, 'filing', { taskId: 'task-2025' }, 2025).taskId, undefined)
  }
  assert.equal(params(items.find(row => row[0] === 'filing-department'), 'cash', { taskId: 'other' }, 2026).taskId, undefined)
})

test('incomplete organization sync is visible in role and policy selectors without exposing English diagnostics', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await permissionSource()
  let refreshes = 0
  const harness = clientHarness(source, 'FinanceOrganizationNotice', { financeErrorText: value => value })
  const props = { directory: { syncStatus: 'FAILED', syncError: '飞书通讯录范围不足（40004）' }, onRefresh: () => refreshes++ }
  const tree = harness.render(props)
  assert.equal(tree.props.role, 'alert')
  assert.ok(clientNodes(tree).some(node => node.children.includes('飞书通讯录范围不足（40004）')))
  clientNodes(tree).find(node => node.type?.name === 'GhostButton').props.onClick()
  assert.equal(refreshes, 1)
  assert.equal(harness.render({ directory: { syncStatus: 'SUCCESS' } }), null)
})

test('entry scope changes require explicit discard and cancellation retains the current form', async () => {
  let registered
  const harness = await budgetEntryHarness({ props: { onLeaveGuardChange: guard => { registered = guard } } })
  harness.switchKind('payment'); await harness.settle()
  const key = harness.render().props.key
  harness.render().props.onChangeCapture({ target: { name: 'description' } })
  harness.switchKind('revenue')
  let dialog = clientNodes(harness.render()).find(node => node.type?.name === 'Dialog')
  assert.ok(dialog)
  assert.equal(harness.render().props.key, key)
  dialog.props.onClose()
  assert.equal(clientNodes(harness.render()).some(node => node.type?.name === 'Dialog'), false)
  let navigated = false
  registered(() => { navigated = true })
  dialog = clientNodes(harness.render()).find(node => node.type?.name === 'Dialog')
  assert.equal(navigated, false)
  clientNodes(dialog.props.footer).find(node => node.type?.name === 'PrimaryButton').props.onClick()
  assert.equal(navigated, true)
  harness.switchKind('revenue')
  assert.match(harness.render().props.key, /^revenue/)
})

test('entry history follows entity selection and suppresses stale suggestions during scope changes', async () => {
  const harness = await budgetEntryHarness({ props: { orgs: [{ id: 'org-1', type: 'COMPANY', name: '甲' }, { id: 'org-2', type: 'COMPANY', name: '乙' }] }, api: async path => ({ data: { list: path.startsWith('/payment-plans') ? [{ id: 'p1', payeeName: new URL(path, 'https://example.test').searchParams.get('orgId') + '供应商', costItemName: '已停用历史科目' }] : path === '/cost-items' ? [{ name: '启用科目', active: true }, { name: '停用科目', active: false }] : [] } }) })
  harness.switchKind('payment'); await harness.settle()
  let nodes = clientNodes(harness.render())
  assert.deepEqual(nodes.find(node => node.props.name === 'payeeName').props.options, ['org-1供应商'])
  assert.deepEqual(nodes.find(node => node.props.name === 'costItemName').props.options, ['启用科目'])
  nodes.find(node => node.props.name === 'orgId').props.onChange('org-2')
  assert.deepEqual(clientNodes(harness.render()).find(node => node.props.name === 'payeeName').props.options, [])
  await harness.settle()
  assert.ok(harness.reads.includes('/payment-plans?year=2026&orgId=org-2&limit=200'))
  assert.deepEqual(clientNodes(harness.render()).find(node => node.props.name === 'payeeName').props.options, ['org-2供应商'])
})

test('entry enforces trimmed text limits without posting invalid payment or revenue facts', async () => {
  const harness = await budgetEntryHarness({ values: { description: '  ', plannedAmount: '100', planMonth: '10', itemNameChoice: '收入项目', incomeTypeNameChoice: '字'.repeat(101) } })
  harness.switchKind('payment'); await harness.submit()
  assert.equal(harness.writes.length, 0)
  assert.ok(clientNodes(harness.render()).some(node => node.children.includes('entryDescriptionRequired')))
  harness.values.description = '字'.repeat(501)
  await harness.submit(); assert.equal(harness.writes.length, 0)
  harness.values.description = '设备款'; harness.values.payeeNameChoice = '字'.repeat(201)
  await harness.submit(); assert.equal(harness.writes.length, 0)
  harness.switchKind('revenue'); await harness.submit(); assert.equal(harness.writes.length, 0)
  harness.values.incomeTypeNameChoice = '销售'; await harness.submit()
  assert.equal(harness.writes.length, 1)
  assert.equal(clientNodes(harness.render()).find(node => node.props.name === 'month').props.defaultValue, String(new Date().getMonth() + 1))
})

test('payment entry retains canonical field names and submits the required month with trimmed description', async () => {
  const harness = await budgetEntryHarness({ values: { description: '  设备款  ', plannedAmount: '100', planMonth: '10', planType: 'PURCHASE', payeeNameChoice: '甲供应商' } })
  harness.switchKind('payment'); await harness.submit()
  assert.deepEqual(harness.writes, [{ path: '/payment-plans', body: { orgId: 'org-1', year: 2026, description: '设备款', plannedAmount: 100, planMonth: 10, planType: 'PURCHASE', departmentId: 'dept-1', expenseType: 'FIXED_OPERATION', payeeName: '甲供应商' } }])
})

test('backfill searches and pages the server without replacing the selected plan or pending amount', async () => {
  let fail = false
  const harness = await budgetEntryHarness({ values: { planId: 'plan-225', actualAmount: '77' }, api: async path => {
    if (!path.includes('/payment-plans?')) return { data: { list: [], total: 0 } }
    const query = new URL(path, 'https://example.test').searchParams
    if (fail) throw new Error('离线')
    return { data: { list: [{ id: query.get('keyword') ? 'plan-225' : `page-${query.get('page')}`, description: query.get('keyword') || '当页计划', year: 2026, planMonth: 10, plannedAmount: 100 }], total: query.get('keyword') ? 1 : 225 } }
  } })
  harness.switchKind('backfill'); await harness.settle()
  const picker = () => clientNodes(harness.render()).find(node => node.props.name === 'planId')
  picker().props.remoteSearch.onChange('计划225')
  assert.equal(picker().props.options.length, 0, 'unsubmitted keyword must not show old choices')
  picker().props.remoteSearch.onSubmit(); await harness.settle()
  assert.match(harness.reads.at(-1), /keyword=.*page=1&limit=20/)
  picker().props.onChange('plan-225')
  assert.equal(picker().props.value, 'plan-225')
  picker().props.remoteSearch.onChange(''); picker().props.remoteSearch.onSubmit(); await harness.settle()
  clientNodes(picker().props.remoteSearch.content).find(node => node.children.includes('下一页')).props.onClick()
  await harness.settle()
  assert.match(harness.reads.at(-1), /page=2&limit=20/)
  assert.equal(picker().props.value, 'plan-225')
  assert.match(picker().props.selectedLabel, /计划225/)
  fail = true
  picker().props.remoteSearch.onSubmit(); await harness.settle()
  assert.ok(clientNodes(picker().props.remoteSearch.content).some(node => node.props.role === 'alert'))
  assert.equal(picker().props.value, 'plan-225', 'search failure cannot silently substitute the selected record')
  await harness.submit()
  assert.deepEqual(harness.writes, [{ path: '/payment-plans/plan-225/actuals', body: { actualAmount: 77 } }])
})

test('backfill suppresses late plan responses and permits changing an empty search scope without discard', async () => {
  let resolveOld
  const harness = await budgetEntryHarness({ api: async path => {
    if (path.includes('page=2')) return new Promise(resolve => { resolveOld = resolve })
    return { data: { list: [{ id: 'current', description: '当前计划' }], total: 60 } }
  } })
  harness.switchKind('backfill'); await harness.settle()
  const picker = () => clientNodes(harness.render()).find(node => node.props.name === 'planId')
  clientNodes(picker().props.remoteSearch.content).find(node => node.children.includes('下一页')).props.onClick()
  await harness.settle()
  assert.equal(picker().props.options.length, 0)
  const scope = clientNodes(harness.render()).find(node => node.type?.name === 'SearchSelect' && node.props.placeholder === '主体范围')
  scope.props.onChange('org-1'); await harness.settle()
  resolveOld({ data: { list: [{ id: 'stale', description: '旧范围' }], total: 60 } })
  await harness.settle()
  assert.equal(picker().props.options[0][0], 'current')
  assert.equal(picker().props.value, '')
  assert.equal(clientNodes(harness.render()).some(node => node.type?.name === 'Dialog'), false)
})

test('plan keyword, entity, year and page cross the host to the public Datasource contract unchanged', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => { calls.push({ url: String(url), init }); return mcpJson({ list: [], total: 0, page: 12, limit: 20 }) } })
  for (const kind of ['payment', 'revenue']) {
    const result = await invokeRoute(routes.get(BASE), 'GET', `${BASE}/${kind}-plans?keyword=${encodeURIComponent('设备 & 回款')}&orgId=org-a&year=2026&page=12&limit=20`)
    assert.equal(result.status, 200)
    const target = new URL(calls.at(-1).url)
    assert.equal(target.pathname, `/api/finance/${kind}-plans`)
    for (const [key, value] of Object.entries({ keyword: '设备 & 回款', orgId: 'org-a', year: 2026, page: 12, limit: 20 })) {
      const raw = target.searchParams.get(key)
      let parsed
      try { parsed = JSON.parse(raw) } catch { parsed = raw }
      assert.equal(String(parsed), String(value))
    }
    assert.equal(calls.at(-1).init.method, 'GET')
  }
})

test('backfill record replacement protects typed actuals, cancellation retains the original and confirmation resets fields', async () => {
  let guard
  const harness = await budgetEntryHarness({ props: { onLeaveGuardChange: value => { guard = value } }, api: async () => ({ data: { list: [{ id: 'a', description: '计划甲' }, { id: 'b', description: '计划乙' }], total: 2 } }) })
  harness.switchKind('backfill'); await harness.settle()
  const picker = () => clientNodes(harness.render()).find(node => node.props.name === 'planId')
  picker().props.onChange('a')
  const before = harness.render()
  clientNodes(before).find(node => node.props.name === 'actualAmount').props.onChange('9')
  clientNodes(harness.render()).find(node => node.props.name === 'actualPaidAt').props.onChange('2026-10-18')
  picker().props.onChange('b')
  let dialog = clientNodes(harness.render()).find(node => node.type?.name === 'Dialog')
  assert.ok(dialog)
  dialog.props.onClose()
  assert.equal(picker().props.value, 'a')
  assert.equal(harness.render().props.key, before.props.key)
  picker().props.onChange('b')
  dialog = clientNodes(harness.render()).find(node => node.type?.name === 'Dialog')
  clientNodes(dialog.props.footer).find(node => node.children.includes('entryDiscardContinue')).props.onClick()
  assert.equal(picker().props.value, 'b')
  assert.equal(clientNodes(harness.render()).find(node => node.props.name === 'actualAmount').props.value, '')
  assert.equal(clientNodes(harness.render()).find(node => node.props.name === 'actualPaidAt').props.value, '')
  assert.equal(clientNodes(harness.render()).find(node => node.type?.name === 'PrimaryButton' && node.props.type === 'submit').props.disabled, true)
  clientNodes(harness.render()).find(node => node.props.name === 'actualAmount').props.onChange('0')
  assert.equal(clientNodes(harness.render()).find(node => node.type?.name === 'PrimaryButton' && node.props.type === 'submit').props.disabled, false, 'explicit zero is a valid actual amount')
  assert.notEqual(harness.render().props.key, before.props.key, 'record change resets the form session')
  await harness.settle()
  let left = false
  guard(() => { left = true })
  assert.equal(left, false, 'newly selected record remains protected after discard confirmation')
})

test('cash plan and revenue links retain multi-month, search and pagination context through the real view', async () => {
  const navigation = await readFile(new URL('src/navigation.js', root), 'utf8')
  const resolve = new Function(navigation + '\nreturn financeBusinessDestination')()
  const components = await readFile(new URL('src/components.js', root), 'utf8')
  const cash = await readFile(new URL('src/views/cash.js', root), 'utf8')
  const requests = []
  const destination = resolve('/cash?tab=plans&months=10,1,10&q=设备&expenseType=FIXED_OPERATION&unassigned=1&dept=dept-a&page=12')
  const harness = clientHarness(components + '\n' + cash, 'CashView', { PAGE_SIZE: 20, PLAN_TYPES: [], EXPENSE_TYPES: [], api: async path => { requests.push(path); return { data: { list: [], total: 0 } } } })
  const props = { ctx: { year: '2026', orgId: 'org-a', departments: [], permissions: [], drillParams: destination.params }, t: key => key }
  const render = () => harness.render(props)
  const settle = async () => { render(); harness.flushEffects(); await new Promise(resolve => setImmediate(resolve)); return render() }
  await settle()
  let query = new URL(requests.at(-1), 'https://example.test').searchParams
  assert.equal(query.get('keyword'), '设备')
  assert.equal(query.get('months'), '1,10')
  assert.equal(query.get('expenseType'), 'FIXED_OPERATION')
  assert.equal(query.get('departmentId'), 'dept-a')
  assert.equal(query.get('unassigned'), '1')
  assert.equal(query.has('orgId'), false, 'unassigned and a selected org must not be combined')
  assert.equal(query.get('page'), '12')
  const count = requests.length
  clientNodes(render()).find(node => node.type?.name === 'Field').props.onChange('模具')
  await settle()
  assert.equal(requests.length, count, 'typing is not a submitted search')
  clientNodes(render()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await settle()
  query = new URL(requests.at(-1), 'https://example.test').searchParams
  assert.equal(query.get('keyword'), '模具')
  assert.equal(query.get('page'), '1')
  clientNodes(render()).find(node => node.type?.name === 'PillTabs').props.onChange('revenue')
  await settle()
  const revenue = new URL(requests.at(-1), 'https://example.test')
  assert.equal(revenue.pathname, '/revenue-plans')
  assert.equal(revenue.searchParams.get('months'), '1,10')
  assert.equal(revenue.searchParams.get('keyword'), '模具')
  assert.equal(revenue.searchParams.get('orgId'), 'org-a')
  assert.equal(revenue.searchParams.has('expenseType'), false)
  assert.equal(revenue.searchParams.has('unassigned'), false)
  assert.equal(resolve('/cash?q=' + 'x'.repeat(201)), null)
})

test('cash filter loading and failure never expose rows from the old scope and a retry uses the current query', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/cash.js', root), 'utf8')
  let resolvePending, fail = false
  const paths = []
  const harness = clientHarness(source, 'CashView', { PAGE_SIZE: 20, PLAN_TYPES: [], EXPENSE_TYPES: [], api: async path => {
    paths.push(path)
    if (path.includes('keyword=')) {
      if (fail) throw new Error('离线')
      return new Promise(resolve => { resolvePending = resolve })
    }
    return { data: { list: [{ id: 'old' }], total: 1 } }
  } })
  const props = { ctx: { year: '2026', permissions: [], drillParams: { view: 'plans' }, departments: [] }, t: key => key }
  const render = () => harness.render(props)
  const settle = async () => { render(); harness.flushEffects(); await new Promise(resolve => setImmediate(resolve)); return render() }
  await settle()
  assert.equal(clientNodes(render()).find(node => node.type?.name === 'PlansTab').props.rows[0].id, 'old')
  clientNodes(render()).find(node => node.type?.name === 'Field').props.onChange('新范围')
  clientNodes(render()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  assert.equal(clientNodes(render()).some(node => node.type?.name === 'PlansTab'), false)
  await settle()
  assert.equal(clientNodes(render()).some(node => node.props.role === 'status'), true)
  fail = true
  // 改条件触发一个失败的新查询；旧查询随后返回也不能覆盖新状态。
  clientNodes(render()).find(node => node.type?.name === 'MultiSearchSelect').props.onChange(['10'])
  await settle()
  resolvePending({ data: { list: [{ id: 'late' }], total: 1 } }); await settle()
  assert.equal(clientNodes(render()).some(node => node.type?.name === 'PlansTab'), false)
  const error = clientNodes(render()).find(node => node.type?.name === 'CashPlanListError')
  assert.ok(error)
  error.props.onRetry(); await settle()
  assert.match(paths.at(-1), /months=10/)
  assert.match(paths.at(-1), /keyword=/)
})

test('cash legacy host forwards multi-month and expense filters instead of silently widening results', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => { calls.push({ url: String(url), init }); return mcpJson({ list: [], total: 0, page: 1, limit: 20 }) } })
  for (const kind of ['payment', 'revenue']) {
    const result = await invokeRoute(routes.get(BASE), 'GET', `${BASE}/${kind}-plans?year=2026&months=1,10&keyword=模具&expenseType=FIXED_OPERATION&page=1&limit=20`)
    assert.equal(result.status, 200)
    const query = new URL(calls.at(-1).url).searchParams
    assert.equal(query.get('months'), '1,10')
    assert.equal(query.get('keyword'), '模具')
    assert.equal(query.get('expenseType'), kind === 'payment' ? 'FIXED_OPERATION' : null)
  }
})
