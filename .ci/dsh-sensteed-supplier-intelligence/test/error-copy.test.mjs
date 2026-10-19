import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
const source = await readFile(new URL('../src/head.js', import.meta.url), 'utf8')
const errorText = vm.runInNewContext(`${source}; errorText`, { require: () => ({}) })
test('connection failures explain recovery without making the user interpret service codes', () => {
  assert.equal(errorText(new Error('supply_chain_unavailable')), '供应链数据服务暂不可用，请稍后重试。')
  assert.equal(errorText(new Error('connection_unavailable')), '本地工作台连接已中断，请重新连接后重试。')
  assert.equal(errorText(new Error('VERSION_CONFLICT')), '记录已被其他操作更新，请刷新后重试。')
})
