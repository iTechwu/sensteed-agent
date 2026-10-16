// 源码契约检查：发版前用当前 Datasource checkout 检查路由及回填识别文案。
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const datasource = resolve(process.argv[2] || resolve(root, '../../../datasource.dofe.ai'))
const navigation = await readFile(resolve(root, 'src/navigation.js'), 'utf8')
const destination = new Function(navigation + '\nreturn financeBusinessDestination')()
const paths = [
  '/dashboard', '/budget', '/budget-engine', '/cash', '/operations', '/alerts', '/data-center',
  '/review', '/data-entry', '/assistant', '/cost-engineering', '/notifications',
  '/budget/comparison/monthly-roll', '/budget/comparison/yearly', '/budget/comparison/versions',
  '/filing/budget', '/filing/tasks', '/filing/department', '/filing/records', '/filing/activities',
  '/settings/identity/members', '/settings/identity/directory', '/settings/identity/employment', '/settings/identity/permissions',
]
for (const path of paths) {
  await access(resolve(datasource, 'apps/web/app/[locale]', '.' + path, 'page.tsx'))
  assert.ok(destination(path), `插件缺少业务目的地 ${path}`)
}
const require = createRequire(resolve(datasource, 'apps/web/package.json'))
const ts = require('typescript')
const webSource = await readFile(resolve(datasource, 'apps/web/components/finance/finance-plan-label.ts'), 'utf8')
const module = { exports: {} }
new Function('exports', ts.transpileModule(webSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(module.exports)
const pluginSource = await readFile(resolve(root, 'src/views/entry.js'), 'utf8')
const pluginLabel = new Function(pluginSource + '\nreturn financePlanOptionLabel')()
for (const kind of ['payment', 'revenue']) {
  for (const details of [
    { orgName: '甲公司', year: 2026, planMonth: 6, month: 7, plannedAmount: 1250.5 },
    { year: 2027, month: null, planMonth: null, plannedAmount: 0 },
    { plannedAmount: null },
  ]) {
    const plan = { id: 'abcdef01-1', description: '设备款', itemName: '项目收入', ...details }
    assert.equal(pluginLabel(plan, kind), module.exports.financePlanOptionLabel(plan, kind))
  }
}
// 直接从权威 Zod 定义提取预算行校验，防止两端金额、月份和说明规则漂移。
const schemaSource = await readFile(resolve(datasource, 'packages/contracts/src/schemas/budget-filing.schema.ts'), 'utf8')
const ast = ts.createSourceFile('schema.ts', schemaSource, ts.ScriptTarget.Latest, true)
const statement = ast.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === 'BudgetRowBodySchema'))
assert.ok(statement, '未找到预算条目的权威校验')
const schemaModule = { exports: {} }
new Function('require', 'exports', ts.transpileModule("import { z } from 'zod';\n" + statement.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(require, schemaModule.exports)
const rowParser = new Function(await readFile(resolve(root, 'src/views/budget-filing.js'), 'utf8') + '\nreturn financeBudgetRowBody')()
const base = { costItemId: '11111111-1111-4111-8111-111111111111', month: 1, plannedAmount: 1250.5, description: '预算说明' }
const cases = [{}, { month: 0 }, { month: 13 }, { month: 1.5 }, { plannedAmount: 0 }, { plannedAmount: -1 }, { plannedAmount: 1.001 }, { plannedAmount: 0.29 }, { plannedAmount: 999999999999.99 }, { plannedAmount: 1000000000000 }, { description: '  ' }, { description: '字'.repeat(501) }]
for (const patch of cases) {
  const value = { ...base, ...patch }
  const expected = schemaModule.exports.BudgetRowBodySchema.safeParse(value)
  let actual, passed = true
  try { actual = rowParser(value, [{ id: base.costItemId }]) } catch { passed = false }
  assert.equal(passed, expected.success, `预算行校验漂移 ${JSON.stringify(patch)}`)
  if (passed) assert.deepEqual(actual, expected.data)
}
process.stdout.write(`PASS: ${paths.length} 个网页业务目的地、6 组回填文案、${cases.length} 组预算行契约一致\n`)
