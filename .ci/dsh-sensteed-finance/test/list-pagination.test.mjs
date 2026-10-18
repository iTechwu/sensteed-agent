import test from 'node:test'
import assert from 'node:assert/strict'
import { needsCompleteList, completeFinanceList } from '../lib/list-pagination.js'
const data = (page, list, total = 201) => ({ list, total, page, limit: 200, activeVersion: 3 })
test('complete list crosses the old 200-row limit and preserves metadata', async () => {
  const rows = Array.from({length:201}, (_,i)=>({id:String(i)}))
  const queries=[]
  const result=await completeFinanceList(data(1,rows.slice(0,200)),async query=>{queries.push(query);return data(2,rows.slice(200))})
  assert.deepEqual(result.list,rows)
  assert.equal(result.activeVersion,3)
  assert.deepEqual(queries,[{page:2,limit:200}])
})
test('explicit page and operational lists retain caller pagination', () => {
  assert.equal(needsCompleteList('/ce/packages/p/quotes'),true)
  assert.equal(needsCompleteList('/finance/orgs'),true)
  assert.equal(needsCompleteList('/finance/access-roles'),true)
  assert.equal(needsCompleteList('/finance/permission-policies'),true)
  assert.equal(needsCompleteList('/finance/orgs',{page:2}),false)
  assert.equal(needsCompleteList('/finance/payment-plans'),false)
})
test('failed or inconsistent later page never yields a partial list', async () => {
  const rows=Array.from({length:200},(_,i)=>({id:String(i)}))
  for (const next of [data(2,[]),data(2,[{id:'0'}]),data(2,[{id:'200'}],202)]) {
    await assert.rejects(completeFinanceList(data(1,rows),async()=>next),/列表/)
  }
  await assert.rejects(completeFinanceList(data(1,rows),async()=>{throw new Error('403')}),/403/)
})
test('rolling upgrade accepts old array and list-only responses', async()=>{
  assert.deepEqual(await completeFinanceList([],()=>assert.fail()),[])
  assert.deepEqual(await completeFinanceList({list:[]},()=>assert.fail()),{list:[]})
})
