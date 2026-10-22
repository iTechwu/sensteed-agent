import {afterEach,expect,it,vi} from 'vitest'
const options=vi.hoisted(()=>({value:undefined as Record<string,unknown>|undefined}))
vi.mock('../src/desktop-mandatory-policy.ts',async original=>({
 ...await original<typeof import('../src/desktop-mandatory-policy.ts')>(),
 DesktopMandatoryUpdatePolicyClient:class{snapshot={phase:'none'};constructor(input:Record<string,unknown>){options.value=input}start(){}dispose(){}async check(){}},
}))
import {apply} from '../src/update-policy.ts'
afterEach(()=>{options.value=undefined})
it.each([{version:'2.0.19-next'}, {updates:{currentVersion:'0.2.1-rc.2-beta.202610221807'}}])('evaluates the launcher installed version for mandatory policy',async input=>{
 const runtime={platform:'darwin',reportMandatoryUpdatePolicy(){},registerTrayItem(){return{refresh(){},dispose(){}}},...input}
 await apply({desktopRuntime:runtime,provide(){},effect(){}} as never)
 expect(options.value?.currentVersion).toBe(input.version??input.updates?.currentVersion)
})
