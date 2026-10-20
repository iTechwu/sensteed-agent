/** Real maintenance locks with a private per-suite state root; never touch operator state in unit tests. */
import {vi,beforeEach,afterAll} from 'vitest'
vi.mock('../src/desktop-maintenance.ts',async importOriginal=>{
 const original=await importOriginal<typeof import('../src/desktop-maintenance.ts')>()
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
 const root=await mkdtemp(join(tmpdir(),'desktop-maintenance-unit-'))
 const coordinator=new original.DesktopMaintenanceCoordinator(root,join(root,'state'))
 beforeEach(async()=>{
  await rm(join(root,'state'),{recursive:true,force:true})
  await coordinator.confirmBuild({hostBuildDigest:'a'.repeat(64),sensteedVersion:'0.2.1-beta.1'})
 })
 afterAll(async()=>{await rm(root,{recursive:true,force:true})})
 return {...original,withDesktopMaintenance:<T>(kind:import('../src/desktop-maintenance.ts').DesktopMaintenanceKind,action:()=>Promise<T>,hubRoot?:string)=>coordinator.run(kind,action,hubRoot)}
})

// Register per-test coordinator setup before any test body lazily imports the runtime.
await import('../src/desktop-maintenance.ts')
