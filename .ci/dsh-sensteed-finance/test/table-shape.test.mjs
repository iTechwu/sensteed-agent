import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const source = await readFile(new URL('../src/components.js', import.meta.url), 'utf8')
const h = (type, props, ...children) => ({ type: typeof type === 'string' ? type : type.name, props, children })
const Table = new Function('h','useState','useRef','useMemo','useEffect','localStorage', source + '\nreturn Table')(
  h, init => [typeof init === 'function' ? init() : init, () => {}], value => ({ current: value }), read => read(), () => {}, { getItem: () => null })
test('unexpected row objects report a format error without crashing the whole finance page', () => {
  const result = Table({ columns: [{ key: 'name', label: '名称' }], rows: { list: [{ name: '测试' }] }, empty: '暂无记录' })
  assert.match(JSON.stringify(result), /列表数据格式异常/)
  assert.match(JSON.stringify(result), /alert/)
})
test('valid row arrays retain their data and empty arrays retain their empty state', () => {
  assert.match(JSON.stringify(Table({ columns: [{ key: 'name', label: '名称' }], rows: [{name:'有效记录'}], empty:'暂无记录' })), /有效记录/)
  assert.match(JSON.stringify(Table({ columns: [{ key: 'name', label: '名称' }], rows: [], empty:'暂无记录' })), /暂无记录/)
})
