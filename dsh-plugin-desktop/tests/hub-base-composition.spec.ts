import{expect,it}from'vitest'
import{hubBaseComposition}from'../src/hub-base-composition.ts'
it('retains explicit shell/auth and core rows while excluding bundled and user business packages',()=>{
 const patch=hubBaseComposition([{insert:[{id:'core',name:'@deepseek-ai/dsh-skill'},{id:'shell',name:'dsh-plugin-desktop'},{id:'auth',name:'@dofe/dsh-sensteed-product/dofe-host-auth'},{id:'managed',name:'@dofe/dsh-sensteed-product/dofe-managed'},{id:'finance',name:'@dofe/dsh-sensteed-finance'},{id:'user',name:'arbitrary'}]}])
 expect(patch[0]?.insert?.map(row=>row.id)).toEqual(['core','shell','auth'])
})
