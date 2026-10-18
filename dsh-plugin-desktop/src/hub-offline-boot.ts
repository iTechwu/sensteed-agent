/** Bounded reuse of an already healthy signed boot lease. Never installation authority. */
import { createHash } from 'node:crypto'
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync } from 'node:fs'
import { join,dirname } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'
import { HubGenerationStore, HUB_GENERATION_ORIGIN } from './hub-generation-store.ts'
import { HubExecutionJournal,parseHubHealthyInventory } from './hub-execution-journal.ts'
import { readHubHostIdentity } from './hub-host-identity.ts'
import type { HubHostClient } from './hub-host-client.ts'
import { verifyHubBootAuthorization } from './hub-boot-authorization.ts'
import { inspectSavedHubPlan } from './hub-saved-plan.ts'
import { verifyHubGenerationContent } from './hub-generation-content.ts'
import { hubSyncDigest, type HubReleaseTrust, type HubSyncTarget } from './hub-sync-verifier.ts'

const identitySchema=z.strictObject({origin:z.literal(HUB_GENERATION_ORIGIN),tenantId:z.uuid(),actorRef:z.string().min(1).max(128),deviceId:z.uuid(),profileId:z.uuid()})
const cacheSchema=z.strictObject({schemaVersion:z.literal(1),owner:z.strictObject({operator:z.string().min(1).max(128),tenantId:z.uuid()}),identity:identitySchema,lease:z.unknown(),inventory:z.unknown()})
type Options={userData:string;profileDirectory:string;client:HubHostClient;target:HubSyncTarget;trust:HubReleaseTrust;recoverUnconfirmed?:boolean}
function sameOwner(a:{operator:string;tenantId:string}|undefined,b:{operator:string;tenantId:string}):boolean{return a?.operator===b.operator&&a.tenantId===b.tenantId}
function privateEntry(path:string,directory:boolean){
 const s=lstatSync(path)
 if(s.isSymbolicLink()||(directory?!s.isDirectory():!s.isFile()||s.nlink!==1)||typeof process.getuid==='function'&&s.uid!==process.getuid()||process.platform!=='win32'&&(s.mode&0o077)!==0)throw new Error('Unsafe Hub offline boot storage')
}
function location(options:Pick<Options,'userData'|'profileDirectory'>,create=false){
 if(realpathSync(options.userData)!==options.userData||realpathSync(options.profileDirectory)!==options.profileDirectory)throw new Error('Hub offline boot requires canonical roots')
 const root=join(options.userData,'hub-offline-boot')
 if(!existsSync(root)){if(!create)return undefined;mkdirSync(root,{mode:0o700})}
 privateEntry(root,true)
 const path=join(root,`${createHash('sha256').update(options.profileDirectory).digest('hex')}.json`)
 if(existsSync(path))privateEntry(path,false)
 if(existsSync(`${path}.lock`))privateEntry(`${path}.lock`,false)
 return path
}
async function healthy(options:Options,identity:z.infer<typeof identitySchema>,lease:unknown,inventory?:unknown){
 const existing=readHubHostIdentity(options.userData,options.profileDirectory,identity)
 if(!existing||hubSyncDigest(existing)!==hubSyncDigest(identity))throw new Error('Hub offline identity mismatch')
 const store=new HubGenerationStore(options.userData,identity),state=store.readState(),record=inventory===undefined?new HubExecutionJournal(store).readHealthyInventory():parseHubHealthyInventory(inventory,store.scope)
 if(!record)throw new Error('Hub offline boot is not healthy')
 const saved=inspectSavedHubPlan(record,identity,options.target,options.trust)
 verifyHubBootAuthorization(lease,options.trust,{...identity,target:options.target,generationDigest:record.generationDigest,minimumPolicyRevision:saved.plan.policyRevision})
 // Base Host only: a crash may leave an unconfirmed candidate active. Restore
 // the proven prior checkpoint before boot, never mutate underneath a live managed Host.
 if(options.recoverUnconfirmed&&state.active?.descriptorDigest!==record.descriptorDigest&&state.previous?.descriptorDigest===record.descriptorDigest)await store.rollback(state.revision)
 const current=store.readState()
 if(current.phase==='verifying'||!current.active||record.descriptorDigest!==current.active.descriptorDigest)throw new Error('Hub offline boot is not healthy')
 // Rehash every file before granting a boot; the cached metadata alone proves nothing.
 store.activeDescriptor()
 verifyHubGenerationContent(store,saved.plan,options.trust)
 if(options.recoverUnconfirmed)await new HubExecutionJournal(store).restoreHealthyInventory(record)
 return {identity:Object.freeze(identity),lease,generationDigest:record.generationDigest}
}
export async function saveHubOfflineBoot(options:Options&{store:HubGenerationStore;lease:unknown}):Promise<void>{
 const owner=await options.client.offlineOwner()
 if(!owner||owner.operator!==options.store.identity.actorRef)throw new Error('Hub offline owner unavailable')
 const inventory=new HubExecutionJournal(options.store).readHealthyInventory()
 const value=cacheSchema.parse({schemaVersion:1,owner,identity:options.store.identity,lease:options.lease,inventory})
 await healthy({...options,recoverUnconfirmed:false},value.identity,value.lease,value.inventory)
 const path=location(options,true)!
 await withFileLock(path,async()=>{
  if(!sameOwner(await options.client.offlineOwner(),owner))throw new Error('Hub offline owner changed')
  location(options,true)
  await writeFileAtomic(path,JSON.stringify(value),{mode:0o600})
  if(!sameOwner(await options.client.offlineOwner(),owner)){clearHubOfflineBoot(options);throw new Error('Hub offline owner changed')}
 })
}
export async function loadHubOfflineBoot(options:Options){
 const owner=await options.client.offlineOwner(),path=location(options)
 if(!owner||!path||!existsSync(path))return undefined
 const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0))
 let value:z.infer<typeof cacheSchema>
 try{if(fstatSync(fd).size>1024*1024)throw new Error('Oversized Hub offline boot');value=cacheSchema.parse(JSON.parse(readFileSync(fd,'utf8')))}finally{closeSync(fd)}
 if(!sameOwner(owner,value.owner)||owner.operator!==value.identity.actorRef)return undefined
 const result=await healthy(options,value.identity,value.lease,value.inventory)
 if(!sameOwner(await options.client.offlineOwner(),owner))return undefined
 return result
}
/** A server refusal must survive a later cold offline restart. */
export function clearHubOfflineBoot(options:Pick<Options,'userData'|'profileDirectory'>):void{
 const path=location(options)
 if(path&&existsSync(path)){
  unlinkSync(path)
  if(process.platform!=='win32'){const fd=openSync(dirname(path),constants.O_RDONLY);try{fsyncSync(fd)}finally{closeSync(fd)}}
 }
}
