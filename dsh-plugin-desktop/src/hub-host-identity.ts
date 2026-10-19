/** L0 identity ownership: device UUID comes only from authenticated Hub bind; Profile UUID is local. */
import{createHash,randomUUID}from'node:crypto'
import{existsSync,lstatSync,mkdirSync,readFileSync,realpathSync}from'node:fs'
import{join}from'node:path'
import{withFileLock,writeFileAtomic}from'@deepseek-ai/dsh-atomic-write'
import{z}from'zod'
import{HUB_GENERATION_ORIGIN,type HubGenerationIdentity}from'./hub-generation-store.ts'
import type{HubHostClient,HubHostContext}from'./hub-host-client.ts'
const record=z.strictObject({schemaVersion:z.literal(1),origin:z.literal(HUB_GENERATION_ORIGIN),tenantId:z.uuid(),actorRef:z.string().min(1).max(128),deviceId:z.uuid(),profileId:z.uuid(),profilePath:z.string().min(1)})
function privateEntry(path:string,directory:boolean){const s=lstatSync(path);if(s.isSymbolicLink()||(directory?!s.isDirectory():!s.isFile()||s.nlink!==1)||typeof process.getuid==='function'&&s.uid!==process.getuid()||process.platform!=='win32'&&(s.mode&0o077)!==0)throw new Error('Unsafe Hub identity storage')}
/** Read-only identity lookup for a previously authenticated, signed healthy boot. Never binds a device. */
export function readHubHostIdentity(userData:string,profileDirectory:string,owner:{tenantId:string;actorRef:string}):HubGenerationIdentity|undefined{
 if(realpathSync(userData)!==userData||realpathSync(profileDirectory)!==profileDirectory)throw new Error('Hub identity requires canonical roots')
 const root=join(userData,'hub-identities');if(!existsSync(root))return undefined;privateEntry(root,true)
 const scope=createHash('sha256').update(JSON.stringify([owner.tenantId,owner.actorRef,profileDirectory])).digest('hex'),path=join(root,`${scope}.json`)
 if(!existsSync(path))return undefined
 privateEntry(path,false);if(lstatSync(path).size>4096)throw new Error('Oversized Hub identity')
 const value=record.parse(JSON.parse(readFileSync(path,'utf8')))
 if(value.tenantId!==owner.tenantId||value.actorRef!==owner.actorRef||value.profilePath!==profileDirectory)throw new Error('Hub identity scope mismatch')
 const{schemaVersion:_version,profilePath:_path,...identity}=value;return Object.freeze(identity)
}
export async function resolveHubHostIdentity(userData:string,profileDirectory:string,client:HubHostClient,context:HubHostContext):Promise<HubGenerationIdentity>{
 if(realpathSync(userData)!==userData||realpathSync(profileDirectory)!==profileDirectory)throw new Error('Hub identity requires canonical roots')
 const root=join(userData,'hub-identities');if(!existsSync(root))mkdirSync(root,{mode:0o700});privateEntry(root,true)
 const scope=createHash('sha256').update(JSON.stringify([context.tenantId,context.actorRef,profileDirectory])).digest('hex'),path=join(root,`${scope}.json`)
 if(existsSync(`${path}.lock`))privateEntry(`${path}.lock`,false)
 return await withFileLock(path,async()=>{
  client.assertCurrent(context);privateEntry(root,true)
  let value:z.infer<typeof record>
  if(existsSync(path)){
   privateEntry(path,false);if(lstatSync(path).size>4096)throw new Error('Oversized Hub identity')
   value=record.parse(JSON.parse(readFileSync(path,'utf8')))
   if(value.tenantId!==context.tenantId||value.actorRef!==context.actorRef||value.profilePath!==profileDirectory)throw new Error('Hub identity scope mismatch')
  }else{
   const deviceId=await client.bindDevice(context,{application:'sensteed-agent',binding:'hub-generation-v1'})
   client.assertCurrent(context)
   value={schemaVersion:1,origin:HUB_GENERATION_ORIGIN,tenantId:context.tenantId,actorRef:context.actorRef,deviceId,profileId:randomUUID(),profilePath:profileDirectory}
   await writeFileAtomic(path,JSON.stringify(value),{mode:0o600})
  }
  client.assertCurrent(context)
  const{schemaVersion:_version,profilePath:_path,...identity}=value;return Object.freeze(identity)
 })
}
