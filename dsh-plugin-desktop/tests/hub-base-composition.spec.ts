import{expect,it}from'vitest'
import{hubBaseComposition,hubOverlayComposition}from'../src/hub-base-composition.ts'
it('retains all sealed bundled business rows alongside shell/auth and core',()=>{
 const patch=hubBaseComposition([{insert:[{id:'core',name:'@deepseek-ai/dsh-skill'},{id:'shell',name:'dsh-plugin-desktop'},{id:'auth',name:'@dofe/dsh-sensteed-product/dofe-host-auth'},{id:'managed',name:'@dofe/dsh-sensteed-product/dofe-managed'},{id:'finance',name:'@dofe/dsh-sensteed-finance'},{id:'user',name:'arbitrary'}]}])
 expect(patch[0]?.insert?.map(row=>row.id)).toEqual(['core','shell','auth','managed','finance','user'])
})

it('closes native npm plugin admission while preserving core configuration and inventory',()=>{const names=['@deepseek-ai/dsh-plugin-manager','@deepseek-ai/dsh-plugin-manager/tools','@deepseek-ai/dsh-client-ui-plugin-manager','@deepseek-ai/dsh-client-ui-settings-plugin-inventory','@deepseek-ai/dsh-client-ui-settings','@deepseek-ai/dsh-tools','@dofe/dsh-sensteed-product'];expect(hubBaseComposition([{insert:names.map((name,index)=>({id:String(index),name}))}])[0]?.insert?.map(row=>row.name)).toEqual(names.slice(3))})

it('suppresses every bundled subpath of a disabled managed package during boot and HMR',()=>{
 const name='@dofe/dsh-sensteed-finance'
 const base=[{insert:[{id:'core',name:'@deepseek-ai/dsh-skill'},{id:'finance-host',name},{id:'finance-client',name:`${name}/client`},{id:'finance-tools',name:`${name}/tools`}]}]
 expect(hubOverlayComposition(base,{insert:[]},[name])).toEqual([{insert:[{id:'core',name:'@deepseek-ai/dsh-skill'}]}])
})
