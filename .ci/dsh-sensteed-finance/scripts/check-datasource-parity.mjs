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
// 收入调整八条公开路由必须全部可达，且不可添加契约外方法。
const revenueAdjustmentContract = await readFile(resolve(datasource, 'packages/contracts/src/api/revenue-plan-adjustment.contract.ts'), 'utf8')
const revenueAdjustmentRoutes = [...revenueAdjustmentContract.matchAll(/method: '(GET|POST|PUT|PATCH|DELETE)',\s+path: '(\/[^']*)'/g)].map(([, method, path]) => [method, '/finance' + path])
assert.equal(revenueAdjustmentRoutes.length, 8, '收入调整契约路由解析不足或发生变化')
const pluginRevenueRoutes = PUBLIC_FINANCE_ROUTES.filter(([, path]) => /^\/finance\/(revenue-plan-adjustments(?:\/|$)|revenue-plans\/:id\/adjustments$)/.test(path))
assert.deepEqual(pluginRevenueRoutes.map(route => route.join(' ')).sort(), revenueAdjustmentRoutes.map(route => route.join(' ')).sort(), '插件收入调整公开路由与权威契约不一致')
const revenueAdjustmentSchema = await readFile(resolve(datasource, 'packages/contracts/src/schemas/revenue-plan-adjustment.schema.ts'), 'utf8')
const revenueAdjustmentAst = ts.createSourceFile('revenue-plan-adjustment.schema.ts', revenueAdjustmentSchema, ts.ScriptTarget.Latest, true)
const revenueCreateStatement = revenueAdjustmentAst.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(revenueAdjustmentAst) === 'CreateRevenuePlanAdjustmentSchema'))
assert.ok(revenueCreateStatement, '未找到收入调整权威金额与原因校验')
const revenueCreateExports = {}
new Function('exports', 'z', ts.transpileModule(revenueCreateStatement.getText(revenueAdjustmentAst), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(revenueCreateExports, require('zod').z)
const revenueAdjustmentValidator = new Function('finite', await readFile(resolve(root, 'src/views/revenue-adjustment.js'), 'utf8') + '\nreturn validRevenueAdjustment')(value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value))
const revenueCreateCases = [{ newAmount: '90', reason: '调整' }, { newAmount: '60', reason: '调整' }, { newAmount: '150', reason: '调整' }, { newAmount: '0.29', reason: '调整' }, { newAmount: '99999999999999.99', reason: '调整' }, { newAmount: '100000000000000', reason: '调整' }, { newAmount: '90.001', reason: '调整' }, { newAmount: '-1', reason: '调整' }, { newAmount: 'NaN', reason: '调整' }, { newAmount: '90', reason: ' ' }, { newAmount: '90', reason: '字'.repeat(500) }, { newAmount: '90', reason: '字'.repeat(501) }]
for (const input of revenueCreateCases) {
  const plan = { plannedAmount: 100, actualAmount: 0 }
  const expected = revenueCreateExports.CreateRevenuePlanAdjustmentSchema.safeParse(input)
  assert.equal(Boolean(revenueAdjustmentValidator(plan, input.newAmount, input.reason)), expected.success, `收入调整金额或原因漂移 ${JSON.stringify(input)}`)
}
console.log(`PASS: ${revenueAdjustmentRoutes.length} 条收入调整公开路由、${revenueCreateCases.length} 组金额及原因边界与权威契约一致`)
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

// 两端直接执行同一组问答场景，比较结论、金额、证据和来源路由。
function assistantModule(source, dependencies = {}) {
  const exports = {}
  new Function('exports', 'require', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(exports, name => {
    assert.ok(dependencies[name], `问答核验遇到未知依赖 ${name}`)
    return dependencies[name]
  })
  return exports
}
const assistantFormat = assistantModule(formatSource)
const assistantUrl = assistantModule(await readFile(resolve(datasource, 'apps/web/components/finance/finance-url.ts'), 'utf8'))
const assistantWeb = assistantModule(await readFile(resolve(datasource, 'apps/web/components/finance/assistant-answer.ts'), 'utf8'), { './finance-format': assistantFormat, './finance-url': assistantUrl })
const assistantPlugin = new Function(await readFile(resolve(root, 'src/views/assistant-answer.js'), 'utf8') + '\nreturn { build: financeInlineAnswer, intent: financeQuestionIntent }')()
const assistantCases = [
  ['预算超支', {}],
  ['预算超支', { budget: { budgetVersionId: 'v1', list: [{ month: 1, budgetAmount: 0, prSubmittedAmount: 100.001, expenseType: 'MODEL_SPECIFIC' }, { month: 2, budgetAmount: 1000, prSubmittedAmount: 600 }] } }],
  ['预算超支', { budget: { budgetVersionId: 'v1', list: [{ budgetAmount: 100, prSubmittedAmount: 100 }] } }],
  ['资金缺口', { cash: { list: [{ projectedBalance: null, actualBalance: 100 }] } }],
  ['资金缺口', { cash: { list: [{ month: 2, projectedBalance: -1250.123 }, { month: 3, projectedBalance: null }] } }],
  ['资金缺口', { cash: { list: [{ projectedBalance: 0 }, { projectedBalance: null }] } }],
  ['资金缺口', { cash: { list: [{ projectedBalance: 100 }] } }],
  ['收支达成', { cash: { list: [] } }],
  ['收支达成', { cash: { list: [{ plannedIncome: 100, actualIncome: null, plannedExpense: 50, actualExpense: 0 }] } }],
  ['收支达成', { cash: { list: [{ plannedIncome: 0, actualIncome: 0, plannedExpense: 100, actualExpense: 120 }] } }],
  ['数据质量', { quality: { issues: [{ label: '缺失主体', count: 2, severity: 'WARN' }, { label: '缺失金额', count: 0, severity: 'INFO' }] } }],
  ['为什么利润下降', {}],
]
for (const [text, data] of assistantCases) {
  const context = { year: 2027, orgId: 'org-a', ...data }
  assert.equal(assistantPlugin.intent(text), assistantWeb.getQuestionIntent(text))
  assert.deepEqual(assistantPlugin.build(text, context), assistantWeb.buildFinanceAnswer(text, context), `可信问答口径漂移 ${text}`)
}
console.log(`PASS: ${assistantCases.length} 组可信财务问答结论、缺失值、金额与来源链接均与网页一致`)

// 报价台账：直接执行网页展示规则，比对币种精度、不可采用原因与有效期边界。
const quotePresentationModule = { exports: {} }
const quotePresentationSource = await readFile(resolve(datasource, 'apps/web/components/ce/ce-quote-presentation.ts'), 'utf8')
new Function('exports', ts.transpileModule(quotePresentationSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(quotePresentationModule.exports)
const pluginQuotePresentation = new Function(await readFile(resolve(root, 'src/views/bom.js'), 'utf8') + '\nreturn { reason: financeQuoteUnavailableReason, amount: financeQuoteAmount }')()
const quoteNow = Date.parse('2026-10-19T12:00:00Z')
for (const patch of [{}, { partNo: '' }, { partNo: '  ' }, { currency: 'USD' }, { currency: null }, { currency: ' cny ' }, { validUntil: 'invalid' }, { validUntil: '2026-10-19T11:59:59Z' }, { validUntil: '2026-10-19T12:00:00Z' }, { validUntil: '2026-10-19T12:00:01Z' }, { price: 50.1234 }, { price: 0 }, { price: 999999999999.9999 }]) {
  const quote = { partNo: 'P1', currency: 'CNY', price: 120, validUntil: null, ...patch }
  for (const editable of [true, false]) assert.equal(pluginQuotePresentation.reason(quote, editable, quoteNow), quotePresentationModule.exports.ceQuoteUnavailableReason(quote, editable, quoteNow), `报价可采用规则漂移 ${JSON.stringify(patch)}`)
  assert.equal(pluginQuotePresentation.amount(quote), quotePresentationModule.exports.ceQuoteAmount(quote), `报价精度或币种展示漂移 ${JSON.stringify(patch)}`)
}
console.log('OK: supplier quote eligibility, expiry boundary and four-decimal currency display')

// 归属登记与预览使用同一日历规则和本地零点，避免 JS 将 2 月 30 日自动进位。
const employmentModule = { exports: {} }
new Function('exports', ts.transpileModule(await readFile(resolve(datasource, 'apps/web/components/finance/employment-entry.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(employmentModule.exports)
const employmentStart = new Function(pluginSource + '\nreturn financeEmploymentStartISOString')()
for (const value of ['', 'invalid', '2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-01-00', '2026-1-1', '2028-02-29', '2026-10-19', '2026-03-08', '2026-11-01']) {
  assert.equal(employmentStart(value), employmentModule.exports.financeEmploymentStartISOString(value), `归属生效日期规则漂移 ${value}`)
}
console.log('OK: employment calendar validation and local-midnight effective dates')

// 预算条目：同一份输入在两端应标记同样字段，不只检查最终是否能保存。
const rowValidationModule = { exports: {} }
new Function('exports', ts.transpileModule(await readFile(resolve(datasource, 'apps/web/components/finance/budget-filing-row-validation.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(rowValidationModule.exports)
const pluginRowErrors = new Function(await readFile(resolve(root, 'src/views/budget-filing.js'), 'utf8') + '\nreturn financeBudgetRowErrors')()
const errorCases = [{}, { costItemId: 'gone' }, { month: '' }, { month: 13 }, { month: 1.5 }, { plannedAmount: '' }, { plannedAmount: '0' }, { plannedAmount: '-1' }, { plannedAmount: '0.291' }, { plannedAmount: '0.29' }, { plannedAmount: '1250.50' }, { plannedAmount: '999999999999.99' }, { plannedAmount: '1000000000000' }, { plannedAmount: 'Infinity' }, { description: '  ' }, { description: '字'.repeat(501) }]
const mappingCard = { configurationRequired: true, configurationImported: true, expenseMappings: [{ code: 'A', costItemId: 'c1', level1Name: '研发' }, { code: 'B', costItemId: 'c2', level1Name: '管理' }] }
for (const patch of errorCases) {
  const value = { costItemId: 'c1', expenseMappingCode: 'A', month: '1', plannedAmount: '1250.50', description: '材料测算', ...patch }
  for (const [card, level1] of [[undefined, undefined], [mappingCard, '研发'], [mappingCard, '管理'], [{ ...mappingCard, configurationImported: false }, '研发']]) {
    assert.deepEqual(pluginRowErrors(value, [{ id: 'c1' }], card, level1), rowValidationModule.exports.financeBudgetRowErrors(value, [{ id: 'c1' }], card, level1), `预算条目字段校验漂移 ${JSON.stringify(patch)} ${level1}`)
  }
}
console.log('OK: 64 budget draft field-validation cases including mapping scope and monetary precision')

// 预算退回、轮次复制与历史归属：错误位置和当地日期转换结果都必须一致。
const budgetDialogs = new Function(await readFile(resolve(root, 'src/views/budget-filing.js'), 'utf8') + '\nreturn {financeBudgetReasonError,financeBudgetDeadline,financeBudgetRoundErrors}')()
const webDialogs = rowValidationModule.exports
for (const reason of ['', ' ', '补充测算', '字'.repeat(500), '字'.repeat(501)]) assert.equal(budgetDialogs.financeBudgetReasonError(reason), webDialogs.financeBudgetReasonError(reason))
const invalidDeadlines = ['', 'invalid', '2027-02-29T18:30', '2028-02-30T18:30', '2027-04-31T18:30', '2027-13-01T10:00', '2027-01-01T24:00', '2027-01-01T10:60', '0000-01-01T10:00', '2027-01-01T10:00Z']
for (const value of [...invalidDeadlines, '2028-02-29T18:30', '2027-01-01T00:00', '2026-03-08T02:30', '2026-11-01T01:30']) {
  const actual = budgetDialogs.financeBudgetDeadline(value)
  assert.equal(actual, webDialogs.financeBudgetDeadline(value), `预算截止时间漂移 ${value}`)
  if (invalidDeadlines.includes(value)) assert.equal(actual, null, `预算截止时间发生进位 ${value}`)
}
assert.equal(budgetDialogs.financeBudgetDeadline('2028-02-29T18:30'), new Date('2028-02-29T18:30:00').toISOString())
if (process.env.TZ === 'America/New_York') assert.equal(budgetDialogs.financeBudgetDeadline('2026-03-08T02:30'), null, '拒绝夏令时缺失时刻')
for (const patch of [{}, {owners:{}}, {owners:{r1:'gone'}}, {owners:{r1:'x'.repeat(65)}}, {title:' '}, {title:'字'.repeat(150)}, {title:'字'.repeat(151)}, {dueAt:'2027-02-30T12:00'}, {reason:' '}, {reason:'字'.repeat(500)}, {reason:'字'.repeat(501)}]) {
  const value={owners:{r1:'user-1'},title:'调整轮次',dueAt:'2028-02-29T18:30',reason:'复核测算',...patch}
  for (const ownerOnly of [false,true]) assert.deepEqual(budgetDialogs.financeBudgetRoundErrors(value,[{id:'r1'}],['user-1'],ownerOnly), webDialogs.financeBudgetRoundErrors(value,[{id:'r1'}],['user-1'],ownerOnly))
}
const copyStatement=ast.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(declaration=>declaration.name.getText(ast)==='CopyBudgetRoundSchema'))
assert.ok(copyStatement)
const copyExports={}
new Function('exports','z',ts.transpileModule(copyStatement.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(copyExports,require('zod').z)
for (const [key,max] of [['title',150],['reason',500]]) {
  assert.ok(copyExports.CopyBudgetRoundSchema.shape[key].safeParse('字'.repeat(max)).success)
  assert.equal(copyExports.CopyBudgetRoundSchema.shape[key].safeParse('字'.repeat(max+1)).success,false)
}
console.log('OK: 5 rejection reasons, 14 local deadlines and 22 budget round/owner validation cases; copy text limits match Zod')

// 完整策略保留同一范围中的交叉限制，错误位置和摘要也必须一致。
const policyModule={exports:{}}
new Function('exports','require',ts.transpileModule(await readFile(resolve(datasource,'apps/web/components/finance/permission-policy-validation.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(policyModule.exports,()=>permissionModule.exports)
const policyPlugin=new Function(await readFile(resolve(root,'src/permission-catalog.js'),'utf8')+'\n'+await readFile(resolve(root,'src/views/permissions.js'),'utf8')+'\nreturn {financePolicyErrors,financePolicyScopes,financePolicyScopeSummary,financePolicyRequest}')()
const policyPeople=[{userId:'u1'}],policyRoles=[{id:'custom',enabled:true},{id:'off',enabled:false}],policyOrgs=[{id:'11111111-1111-4111-8111-111111111111',name:'虚构主体'}],policyDepartments=[{id:'22222222-2222-4222-8222-222222222222',name:'研发部'}]
const policyBase={subjectType:'USER',subjectId:'',userIds:['u1'],permissions:['cash.plan.read'],scopes:[{scopeType:'ORG',orgId:policyOrgs[0].id,departmentId:policyDepartments[0].id,yearFrom:'2027',yearTo:'2028'}],reason:'  复核职责  '}
const policyCases=[{}, {userIds:[]},{userIds:['gone']},{userIds:['x'.repeat(65)]},{userIds:Array(501).fill('u1')},{subjectType:'ROLE',subjectId:'custom'},{subjectType:'ROLE',subjectId:'off'},{subjectType:'ROLE',subjectId:'gone'},{subjectType:'TEAM'},{permissions:['unknown']},{permissions:Array(101).fill('cash.plan.read')},{permissions:[],scopes:[{scopeType:'ORG'}]},{scopes:[]},{scopes:Array(101).fill({scopeType:'SELF'})},{reason:''},{reason:' '},{reason:'字'.repeat(500)},{reason:'字'.repeat(501)},...['SELF','GLOBAL','ORG','DEPARTMENT','bad'].map(scopeType=>({scopes:[{scopeType}]})),...['',' ',2027,2027.5,'bad','2028','9007199254740992'].map(yearFrom=>({scopes:[{...policyBase.scopes[0],yearFrom,yearTo:'2027'}]})),{scopes:[{scopeType:'SELF',orgId:'gone'}]},{scopes:[{scopeType:'GLOBAL',departmentId:'gone'}]},{scopes:[{scopeType:'SELF',yearFrom:null,yearTo:null}]},{scopes:[{scopeType:'GLOBAL',yearFrom:'1900',yearTo:'2200'}]}]
for(const patch of policyCases){const value={...policyBase,...patch};for(const confirmed of [false,true])assert.deepEqual(policyPlugin.financePolicyErrors(value,policyPeople,policyRoles,policyOrgs,policyDepartments,confirmed),policyModule.exports.financePolicyErrors(value,policyPeople,policyRoles,policyOrgs,policyDepartments,confirmed));assert.deepEqual(policyPlugin.financePolicyScopes(value),policyModule.exports.financePolicyScopes(value));assert.equal(policyPlugin.financePolicyScopeSummary(value,policyOrgs,policyDepartments),policyModule.exports.financePolicyScopeSummary(value,policyOrgs,policyDepartments))}
assert.deepEqual(policyPlugin.financePolicyRequest(policyBase,policyPeople,policyRoles,policyOrgs,policyDepartments).body.scopes,[{scopeType:'ORG',orgId:policyOrgs[0].id,departmentId:policyDepartments[0].id,yearFrom:2027,yearTo:2028}])
const scopeStatement=ast.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(declaration=>declaration.name.getText(ast)==='PermissionPolicyScopeSchema'))
const scopeExports={};new Function('exports','z',ts.transpileModule(scopeStatement.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(scopeExports,require('zod').z)
assert.ok(scopeExports.PermissionPolicyScopeSchema.safeParse(policyPlugin.financePolicyScopes(policyBase)[0]).success)
for(const member of memberCases)assert.equal(pluginPeople({members:[member]},'permission').length>0,memberModule.exports.canSelectOrganizationMember(member,'permission'),`完整策略成员资格漂移 ${member.userId}`)
console.log(`OK: ${policyCases.length} complete-policy drafts: field errors with/without confirmation, intersecting scopes, summaries and member eligibility match`)
