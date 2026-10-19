import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
const source = await readFile(new URL('../src/shell.js', import.meta.url), 'utf8')
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...(node.children || []).flat(Infinity).flatMap(nodes)]
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join(' ') : (node?.children || []).map(text).join(' ')
function load(extra = {}) {
  return vm.runInNewContext(`${source}; useLoad = mockLoad; ({ Overview, Metric, Suppliers, Evidence, Weekly, safeSourceUrl: typeof safeSourceUrl === "function" ? safeSourceUrl : undefined, reportStatus: typeof reportStatus === "function" ? reportStatus : undefined })`, {
    exports: {}, URL, React: { Fragment: 'fragment' }, h: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: initial => [initial, () => {}], useRef: () => ({ current: null }), useEffect() {},
    useRemembered: (_key, initial) => [initial, () => {}], fmt: value => value || '时间未记录',
    IconSearchOutlineRegular: 'icon', mockLoad: () => ({ loading: false, data: null }), ...extra,
  })
}

test('overview counts offer a direct route to the corresponding records', () => {
  let page
  const { Metric } = load()
  const tree = Metric({ label: '供应商', value: 10, onClick: () => { page = 'suppliers' } })
  assert.equal(tree.type, 'button')
  tree.props.onClick()
  assert.equal(page, 'suppliers')
})

test('supplier search with matching results still provides clear-filter recovery', () => {
  const { Suppliers } = load({
    useRemembered: (key, initial) => [key === 'supplier-filter' ? '甲' : initial, () => {}],
    mockLoad: () => ({ loading: false, data: { items: [{ supplierId: 's1', displayName: '供应商甲' }], total: 1 } }),
  })
  assert.ok(nodes(Suppliers({ revision: 0, setError() {} })).some(node => node.type === 'button' && text(node) === '清除筛选'))
})

test('evidence detail failure always leaves a usable route back to the list', () => {
  let reads = 0
  const { Evidence } = load({
    useRemembered: (key, initial) => [key === 'media-detail' ? 'e1' : initial, () => {}],
    mockLoad: () => ++reads === 1 ? { loading: false, data: { items: [], total: 0 } } : { loading: false, data: null, error: '读取失败' },
  })
  const tree = Evidence({ kind: 'media', revision: 0, setError() {} })
  assert.ok(nodes(tree).some(node => node.type === 'button' && text(node) === '返回证据列表'))
})

test('only http and https source links may be rendered as external links', () => {
  const { safeSourceUrl } = load()
  assert.equal(safeSourceUrl('javascript:alert(1)'), undefined)
  assert.equal(safeSourceUrl('/relative'), undefined)
  assert.equal(safeSourceUrl('https://example.com/evidence'), 'https://example.com/evidence')
})

test('weekly report reading states never use risk-verification labels', () => {
  const { reportStatus } = load()
  assert.equal(reportStatus({ status: 'succeeded', isRead: false }), '未读')
  assert.equal(reportStatus({ status: 'succeeded', isRead: true }), '已读')
  assert.equal(reportStatus({ status: 'failed' }), '生成失败')
})

test('weekly detail failure does not hide the saved plan or history', () => {
  let reads = 0
  const { Weekly } = load({
    useRemembered: (key, initial) => [key === 'weekly-report' ? 'r1' : key === 'weekly-plan-draft' ? { version: 1, supplierIds: [] } : initial, () => {}],
    mockLoad: () => [
      { loading: false, data: { plan: { version: 1 } } },
      { loading: false, data: { items: [{ reportId: 'r1', status: 'succeeded', isRead: false, summary: '测试周报' }], unreadCount: 1 } },
      { loading: false, data: [] },
      { loading: false, data: null, error: '报告暂不可用' },
    ][reads++],
  })
  const tree = Weekly({ revision: 0, setError() {}, onUnread() {}, onScopeReady: true })
  const buttons = nodes(tree).filter(node => node.type === 'button').map(text)
  assert.ok(buttons.includes('保存计划'))
  assert.ok(buttons.includes('收起周报'))
  assert.match(text(tree), /测试周报/)
  assert.match(text(tree), /未读/)
})

test('review reason storage is scoped to the evidence being reviewed', () => {
  const keys = []
  const { Evidence } = load({
    useRemembered: (key, initial) => { keys.push(key); return [key === 'media-detail' ? 'second-evidence' : initial, () => {}] },
    mockLoad: () => ({ loading: false, data: null }),
  })
  Evidence({ kind: 'media', revision: 0, setError() {} })
  assert.ok(keys.includes('media-review-reason:second-evidence'))
  assert.ok(keys.includes('media-review-run:second-evidence'))
})
