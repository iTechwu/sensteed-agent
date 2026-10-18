// 源码契约检查：发版前用当前 Datasource checkout 检查路由及回填识别文案。
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { PUBLIC_FINANCE_ROUTES } from '../public-routes.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const datasource = resolve(process.argv[2] || resolve(root, '../../../datasource.dofe.ai'))
const navigation = await readFile(resolve(root, 'src/navigation.js'), 'utf8')
const destination = new Function(navigation + '\nreturn financeBusinessDestination')()
const paths = [
  '/data-center/cost-items', '/dashboard', '/budget', '/budget-engine', '/cash', '/operations', '/alerts', '/data-center',
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
const filingContract = await readFile(resolve(datasource, 'packages/contracts/src/api/budget-filing.contract.ts'), 'utf8')
const filingRoutes = [...filingContract.matchAll(/method: '(GET|POST|PUT)',\s+path: '(\/(?:budget-filing|permission-policies|access-roles|member-roles)[^']*)'/g)]
for (const [, method, path] of filingRoutes) {
  assert.ok(PUBLIC_FINANCE_ROUTES.some(([actualMethod, actualPath]) => actualMethod === method && actualPath === '/finance' + path), `插件未覆盖预算填报契约 ${method} ${path}`)
}
const permissionModule = { exports: {} }
new Function('exports', ts.transpileModule(await readFile(resolve(datasource, 'packages/constants/src/finance-permissions.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(permissionModule.exports)
const pluginPermissions = new Function(await readFile(resolve(root, 'src/permission-catalog.js'), 'utf8') + '\nreturn {FINANCE_PERMISSION_NAMES,FINANCE_PERMISSION_GROUPS,FINANCE_HIGH_RISK_PERMISSIONS,FINANCE_ROLE_PERMISSION_BASELINE,FINANCE_POLICY_ROLE_NAMES}')()
for (const [local, upstream] of Object.entries({ FINANCE_PERMISSION_NAMES: 'FINANCE_PERMISSIONS', FINANCE_PERMISSION_GROUPS: 'FINANCE_PERMISSION_GROUPS', FINANCE_HIGH_RISK_PERMISSIONS: 'FINANCE_HIGH_RISK_PERMISSIONS', FINANCE_ROLE_PERMISSION_BASELINE: 'FINANCE_ROLE_PERMISSION_BASELINE', FINANCE_POLICY_ROLE_NAMES: 'FINANCE_ROLE_NAMES' })) assert.deepEqual(pluginPermissions[local], permissionModule.exports[upstream], `财务权限展示契约漂移 ${local}`)
const memberSelector = await readFile(resolve(datasource, 'apps/web/components/finance/organization-member-selector.tsx'), 'utf8')
const memberAst = ts.createSourceFile('selector.tsx', memberSelector, ts.ScriptTarget.Latest, true)
const memberPredicate = memberAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'canSelectOrganizationMember')
assert.ok(memberPredicate, '未找到网页组织成员可选规则')
const memberModule = { exports: {} }
new Function('exports', ts.transpileModule(memberPredicate.getText(memberAst), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(memberModule.exports)
const pluginPeople = new Function(await readFile(resolve(root, 'src/views/permissions.js'), 'utf8') + '\nreturn financePolicyPeople')()
const memberCases = [
  { userId: 'active', enabled: true, identityEnabled: true, source: 'SSO_FEISHU' },
  { userId: 'reactivate', enabled: false, identityEnabled: true, source: 'SSO_NATIVE' },
  { userId: 'disabled', enabled: true, identityEnabled: false, source: 'SSO_FEISHU' },
  { userId: 'mirror', enabled: true, identityEnabled: true, source: 'LOCAL_MIRROR' },
  { userId: null, enabled: true, source: 'SSO_FEISHU' },
  { userId: 'fallback', enabled: true, source: 'SSO_NATIVE' },
  { userId: 'off', enabled: false, source: 'SSO_NATIVE' },
]
for (const member of memberCases) assert.equal(pluginPeople({ members: [member] }, 'role').length > 0, memberModule.exports.canSelectOrganizationMember(member, 'role'), `岗位分配成员资格漂移 ${member.userId}`)
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
// Round 5：资金证据契约、资金页签集合、版本名称展示与空版本引导的跨端一致。
const cashEvidenceRoutes = [...(await readFile(resolve(datasource, 'packages/contracts/src/api/cash-evidence.contract.ts'), 'utf8')).matchAll(/method: '(GET|POST|PUT)',\s+path: '(\/[^']*)'/g)]
assert.ok(cashEvidenceRoutes.length >= 7, '资金证据契约路由解析不足')
for (const [, method, path] of cashEvidenceRoutes) {
  assert.ok(PUBLIC_FINANCE_ROUTES.some(([actualMethod, actualPath]) => actualMethod === method && actualPath === '/finance/cash-evidence' + path), `插件未覆盖资金证据契约 ${method} ${path}`)
}
const cashSection = await readFile(resolve(datasource, 'apps/web/components/finance/cash-section.tsx'), 'utf8')
const webCashTabs = JSON.parse(cashSection.match(/const CASH_TABS = (\[[^\]]+\]) as const/)[1].replace(/'/g, '"'))
const cashView = await readFile(resolve(root, 'src/views/cash.js'), 'utf8')
const pluginCashTabs = [...cashView.match(/PillTabs, \{ tabs: (\[\[.*\]\]), value: tab/)[1].matchAll(/\['(\w+)',/g)].map(match => match[1])
assert.deepEqual([...pluginCashTabs].sort(), [...webCashTabs].sort(), '资金分析页签两端不一致')
const versionSelect = await readFile(resolve(datasource, 'apps/web/components/finance/budget-version-select.tsx'), 'utf8')
assert.match(versionSelect, /export function budgetVersionOptionLabel/, '网页缺少共享版本选项文案')
assert.match(versionSelect.match(/export function budgetVersionOptionLabel[\s\S]*?\n\}/)[0], /v\.name/, '版本选项未含自定义名称')
const engineConsole = await readFile(resolve(datasource, 'apps/web/components/budget-engine/budget-engine-console.tsx'), 'utf8')
assert.match(engineConsole, /budgetVersionOptionLabel\(v\)/, '全面预算版本选择未用共享文案')
assert.doesNotMatch(engineConsole, /\/data-entry\?year=/, '全面预算空版本仍引导到财务代录')
assert.match(engineConsole, /\/budget\/comparison\/versions\?year=/, '全面预算空版本未引导到版本对比')
const filingConsole = await readFile(resolve(datasource, 'apps/web/components/finance/filing-console.tsx'), 'utf8')
assert.match(filingConsole, /departmentId, orgId/, '网页活动创建未逐部门写归属主体')
const pluginEntry = await readFile(resolve(root, 'src/views/entry.js'), 'utf8')
assert.match(pluginEntry, /departmentId, orgId/, '插件活动创建未逐部门写归属主体')
process.stdout.write(`PASS: ${paths.length} 个网页业务目的地、${filingRoutes.length} 个预算及权限接口、${cashEvidenceRoutes.length} 个资金证据接口、5 组权限目录、${memberCases.length} 组岗位成员资格、6 组回填文案、${cases.length} 组预算行契约、资金页签/版本名称/空版本引导一致\n`)
// 付款/收入文字边界直接按权威 Zod 校验，避免自定义输入只在一端到提交时失败。
const entrySchemasSource = await readFile(resolve(datasource, 'packages/contracts/src/schemas/finance.schema.ts'), 'utf8')
const entryAst = ts.createSourceFile('finance.schema.ts', entrySchemasSource, ts.ScriptTarget.Latest, true)
const entryDeclarations = ['CreatePaymentPlanSchema', 'CreateRevenuePlanSchema'].map(name => {
  const node = entryAst.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(entryAst) === name))
  assert.ok(node, `未找到 ${name}`)
  return node.getText(entryAst)
})
const entryModule = { exports: {} }
// 这里仅检查文字字段，枚举不是本项检查对象；其余字段仍由服务端契约处理。
new Function('require', 'exports', ts.transpileModule("import { z } from 'zod';\nconst ExpenseTypeInputSchema = z.string(); const PlanTypeInputSchema = z.string();\n" + entryDeclarations.join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(require, entryModule.exports)
const entryLimits = new Function(pluginSource + '\nreturn FINANCE_ENTRY_TEXT_LIMITS')()
for (const [kind, fields] of Object.entries(entryLimits)) {
  const schema = entryModule.exports[kind === 'payment' ? 'CreatePaymentPlanSchema' : 'CreateRevenuePlanSchema']
  for (const [field, max] of Object.entries(fields)) {
    assert.ok(schema.shape[field].safeParse('字'.repeat(max)).success, `${kind}.${field} 不接受最大长度`)
    assert.equal(schema.shape[field].safeParse('字'.repeat(max + 1)).success, false, `${kind}.${field} 长度发生漂移`)
  }
}
console.log('PASS: 6 个付款/收入文字字段最大长度与权威 Zod 一致')
// 多月 URL 的规范化必须直接对照网页函数，而不是另写一份测试规则。
const filterSource = await readFile(resolve(datasource, 'apps/web/components/finance/plan-list-filters.tsx'), 'utf8')
const filterAst = ts.createSourceFile('plan-list-filters.tsx', filterSource, ts.ScriptTarget.Latest, true)
const monthsFunction = filterAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'readPlanMonths')
assert.ok(monthsFunction, '网页缺少计划月份规范化函数')
const filterModule = { exports: {} }
new Function('exports', ts.transpileModule(monthsFunction.getText(filterAst), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(filterModule.exports)
const pluginMonths = new Function(navigation + '\nreturn financePlanMonths')()
const monthCases = [[null, null], [null, '10'], ['10,1,10,0,13,x', '7'], ['', '7'], ['2,9', null], ['1.5,-1,12', '3']]
for (const [months, month] of monthCases) assert.deepEqual(pluginMonths(months, month), filterModule.exports.readPlanMonths(months, month), `计划月份筛选漂移 ${months}/${month}`)
const cashLink = destination('/cash?tab=plans&months=10,1&expenseType=FIXED_OPERATION&q=%E6%A8%A1%E5%85%B7&page=12&unassigned=1')
assert.deepEqual(cashLink.params, { months: [1, 10], keyword: '模具', unassigned: true, page: 12, expenseType: 'FIXED_OPERATION', view: 'plans' })
console.log(`PASS: ${monthCases.length} 组计划月份规范化与网页一致，资金深链保留搜索、费用、未分配和分页`)
// 排款日期与历史优先级直接执行两端当前函数，覆盖 UTC 跨日和无效值。
const scheduleSource = await readFile(resolve(datasource, 'apps/web/components/finance/payment-plans-view.tsx'), 'utf8')
const formatSource = await readFile(resolve(datasource, 'apps/web/components/finance/finance-format.ts'), 'utf8')
function upstreamFunction(source, name) {
  const ast = ts.createSourceFile('finance.tsx', source, ts.ScriptTarget.Latest, true)
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(node, `网页缺少 ${name}`)
  return new Function(ts.transpileModule(node.getText(ast).replace(/^export /, ''), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText + `\nreturn ${name}`)()
}
const webPlanDate = upstreamFunction(scheduleSource, 'planDate')
const webPriority = upstreamFunction(formatSource, 'normalizePaymentPriority')
const pluginSchedule = new Function(cashView + '\nreturn { actualPaymentDate, normalizePaymentPriority }')()
const dateCases = [null, '', 'invalid', '2026-10-15T16:00:00Z', '2026-10-16T15:59:59Z', '2026-10-16T16:00:00Z']
for (const date of dateCases) assert.equal(pluginSchedule.actualPaymentDate(date) ?? '—', webPlanDate(date), `排款日期漂移 ${date}`)
const priorityCases = [null, '', '高', '中', '低', 'priHigh', 'priMid', 'priLow', 'HIGH', 'MEDIUM', 'LOW', 'LEGACY']
for (const value of priorityCases) assert.equal(pluginSchedule.normalizePaymentPriority(value), webPriority(value), `排款优先级漂移 ${value}`)
assert.equal(destination('/data-center#source-records').tab, 'sources', '来源记录锚点未映射到来源工作台')
assert.match(await readFile(resolve(datasource, 'apps/web/components/finance/source-records-browser.tsx'), 'utf8'), /id="source-records"/, '网页来源记录锚点变更')
console.log(`PASS: ${dateCases.length} 组排款日期、${priorityCases.length} 组历史优先级与网页一致，来源记录锚点直达`)

// 收入执行偏差与未到账金额分别对照，不把来源差额直接当未到账。
const revenueHelpers = new Function(await readFile(resolve(root, 'src/format.js'), 'utf8') + '\n' + cashView + '\nreturn { revenueRemaining, revenueVariance }')()
const receiptCases = [
  { plannedAmount: 100, actualAmount: 40, varianceAmount: null },
  { plannedAmount: 100, actualAmount: 120, varianceAmount: null },
  { plannedAmount: 100, actualAmount: null, varianceAmount: null },
  { plannedAmount: null, actualAmount: 40, varianceAmount: null },
  { plannedAmount: 0, actualAmount: 0, varianceAmount: 0 },
  { plannedAmount: 0.3, actualAmount: 0.1, varianceAmount: null },
  { plannedAmount: 100, actualAmount: null, varianceAmount: 0 },
]
for (const name of ['revenueRemaining', 'revenueVariance']) {
  const webHelper = upstreamFunction(filterSource, name)
  for (const row of receiptCases) assert.equal(revenueHelpers[name](row), webHelper(row), `收入金额口径漂移 ${name}`)
}
assert.equal(destination('/cash?tab=revenue&incomeTypeName=销售收入').params.incomeTypeName, '销售收入')
console.log('PASS: 7 组收入执行偏差及未到账口径与网页一致，类型深链保留')
