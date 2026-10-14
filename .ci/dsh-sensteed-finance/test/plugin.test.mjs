import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

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
    h, useState,
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
    yearOptions: () => [['2026', '2026']],
    budgetVersionLabel: version => version.name,
    PLAN_TYPES: [], EXPENSE_TYPES: [],
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
  const files = ['src/format.js', 'src/components.js', 'src/views/budget.js', 'src/views/cash.js']
  const source = (await Promise.all(files.map(file => readFile(new URL(file, root), 'utf8')))).join('\n')
  const budgetRow = { id: 'line-1', orgName: '主体一', month: 1, expenseType: 'FIXED_OPERATION', budgetAmount: 10000, prSubmittedAmount: 2000, prEstimatedAmount: 500, paidAmount: 1000 }
  const cases = [
    ['MatrixView', { budget: { summary: { list: [budgetRow] } }, onCell() {} }, 'total.budget', 10000],
    ['LinesView', { budget: { lines: { list: [budgetRow] } }, page: 1, onPage() {} }, 'budgetAmount', 10000],
    ['CashMatrix', { rows: [{ orgName: '主体一', month: 1, projectedBalance: 3000 }] }, 'month-1', 3000],
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
    if (component === 'CashMatrix') assert.equal(row[table.props.columns[0].key], '主体一')
  }
})


test('filing saves selected cost IDs before submission and preserves rows on failure', async () => {
  const components = await readFile(new URL('src/components.js', root), 'utf8')
  const entry = await readFile(new URL('src/views/entry.js', root), 'utf8')
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
  const entry = await readFile(new URL('src/views/entry.js', root), 'utf8')
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
  const entry = await readFile(new URL('src/views/entry.js', root), 'utf8')
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
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/entry.js', root), 'utf8')
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
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/entry.js', root), 'utf8')
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
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/entry.js', root), 'utf8')
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
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/entry.js', root), 'utf8')
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
  const read = new Function('fetch', 'AbortSignal', 'BASE', 'REQUEST_TIMEOUT_MS', requestSource + '\nreturn api')
  const response = status => ({ ok: status === 200, status, json: async () => status === 200 ? { data: { list: [] } } : { error: 'permission_denied' } })
  const denied = read(async () => response(403), { timeout: () => undefined }, '/finance', 30000)
  await assert.rejects(denied('/members'), error => error.status === 403 && error.message === 'permission_denied')
  const unavailable = read(async () => response(503), { timeout: () => undefined }, '/finance', 30000)
  await assert.rejects(unavailable('/members'), error => error.status === 503)

  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/entry.js', root), 'utf8')
  const harness = clientHarness(source, 'EntryView', { api: path => path === '/members' ? denied(path) : Promise.resolve({ data: { list: [] } }) })
  const props = { ctx: { year: 2026, orgs: [], departments: [], revision: 1 }, t: key => key }
  let tree = harness.render(props)
  harness.flushEffects()
  await new Promise(resolve => setImmediate(resolve))
  tree = harness.render(props)
  clientNodes(tree).find(node => node.type?.name === 'PillTabs').props.onChange('org')
  tree = harness.render(props)
  const card = clientNodes(tree).find(node => node.type?.name === 'MembersCard')
  assert.equal(card.props.members.forbidden, true)
  assert.equal(card.props.members.error, undefined)
})

test('member field settings remain available without rows and all writes lock while busy', async () => {
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/entry.js', root), 'utf8')
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
  assert.equal(roleColumn.render(row).props.disabled, true)
  assert.equal(table.props.columns.find(column => column.key === 'actions').render(row).props.disabled, true)
})

test('task form and all custom selectors are locked while submitting', async () => {
  const components = await readFile(new URL('src/components.js', root), 'utf8')
  const entry = await readFile(new URL('src/views/entry.js', root), 'utf8')
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

test('budget entry submits custom cost item and resets captured form after async save', async () => {
  const components = await readFile(new URL('src/components.js', root), 'utf8')
  const entry = await readFile(new URL('src/views/entry.js', root), 'utf8')
  let payload
  let resetCount = 0
  const formElement = { reset() { resetCount++ } }
  const values = { orgId: 'org-1', year: '2026', expenseType: 'FIXED_OPERATION', departmentId: 'dept-1', costItemNameChoice: '新费用项', budgetAmount: '1250.50' }
  const harness = clientHarness(components + '\n' + entry, 'EntryPanel', {
    FormData: class { constructor(form) { assert.equal(form, formElement) } get(key) { return values[key] } },
    post: async (path, body) => { assert.equal(path, '/budget-lines'); payload = body },
  })
  const props = { year: 2026, orgs: [], departments: [], t: key => key }
  let tree = harness.render(props)
  clientNodes(tree).find(node => node.type?.name === 'PillTabs').props.onChange('budget')
  tree = harness.render(props)
  const event = { currentTarget: formElement, preventDefault() {} }
  const saving = tree.props.onSubmit(event)
  event.currentTarget = null
  await saving
  assert.equal(payload.costItemName, '新费用项')
  assert.equal(payload.departmentId, 'dept-1')
  assert.equal(payload.budgetAmount, 1250.5)
  assert.equal(resetCount, 1)
  tree = harness.render(props)
  assert.ok(clientNodes(tree).some(node => node.type?.name === 'Notice' && node.children.includes('submitted')))
})

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
  'src/head.js', 'src/format.js', 'src/components.js', 'src/styles.js',
  'src/views/overview.js', 'src/views/budget.js', 'src/views/operations.js', 'src/views/cash.js',
  'src/views/alerts.js', 'src/views/datacenter.js', 'src/views/entry.js', 'src/views/analyze.js',
  'src/views/bom.js',
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
  assert.equal(calls.filter(path => !path.endsWith('/permissions/workspace-access')).length, 10)
})

test('keeps the secret out of URLs and never fabricates upstream data', async () => {
  const { routes } = await loadHost({ fetch: async () => new Response('denied', { status: 403 }) })
  const route = routes.get(BASE)
  const response = await invokeRoute(route, 'GET', BASE + '/brief')
  assert.equal(response.status, 502)
  assert.equal(response.body.ok, false)
  assert.match(response.body.error, /财务操作权限/)
  const source = await readFile(new URL('index.js', root), 'utf8')
  assert.doesNotMatch(source, /api_key|MODELS_API_KEY/u)
})

test('MCP registration is owned by the desktop login lifecycle without machine secrets', async () => {
  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
  assert.doesNotMatch(patch, /authorizationCredential|INTERNAL_API_SECRET|mcp-finance/u)
})

test('client source wires sidebar entry, overlay, tabs, and analysis entries', async () => {
  const source = await readClientSource()
  for (const token of ['sidebar.footer.action', 'shell.overlay', 'sf-overlay', 'ANALYSIS_ENTRIES', '/brief', 'backfillActual', 'runDone', 'analysis_forecast', 'PillTabs', 'BudgetView', 'sf-pilltabs', 'sf-table-fields', 'sf-table-sort-button', 'sf-sidebar-brand', 'CustomizableTextSelect', 'MultiSearchSelect', 'textChoice', '新建预算行', 'targetYear', 'adjTargetMonth']) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  }
  assert.match(source, /if \(await act\('\/budget-adjustments',[\s\S]*?\)\) onClose\(\)/u)
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
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/entry.js', root), 'utf8')
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
  const source = await readFile(new URL('src/components.js', root), 'utf8') + '\n' + await readFile(new URL('src/views/entry.js', root), 'utf8')
  let requests = 0
  let writes = 0
  const harness = clientHarness(source, 'CreateTaskDialog', { api: async () => {
    if (++requests === 1) throw new Error('offline')
    return { data: { list: [{ id: 'draft', name: '草稿', status: 'DRAFT' }, { id: 'locked', name: '锁定', status: 'LOCKED' }] } }
  } })
  const props = { year: 2026, departments: [{ id: 'one', name: '甲部门' }], t: key => key, act: async () => { writes++; return true }, onClose() {} }
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
  const entry = await readFile(new URL('src/views/entry.js', root), 'utf8')
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
  const values = ['十月资金填报', 'PAYMENT_PLAN', '10', '', null, ['dept-1'], '2026-10-10T12:00', '填写说明', '负责人', '审核人', true, false, true]
  let closed = false
  let payload
  const dialog = createDialog(values)({
    year: 2026, departments: [{ id: 'dept-1', name: '部门一' }], busy: false, t: key => key,
    onClose: () => { closed = true }, act: async (_path, body) => { payload = body; return false },
  })
  await dialog.props.footer[1].props.onClick()
  assert.equal(closed, false)
  assert.equal(payload.month, 10)
  assert.deepEqual(payload.departments, [{ departmentId: 'dept-1' }])
  assert.equal(payload.instructions, '填写说明')
  assert.equal(payload.freezeCurrentMonth, false)
  assert.equal(payload.startAsDraft, true)

  const budget = createDialog(['年度预算', 'BUDGET', '10', 'version-1', [{ id: 'version-1', name: '预算版本' }], ['dept-1'], '2026-10-10T12:00'])({
    year: 2026, departments: [{ id: 'dept-1', name: '部门一' }], busy: false, t: key => key,
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
    effect(factory) { return factory() },
    locale: { register() {}, bind: () => key => key },
    slots: { inject(_key, register) { register() }, register(options, component) { registered[options.name] = component; return () => {} } },
    get: () => undefined,
  })
  assert.equal(registered['shell.overlay'], Overlay, 'shell.overlay must register the Overlay')

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
