import test from 'node:test'
import assert from 'node:assert/strict'
import { generationIntent, callGenerationManager } from '../hub-generation-bridge.js'
const id='f7526a4e-476a-478d-9e42-ad13d2e798ea'
test('forwards only complete selection UUID intents to actual Host manager',async()=>{
 const input={channel:'stable',requested:[{kind:'plugin',itemId:id,action:'install',enabled:true}]}
 let received
 const manager={check(){},preview(v){received=v;return {intentId:id}},execute(){},status(){}}
 assert.deepEqual(await callGenerationManager({hubGenerationManager:manager},'preview',input),{available:true,result:{intentId:id}})
 assert.deepEqual(received,input)
})
test('rejects identity, target, URL and grant smuggling and duplicate items',()=>{
 for(const key of ['tenantId','profileId','target','executionGrant','url']) assert.throws(()=>generationIntent('check',{channel:'stable',[key]:'untrusted'}))
 const item={kind:'skill',itemId:id,action:'retain',enabled:true}
 assert.throws(()=>generationIntent('preview',{channel:'stable',requested:[item,item]}))
 assert.throws(()=>generationIntent('execute',{intentId:id,confirmationNonce:id,plan:{}}))
})
test('missing or partial service clearly reports base version unavailable without executing',async()=>{
 assert.deepEqual(await callGenerationManager({},'check',{channel:'beta'}),{available:false,reason:'BASE_VERSION_NOT_ENABLED'})
 assert.equal((await callGenerationManager({hubGenerationManager:{check(){throw Error('must not run')}}},'check',{channel:'stable'})).available,false)
})

test('check preserves omitted versus explicit channel intent and rejects invalid channels',async()=>{
 assert.deepEqual(generationIntent('check',{}),{})
 for(const channel of ['stable','beta'])assert.deepEqual(generationIntent('check',{channel}),{channel})
 for(const channel of [null,1,'nightly'])assert.throws(()=>generationIntent('check',{channel}))
 assert.throws(()=>generationIntent('preview',{requested:[]}))
 let received;const manager={check(v){received=v;return{channel:'beta'}},preview(){},execute(){},status(){}}
 assert.deepEqual(await callGenerationManager({hubGenerationManager:manager},'check',{}),{available:true,result:{channel:'beta'}})
 assert.deepEqual(received,{})
})
