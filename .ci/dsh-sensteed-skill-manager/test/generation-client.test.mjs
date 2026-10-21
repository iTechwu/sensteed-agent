import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import test from 'node:test'
import assert from 'node:assert/strict'
const profile='f7526a4e-476a-478d-9e42-ad13d2e798ea', itemId='2b368726-e6b5-44e5-bc87-43c5bc004638'
function harness(responses={}) {
 const states=[],refs=[];let cursor=0,ref=0
 const calls=[]
 const react={createElement:(tag,props,...children)=>({tag,props:props||{},children:children.flat(Infinity).filter(i=>i!=null&&i!==false)}),useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],value=>states[i]=typeof value==='function'?value(states[i]):value]},useRef(value){return refs[ref++]??={current:value}},useEffect(){}}
 const module={exports:{}}
 runInNewContext(readFileSync(new URL('../src/client.js',import.meta.url),'utf8'),{module,require:name=>name==='react'?react:{},AbortSignal,URL,setTimeout,clearTimeout,fetch:async(url,options)=>{const method=url.split('/').at(-1);const input=JSON.parse(options.body);calls.push({method,input});return {ok:true,json:async()=>responses[method]||{available:false,reason:'BASE_VERSION_NOT_ENABLED'}}}})
 const api=module.exports.__test
 return {api,calls,render(){cursor=0;ref=0;return api.GenerationPanel({t:key=>key})}}
}
function nodes(root){return[root,...(root?.children||[]).flatMap(i=>typeof i==='object'?nodes(i):[])]}
function button(root,label){return nodes(root).find(i=>i.tag==='button'&&i.children.includes(label))}
const flush=()=>new Promise(r=>setImmediate(r))
test('complete choices preserve active identities and default required installation',()=>{
 const {api}=harness();const rows=api.generationSelection({channel:'stable',profileId:profile,entries:[{kind:'skill',itemId,required:true}],activeItems:[{kind:'plugin',itemId:profile,enabled:false}]})
 assert.deepEqual(Array.from(rows,i=>i.action),['install','retain']);assert.equal(rows[1].enabled,false)
 assert.throws(()=>api.generationPreview({intentId:profile,confirmationNonce:profile,profileId:profile,planDigest:'a'.repeat(64),items:[],expiresAt:'2000-01-01T00:00:00Z'}))
})
for(const channel of ['stable','beta'])test(`actual preview and single nonce execution follow Host ${channel} result; no credentials or targets in renderer intent`,async()=>{
 const preview={intentId:profile,confirmationNonce:itemId,profileId:profile,planDigest:'a'.repeat(64),expiresAt:new Date(Date.now()+60000).toISOString(),totalBytes:42,items:[{kind:'skill',itemId,action:'install',enabled:true,accessDeclaration:{containsScripts:false,fileAccess:'none',networkHosts:[]}}]}
 const h=harness({check:{available:true,result:{channel,profileId:profile,entries:[{kind:'skill',itemId,required:true}],activeItems:[]}},preview:{available:true,result:preview},execute:{available:true,result:{operationId:profile,state:'consumed',phase:'COMMITTED',restartRequired:true}}})
 button(h.render(),'refresh').props.onClick();await flush()
 button(h.render(),'generationPreview').props.onClick();await flush()
 const confirm=button(h.render(),'generationExecute');assert.ok(confirm)
 confirm.props.onClick();confirm.props.onClick();await flush()
 assert.deepEqual(h.calls.find(i=>i.method==='check').input,{})
 assert.equal(h.calls.filter(i=>i.method==='execute').length,1)
 assert.deepEqual(h.calls.find(i=>i.method==='execute').input,{intentId:profile,confirmationNonce:itemId})
 assert.deepEqual(h.calls.find(i=>i.method==='preview').input,{channel,requested:[{kind:'skill',itemId,action:'install',enabled:true}]})
 assert.ok(nodes(h.render()).some(i=>i.children.includes('generationRestart')))
 assert.ok(!nodes(h.render()).some(i=>i.tag==='button'&&i.children.some(c=>String(c).includes('restart'))))
})
test('base-only Host has an explicit state without preview or execute buttons',async()=>{
 const h=harness();button(h.render(),'refresh').props.onClick();await flush()
 assert.ok(nodes(h.render()).some(i=>i.children.includes('generationBase')))
 assert.equal(button(h.render(),'generationPreview'),undefined)
 assert.equal(button(h.render(),'generationExecute'),undefined)
})

for(const channel of [undefined,null,'nightly'])test(`invalid Host check channel ${channel} fails closed without preview`,async()=>{
 const h=harness({check:{available:true,result:{channel,profileId:profile,entries:[{kind:'skill',itemId,required:true}],activeItems:[]}}})
 button(h.render(),'refresh').props.onClick();await flush()
 assert.equal(button(h.render(),'generationPreview'),undefined)
 assert.ok(nodes(h.render()).some(i=>i.children.includes('generationUnavailable')))
 assert.equal(h.calls.filter(i=>i.method==='preview').length,0)
})
