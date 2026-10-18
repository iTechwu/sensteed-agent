import{mkdtempSync,mkdirSync,realpathSync,rmSync}from'node:fs'
import{tmpdir}from'node:os'
import{join}from'node:path'
import{randomUUID}from'node:crypto'
import{expect,it,vi}from'vitest'
import{registerHubGenerationManager}from'../src/hub-generation-manager.ts'
it('restores identity for status on a new base Host and fences restart until acknowledged staging',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'hub-manager-'))),profile=join(root,'profile');mkdirSync(profile)
 let listener=()=>{},ready=()=>{};const cleanup:(()=>void)[]=[]
 const context={tenantId:randomUUID(),actorRef:'user@example.com',workspaceId:randomUUID(),permissions:[],revision:0}
 const client={context:vi.fn(async()=>context),assertCurrent:()=>{},bindDevice:vi.fn(async()=>randomUUID()),watchInvalidation:(fn:()=>void)=>{listener=fn;return()=>{listener=()=>{}}}}
 let manager:any;const request=vi.fn()
 const scope:any={hubHostClient:client,hubGenerationSupervisor:{request},provide:(_key:string,value:unknown)=>{manager=value},effect:(fn:()=>()=>void)=>{cleanup.push(fn())},inject:(_keys:string[],fn:(v:unknown)=>void)=>fn({appReady:{onReady:(fn:()=>void)=>{ready=fn}}}),logger:()=>({warn:()=>{}})}
 registerHubGenerationManager({inject:(_keys:string[],fn:(v:unknown)=>void)=>fn(scope)}as never,{target:{sensteedVersion:'1.0.0',harnessVersion:'1.0.0',os:'darwin',arch:'arm64',nodeVersion:'22.0.0',cordisVersion:'4.0.5',libc:null,nodeAbi:'127',hostCapabilities:[],hostBuildDigest:'b'.repeat(64)},userData:root,profileDirectory:profile})
 try{
 await expect(manager.status({})).rejects.toThrow('HUB_OPERATION_NOT_FOUND')
 expect(client.bindDevice).toHaveBeenCalledOnce()
 await expect(manager.restart({operationId:randomUUID()})).rejects.toThrow('HUB_RESTART_NOT_READY')
 expect(request).not.toHaveBeenCalled()
 ready();await new Promise(resolve=>setTimeout(resolve,20));const calls=client.context.mock.calls.length
 listener();await new Promise(resolve=>setTimeout(resolve,20));expect(client.context.mock.calls.length).toBeGreaterThan(calls)
 }finally{cleanup.forEach(fn=>fn());rmSync(root,{recursive:true,force:true})}
})
