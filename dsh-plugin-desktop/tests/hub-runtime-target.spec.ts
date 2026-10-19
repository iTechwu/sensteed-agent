import{expect,it}from'vitest'
import{readHubRuntimeTarget}from'../src/hub-runtime-target.ts'
it('does not manufacture an enterprise target for an unsealed development run',async()=>{
 expect(await readHubRuntimeTarget({isPackaged:false,appPath:'/unsealed/app',resourcesPath:'/unsealed/resources',sensteedVersion:'1.0.0'})).toBeUndefined()
})
