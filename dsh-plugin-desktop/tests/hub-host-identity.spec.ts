import{expect,it,vi}from'vitest'
import{mkdtempSync,realpathSync,mkdirSync,rmSync}from'node:fs'
import{tmpdir}from'node:os'
import{join}from'node:path'
import{randomUUID}from'node:crypto'
import{resolveHubHostIdentity}from'../src/hub-host-identity.ts'
it('persists server device UUID per identity and local Profile UUID without accepting renderer identity',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'hub-identity-'))),profile=join(root,'profile');mkdirSync(profile,{mode:0o700})
 const deviceId=randomUUID(),bindDevice=vi.fn(async()=>deviceId),client={assertCurrent(){},bindDevice},context={tenantId:randomUUID(),actorRef:'sso:user@example.com',workspaceId:randomUUID(),permissions:[],revision:0}
 try{
  const a=await resolveHubHostIdentity(root,profile,client as never,context),b=await resolveHubHostIdentity(root,profile,client as never,context)
  expect(a).toEqual(b);expect(a.deviceId).toBe(deviceId);expect(bindDevice).toHaveBeenCalledOnce()
  const other=await resolveHubHostIdentity(root,profile,client as never,{...context,actorRef:'other'}as never)
  expect(other.profileId).not.toBe(a.profileId);expect(bindDevice).toHaveBeenCalledTimes(2)
 }finally{rmSync(root,{recursive:true,force:true})}
})
