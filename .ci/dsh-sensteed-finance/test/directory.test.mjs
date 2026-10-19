import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
const source = await readFile(new URL('../src/views/entry.js', import.meta.url), 'utf8')
const rows = new Function(source + '\nreturn financeDirectoryRows')()
const directory = { lastSyncedAt: '2026-10-18T00:00:00Z', departments: [{ id: 'd', name: '财务部' }], members: [
  { key: 'a', name: '甲', departmentIds: ['d'], source: 'SSO_FEISHU', enabled: false, identityEnabled: true },
  { key: 'b', name: '乙', departmentIds: [], source: 'SSO_NATIVE', enabled: true, identityEnabled: false },
  { key: 'c', name: '历史镜像', departmentIds: [], source: 'LOCAL_MIRROR', enabled: true },
] }
test('authoritative directory excludes local mirrors and separates identity readiness from finance enabled', () => {
  assert.deepEqual(rows(directory).map(row => [row.id, row.identityReady]), [['a', true], ['b', false]])
  assert.deepEqual(rows(directory, '', true).map(row => row.id), ['b'])
  assert.equal(rows(directory, ' 财务部 ')[0].name, '甲')
  assert.equal(rows(directory, '财务部')[0].syncedAt, directory.lastSyncedAt)
})
test('cost item canonical route is available only to the finance owner', async () => {
  const nav = await readFile(new URL('../src/navigation.js', import.meta.url), 'utf8')
  const workflows = await readFile(new URL('../src/workflows.js', import.meta.url), 'utf8')
  const { financeBusinessDestination: resolve, financeNavigationAllowed: allowed } = new Function(workflows + '\n' + nav + '\nreturn { financeBusinessDestination, financeNavigationAllowed }')()
  assert.deepEqual(resolve('/data-center/cost-items'), { tab: 'costitems', params: {} })
  for (const role of ['FINANCE_OWNER', 'FINANCE_STAFF', 'DEPT_FILLER']) assert.equal(allowed(['costitems', '费用类别', 'costitems'], { role, permissions: [] }), role === 'FINANCE_OWNER')
})
