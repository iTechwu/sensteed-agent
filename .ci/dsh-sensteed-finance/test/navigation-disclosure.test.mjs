import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
const source = await readFile(new URL('../src/navigation.js', import.meta.url), 'utf8')
const groups = new Function(`${source}\nreturn financeNavigationGroups`)()
test('navigation search keeps authorized items grouped and matches group names', () => {
  const items = [{ id: 'budget', label: '预算执行', group: '预算管理' }, { id: 'cash', label: '资金分析', group: '资金管理' }]
  assert.deepEqual(groups(items, '  预算  '), [['预算管理', [items[0]]]])
  assert.deepEqual(groups(items, '管理'), [['预算管理', [items[0]]], ['资金管理', [items[1]]]])
  assert.deepEqual(groups(items, '不存在'), [])
  assert.equal(groups(items, '').length, 2)
})
