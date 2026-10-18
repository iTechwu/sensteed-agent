import{expect,it}from'vitest'
import{hubBaseComposition}from'../src/hub-base-composition.ts'
it('retains explicit shell/auth and core rows while excluding bundled and user business packages',()=>{
 const patch=hubBaseComposition([{insert:[{id:'core',name:'@deepseek-ai/dsh-skill'},{id:'shell',name:'dsh-plugin-desktop'},{id:'auth',name:'@dofe/dsh-sensteed-product/dofe-host-auth'},{id:'managed',name:'@dofe/dsh-sensteed-product/dofe-managed'},{id:'finance',name:'@dofe/dsh-sensteed-finance'},{id:'user',name:'arbitrary'}]}])
 expect(patch[0]?.insert?.map(row=>row.id)).toEqual(['core','shell','auth'])
})

it('closes native npm plugin admission while preserving core configuration and inventory',()=>{const names=['@deepseek-ai/dsh-plugin-manager','@deepseek-ai/dsh-plugin-manager/tools','@deepseek-ai/dsh-client-ui-plugin-manager','@deepseek-ai/dsh-client-ui-settings-plugin-inventory','@deepseek-ai/dsh-client-ui-settings','@deepseek-ai/dsh-tools','@dofe/dsh-sensteed-product'];expect(hubBaseComposition([{insert:names.map((name,index)=>({id:String(index),name}))}])[0]?.insert?.map(row=>row.name)).toEqual(names.slice(3))})
