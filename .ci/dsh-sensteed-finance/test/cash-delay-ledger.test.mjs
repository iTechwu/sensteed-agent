import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
const source = (await Promise.all(['src/format.js', 'src/views/cash.js'].map(file => readFile(new URL('../' + file, import.meta.url), 'utf8')))).join('\n')
const nodes = tree => tree && typeof tree === 'object' ? [tree, ...(tree.children || []).flatMap(nodes)] : []
function harness() {
  const values = [], refs = []; let cursor = 0, refCursor = 0
  const useState = initial => { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], value => { values[i] = typeof value === 'function' ? value(values[i]) : value }] }
  const useRef = initial => { const i = refCursor++; return refs[i] ||= { current: initial } }
  const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) })
  const components = Object.fromEntries(['Card','Dialog','GhostButton','PrimaryButton','FormRow','Field','Textarea','Select','LinkButton','Table','Pager'].map(name => [name,name]))
  const ui = new Function('h','useState','useRef',...Object.keys(components),'const PAGE_SIZE = 20;\n' + source + '\nreturn {ScheduleDialog, PlansTab, RevenueTab, cashSummaryModel}')(h,useState,useRef,...Object.values(components))
  return { ui, render: (name, props) => { cursor = refCursor = 0; return ui[name]({ t: key => key, ...props }) } }
}
const find = (tree, type) => nodes(tree).find(node => node.type === type)
const plan = { id: 'plan-a', planMonth: 10, plannedAmount: 100, actualAmount: 60 }
test('summary preserves signed posted adjustments and unknown legacy totals', () => {
  const {ui} = harness(), now = new Date('2026-10-19T00:00:00Z')
  const row = { year:2026, month:10, incomeAdjustment:10, expenseAdjustment:-20, remainingReceipt:60 }
  assert.equal(ui.cashSummaryModel([row],2026,now).totals.expenseAdjustment,-20)
  assert.equal(ui.cashSummaryModel([row, { year:2026,month:10 }],2026,now).totals.remainingReceipt,null)
})
test('unknown delay is displayed separately from explicitly not deferred', () => {
  const {ui} = harness(), tree = ui.PlansTab({ rows:[plan], t:key=>key })
  const column = find(tree,'Table').props.columns.find(col=>col.key==='delayStatus')
  assert.equal(column.render(plan),'未确认延期')
  assert.equal(column.render({...plan,delayStatus:'NOT_DELAYED'}),'未延期')
})
test('delay requires dates/reason, preserves the plan month and submits explicit evidence', async () => {
  const h = harness(), writes=[], props={plan,onClose(){},act:async(path,body)=>{writes.push({path,body});return true}}
  let tree=h.render('ScheduleDialog',props)
  find(tree,'Select').props.onChange('DELAYED'); tree=h.render('ScheduleDialog',props)
  await tree.props.footer.find(node=>node.props.key==='ok').props.onClick()
  assert.equal(writes.length,0)
  tree=h.render('ScheduleDialog',props)
  const fields=nodes(tree).filter(node=>node.type==='Field'&&node.props.type==='date')
  fields[0].props.onChange('2026-10-01'); fields[1].props.onChange('2026-11-01')
  find(tree,'Textarea').props.onChange('供应商确认延期')
  tree=h.render('ScheduleDialog',props)
  await tree.props.footer.find(node=>node.props.key==='ok').props.onClick()
  assert.equal(writes.length,1)
  assert.equal(writes[0].body.delayStatus,'DELAYED')
  assert.equal(writes[0].body.originalScheduleDate,'2026-09-30T16:00:00.000Z')
  assert.equal(writes[0].body.deferredUntil,'2026-10-31T16:00:00.000Z')
  assert.equal(writes[0].body.planMonth,undefined)
})
test('revenue adjustment action is available only to writers', () => {
  const h=harness(), props={revenues:{list:[plan]},t:key=>key,onAdjust(){}}
  let tree=h.ui.RevenueTab({...props,canWrite:true}), actions=find(tree,'Table').props.columns.find(col=>col.key==='actions').render(plan)
  assert.ok(nodes(actions).some(node=>node.children.includes('调增/调减')))
  tree=h.ui.RevenueTab({...props,canWrite:false}); actions=find(tree,'Table').props.columns.find(col=>col.key==='actions').render(plan)
  assert.ok(!nodes(actions).some(node=>node.children.includes('调增/调减')))
})
