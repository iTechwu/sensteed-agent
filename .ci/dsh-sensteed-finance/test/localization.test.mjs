import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
async function loadUi(fetch = async () => { throw new Error('Failed to fetch') }) {
  const files = ['head', 'format', 'components', 'workflows', 'views/budget', 'views/cash', 'views/alerts', 'views/engine', 'views/entry', 'views/permissions']
  const source = (await Promise.all(files.map(file => readFile(new URL(`src/${file}.js`, root), 'utf8')))).join('\n')
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: current => ({ current }), useEffect() {}, useMemo: compute => compute(),
  }
  return new Function('require', 'fetch', `${source}\nreturn { copy, Select, CarryoverDialog, ScheduleDialog, FinanceEvidence, financeColumns, VersionsView, AllocationsView, DirectoryCard, Table, api }`)(name => name === 'react' ? react : {}, fetch)
}
function nodes(node) {
  return node && typeof node === 'object' ? [node, ...(node.props.children || []).flatMap(nodes)] : []
}
function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node !== 'object') return String(node)
  if (typeof node.type === 'function') return textOf(node.type(node.props))
  return (node.props.children || []).map(textOf).join(' ')
}

test('carryover and scheduling selectors show localized options while retaining API enum values', async () => {
  const ui = await loadUi()
  for (const locale of ['zh', 'en']) {
    const t = key => ui.copy[locale][key] ?? key
    for (const [component, props, expected] of [
      [ui.CarryoverDialog, {}, locale === 'zh' ? [['FULL', '全额结转'], ['PERCENT', '比例结转'], ['EXPIRE', '过期清零']] : [['FULL', 'Full carry'], ['PERCENT', 'Percent'], ['EXPIRE', 'Expire']]],
      [ui.ScheduleDialog, { plan: { priority: 'HIGH', planMonth: 10 } }, locale === 'zh' ? [['HIGH', '高'], ['MEDIUM', '中'], ['LOW', '低']] : [['HIGH', 'High'], ['MEDIUM', 'Mid'], ['LOW', 'Low']]],
    ]) {
      const select = nodes(component({ ...props, t })).find(node => node.type === ui.Select)
      const options = ui.Select(select.props).props.children.filter(node => node?.props?.value).map(node => [node.props.value, node.props.children[0]])
      assert.deepEqual(options, expected)
    }
  }
})

test('contract enum columns translate payment, sync, scope and cost workflow states', async () => {
  const ui = await loadUi()
  for (const [key, value, expected] of [
    ['status', 'IN_APPROVAL', '审批中'], ['status', 'PAID', '已支付'],
    ['status', 'PENDING_REVIEW', '待核对'], ['status', 'DONE', '已完成'],
    ['scopeType', 'DEPARTMENT', '指定部门'], ['expenseType', 'AUTOMOTIVE_PARTS', '汽车零部件'],
    ['stage', 'RAW_STAGED', '原始数据已暂存，未发布'], ['stage', 'FETCHED_UNMAPPED', '已采集，待配置字段映射'],
    ['fallbackReason', 'DSS_CALL_FAILED', 'DSS 调用失败'], ['action', 'POST', '过账'],
    ['status', 'NEW_SERVER_STATE', '未识别类型'], ['syncStatus', 'PARTIAL', '部分成功'],
    ['status', 'PARTIAL', '部分支付'], ['alertType', 'BUDGET_OVERRUN', '预算超支'],
  ]) {
    const column = ui.financeColumns([[key, '业务字段']])[0]
    assert.equal(textOf(column.render({ [key]: value })), expected, `${key}: ${value}`)
  }
})

test('every literal translation key used by the UI exists in the Chinese dictionary', async () => {
  const ui = await loadUi()
  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
      if (entry.isDirectory()) await inspect(path)
      else if (entry.name.endsWith('.js')) {
        const source = await readFile(path, 'utf8')
        for (const match of source.matchAll(/\bt\('([^']+)'\)/g)) assert.ok(Object.hasOwn(ui.copy.zh, match[1]), `${path.pathname}: ${match[1]}`)
      }
    }
  }
  await inspect(new URL('src/', root))
})

test('nested evidence uses Chinese field labels and booleans without translating user content', async () => {
  const ui = await loadUi()
  const text = textOf(ui.FinanceEvidence({ value: {
    scopeType: 'ORG', enabled: false, acceptsAcceptance: true,
    results: [{ ok: true, status: 'POSTED', departmentName: 'OPEN', reason: 'Budget Review' }],
    budgetAmount: 123, executionRate: 0.5,
  } }))
  for (const label of ['数据范围', '指定主体', '启用', '否', '接受承兑', '是', '结果', '已过账', '预算金额', '执行率']) assert.ok(text.includes(label), label)
  for (const code of ['scopeType', 'enabled', 'acceptsAcceptance', 'true', 'false', 'POSTED', 'budgetAmount', 'executionRate']) assert.ok(!text.includes(code), code)
  assert.ok(text.includes('OPEN'))
  assert.ok(text.includes('Budget Review'))
})

test('API failures show Chinese guidance and preserve actionable business errors and status', async () => {
  for (const [body, status, expected] of [
    [{ error: 'upstream_timeout' }, 503, /超时/],
    [{ error: 'Forbidden' }, 403, /权限/],
    [{ error: 'plannedAmount must not be less than 0.01' }, 400, /计划金额.*0\.01/],
    [{ error: ['主体不能为空', 'plannedAmount must not be less than 0.01'] }, 400, /^主体不能为空；计划金额不得小于 0\.01$/],
    [{ error: '年度 2027 暂无已发布预算版本，请先导入数据' }, 404, /年度 2027 暂无已发布预算版本，请先导入数据/],
  ]) {
    const ui = await loadUi(async () => ({ ok: false, status, json: async () => body }))
    await assert.rejects(ui.api('/test'), error => error.status === status && expected.test(error.message))
  }
  const ui = await loadUi()
  await assert.rejects(ui.api('/test'), /网络|连接|服务/)
})


test('version, allocation and directory tables localize their displayed columns', async () => {
  const ui = await loadUi()
  const t = key => ui.copy.zh[key] ?? key
  for (const [component, props, field, value, expected] of [
    [ui.VersionsView, { versions: { list: [] }, year: 2026 }, 'type', 'ROLLING', '滚动预测'],
    [ui.AllocationsView, { query: () => '' }, 'sourceType', 'PAYMENT_REQUEST', '采购申请'],
  ]) {
    const tree = component({ ...props, t })
    const column = nodes(tree).filter(node => node.type === ui.Table).flatMap(node => node.props.columns).find(column => column.key === field)
    assert.equal(textOf(column.render ? column.render({ [field]: value }) : value), expected)
  }
  const directory = ui.DirectoryCard({ contacts: { list: [] }, t })
  const columns = nodes(directory).find(node => node.type === ui.Table).props.columns
  assert.equal(columns.find(column => column.key === 'mobile').label, '手机号')
  assert.equal(columns.find(column => column.key === 'email').label, '邮箱')
  assert.equal(t('hubSubtitle'), '财务数据工作台')
})
