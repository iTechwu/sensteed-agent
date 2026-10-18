import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const shell = await readFile(new URL('../src/shell.js', import.meta.url), 'utf8')
function load(extra = {}) {
  return vm.runInNewContext(`${shell}; if (testUseLoad) useLoad = testUseLoad; ({ loadSupplierOptions: typeof loadSupplierOptions === 'function' ? loadSupplierOptions : undefined, Suppliers, Weekly, Loading })`, {
    exports: {},
    fmt: value => value || '时间未记录',
    React: { Fragment: 'fragment' },
    h: (type, props, ...children) => ({ type, props, children }),
    useState: value => [value, () => {}],
    useEffect() {}, IconSearchOutlineRegular: 'icon',
    useRemembered: (_key, value) => [value, () => {}],
    testUseLoad: extra.useLoad,
    ...extra,
  })
}

test('weekly options include the second page of an existing 152-supplier registry', async () => {
  const calls = []
  const { loadSupplierOptions } = load({ api: async (_tool, args, signal) => {
    calls.push(args)
    assert.equal(signal, 'abort-signal')
    assert.ok(args.pageSize <= 100, 'MCP caps supplier pages at 100')
    return { total: 152, items: Array.from({ length: args.page === 1 ? 100 : 52 }, (_, i) => ({ supplierId: `s${(args.page - 1) * 100 + i}` })) }
  } })
  const result = await loadSupplierOptions('abort-signal')
  assert.equal(result.length, 152)
  assert.equal(result[151].supplierId, 's151')
  assert.deepEqual(calls.map(c => c.page), [1, 2])
})

test('incomplete supplier pagination fails instead of silently dropping saved selections', async () => {
  const { loadSupplierOptions } = load({ api: async (_tool, args) => ({ total: 152, items: args.page === 1 ? [{ supplierId: 's1' }] : [] }) })
  await assert.rejects(loadSupplierOptions(), /supplier_list_incomplete/)
})

test('empty registry offers a recovery explanation and search results offer a clear-filter action', () => {
  const render = filtered => {
    const changes = []
    const { Suppliers } = load({
      useLoad: () => ({ loading: false, data: { total: 0, items: [], observedAt: null } }),
      useRemembered: (key, initial) => [filtered && key === 'supplier-filter' ? 'missing' : initial, value => changes.push([key, value])],
    })
    return { tree: Suppliers({ revision: 0, setError() {} }), changes }
  }
  const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join(' ') : node?.children?.map(text).join(' ') || ''
  assert.match(text(render(false).tree), /当前团队尚未导入供应商/)
  assert.match(text(render(false).tree), /历史数据/)
  const filtered = render(true)
  assert.match(text(filtered.tree), /没有匹配的供应商/)
  const find = node => node?.type === 'button' && text(node) === '清除筛选' ? node : (node?.children || []).flat(Infinity).map(find).find(Boolean)
  find(filtered.tree).props.onClick()
  assert.ok(filtered.changes.some(([key, value]) => key === 'supplier-filter' && value === ''))
})

test('supplier option failure keeps weekly history visible and existing plan scope intact', () => {
  let loads = 0
  const { Weekly } = load({
    useLoad: () => ++loads === 1
      ? { loading: false, data: [{ plan: {} }, { items: [], unreadCount: 0 }, null] }
      : { loading: false, data: null },
    useRemembered: (key, initial) => [key === 'weekly-plan-draft' ? { supplierIds: ['saved-supplier'], version: 4 } : initial, () => {}],
  })
  const tree = Weekly({ revision: 0, setError() {}, onUnread() {}, onScopeReady: true })
  const nodes = node => node && typeof node === 'object' ? [node, ...(node.children || []).flat(Infinity).flatMap(nodes)] : []
  const all = nodes(tree)
  assert.ok(all.some(node => node.children?.includes('暂无已生成周报。')))
  const select = all.find(node => node.type === 'select')
  assert.equal(select.props.disabled, true)
  assert.deepEqual(Array.from(select.props.value), ['saved-supplier'])
})

test('failed reads render an error instead of an empty-data message', () => {
  const { Loading } = load()
  const node = Loading({ state: { loading: false, data: null, error: '供应链服务暂不可用。' } })
  assert.equal(node.props.role, 'alert')
  assert.equal(node.children[0], '供应链服务暂不可用。')
})
