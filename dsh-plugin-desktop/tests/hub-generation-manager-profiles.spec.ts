import {generateKeyPairSync,randomUUID,sign} from 'node:crypto'
import {mkdtempSync,realpathSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,expect,it,vi} from 'vitest'
import {registerHubGenerationManager} from '../src/hub-generation-manager.ts'
import {CONTENT_PROFILES_FILENAME,ContentProfileStore} from '../src/content-profiles.ts'
import {HubGenerationStore} from '../src/hub-generation-store.ts'
import {HubExecutionJournal} from '../src/hub-execution-journal.ts'
import {resolveHubHostIdentity} from '../src/hub-host-identity.ts'
import {inspectSavedHubPlan} from '../src/hub-saved-plan.ts'
import {readSealedHubReleaseTrust} from '../src/hub-release-trust.ts'
import {hubCanonicalJson,hubSyncDigest,verifyHubSyncSnapshot,type HubSyncExpected} from '../src/hub-sync-verifier.ts'
vi.mock('../src/hub-saved-plan.ts',()=>({inspectSavedHubPlan:vi.fn(),inspectSavedHubInventory:vi.fn()}))
vi.mock('../src/hub-host-identity.ts',()=>({resolveHubHostIdentity:vi.fn()}))
vi.mock('../src/hub-release-trust.ts',()=>({readSealedHubReleaseTrust:vi.fn()}))
const roots:string[]=[],cleanups:(()=>void)[]=[]
afterEach(()=>{for(const cleanup of cleanups.splice(0))cleanup();vi.restoreAllMocks();vi.clearAllMocks();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true})})
/** docs/1022 十次审查缺口 2：activate 意图的 Host 侧编排（模板出生重注册/自定义仅本地/未知 id/注册失败不置当前）。 */
function fixture(managed=false){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'hub-profiles-')));roots.push(root)
 const identity={origin:'https://ai.hozonauto.com/plugins/api' as const,tenantId:randomUUID(),actorRef:'test:user',deviceId:randomUUID(),profileId:randomUUID()}
 const target={sensteedVersion:'1.0.0',harnessVersion:'1.0.0',os:'darwin' as const,arch:'arm64' as const,nodeVersion:'22.0.0',cordisVersion:'4.0.5',libc:null,nodeAbi:'127',hostCapabilities:[],hostBuildDigest:'b'.repeat(64)}
 const keys=generateKeyPairSync('ed25519'),trust={schemaVersion:1 as const,keys:{test:keys.publicKey.export({type:'spki',format:'der'}).toString('base64')},revokedKeyIds:[]}
 vi.mocked(readSealedHubReleaseTrust).mockReturnValue(trust);vi.mocked(resolveHubHostIdentity).mockResolvedValue(identity)
 vi.spyOn(HubGenerationStore.prototype,'readState').mockReturnValue({active:null} as never)
 vi.spyOn(HubExecutionJournal.prototype,'read').mockReturnValue(undefined)
 const check=vi.fn(async(_context:unknown,_request:unknown,expected:HubSyncExpected)=>{
  const {minimumPolicyRevision:_floor,...binding}=expected,now=Date.now()
  const snapshot={...binding,schemaVersion:'hub-sync-v1',snapshotId:randomUUID(),policyRevision:1,catalogDigest:'d'.repeat(64),entries:[],issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+300000).toISOString()}
  return verifyHubSyncSnapshot({snapshot,signature:{algorithm:'Ed25519',canonicalization:'RFC8785',keyId:'test',payloadDigest:hubSyncDigest(snapshot),signature:sign(null,Buffer.from(hubCanonicalJson(snapshot)),keys.privateKey).toString('base64')}},trust,expected)
 })
 const registerTemplateSelection=vi.fn(async(_context:unknown,input:{templateId:string;revision:number;deviceId:string;profileId:string})=>({templateId:input.templateId,profileId:input.profileId,revision:input.revision,items:[],mcpEndpoints:[],skippedItems:[{item:{kind:'plugin',identity:'@x/y',version:'1.0.0',enabled:true},reason:'未发布到 stable 渠道'}]}))
 const registerOperationSelection=vi.fn(async()=>({items:[]}))
 const client={context:async()=>({tenantId:identity.tenantId,actorRef:identity.actorRef}),check,registerTemplateSelection,registerOperationSelection,watchInvalidation:()=>()=>{},watchOfflineDenial:()=>()=>{}}
 let manager!: {profiles(input:unknown):Promise<unknown>;status(input:unknown):Promise<unknown>}
 const policy={snapshot:()=>({phase:'none' as 'none'|'notice'|'blocking'}),ensureMutationAllowed:vi.fn(async()=>{})}
 const scope={get:()=>policy,hubHostClient:client,provide:(_name:string,value:unknown)=>{manager=value as typeof manager},effect:(fn:()=>()=>void)=>{cleanups.push(fn())},inject:()=>{}}
 registerHubGenerationManager({inject:(_keys:string[],fn:(v:unknown)=>void)=>fn(scope)} as never,{target,userData:root,profileDirectory:root,managed})
 const createTemplateBorn=async()=>{
  const profile=await new ContentProfileStore(join(root,CONTENT_PROFILES_FILENAME)).create('模板出生',{templateId:randomUUID(),templateRevision:3,items:[{kind:'skill',itemId:randomUUID(),enabled:true}],mcpEndpoints:[],skippedItems:[]})
  return profile.id
 }
 // 自定义组装不再有创建入口（§6.3 Tab B 等价 = 目录勾选流程）；早期实验壳的
 // 无模板来源行经直写存储落盘，验证 activate 仍按本地切换兼容。
 const legacyCustom=()=>{
  const id=randomUUID()
  writeFileSync(join(root,CONTENT_PROFILES_FILENAME),`${JSON.stringify({version:1,activeId:null,profiles:[{id,name:'自定义组装',summary:{skills:1,plugins:0,mcpEndpoints:0,skipped:0},items:[{kind:'skill',itemId:randomUUID(),enabled:true}],skippedItems:[],createdAt:new Date().toISOString()}]},null,2)}\n`)
  return id
 }
 return{root,manager,policy,check,registerTemplateSelection,registerOperationSelection,identity,createTemplateBorn,legacyCustom,active:()=>manager.profiles({action:'active'})}
}
it('activate on a template-born profile re-registers the frozen revision and reports skipped items',async()=>{
 const f=fixture(),id=await f.createTemplateBorn()
 await expect(f.manager.profiles({action:'activate',id})).resolves.toEqual({registered:true,skippedCount:1})
 expect(f.registerTemplateSelection).toHaveBeenCalledOnce()
 expect(f.registerTemplateSelection.mock.calls[0]![1]).toMatchObject({deviceId:f.identity.deviceId,profileId:f.identity.profileId,revision:3})
 await expect(f.active()).resolves.toBe(id)
 // 自定义组装不触达 Hub 注册
 expect(f.check).not.toHaveBeenCalled()
})
it('refuses to pretend that a legacy local-only Profile changed the Hub selection',async()=>{
 const f=fixture(),id=f.legacyCustom()
 await expect(f.manager.profiles({action:'activate',id})).rejects.toThrow('HUB_PROFILE_TEMPLATE_REQUIRED')
 expect(f.registerTemplateSelection).not.toHaveBeenCalled()
 await expect(f.active()).resolves.toBe(null)
})
it('can re-register a frozen template when legacy server selection makes catalog resolution fail closed',async()=>{
 const f=fixture(),id=await f.createTemplateBorn()
 f.check.mockRejectedValue(Error('legacy selection requires re-registration'))
 await expect(f.manager.profiles({action:'activate',id})).resolves.toMatchObject({registered:true})
 expect(f.check).not.toHaveBeenCalled()
})
it('activate on an unknown id fails without changing the active profile',async()=>{
 const f=fixture(),id=await f.createTemplateBorn()
 await expect(f.manager.profiles({action:'activate',id:randomUUID()})).rejects.toThrow('HUB_PROFILE_NOT_FOUND')
 await expect(f.active()).resolves.toBe(null)
 await expect(f.manager.profiles({action:'activate',id})).resolves.toEqual({registered:true,skippedCount:1})
})
it('a failed re-registration keeps the previously active profile',async()=>{
 const f=fixture(),first=await f.createTemplateBorn()
 await expect(f.manager.profiles({action:'activate',id:first})).resolves.toEqual({registered:true,skippedCount:1})
 const templateBorn=await f.createTemplateBorn()
 vi.mocked(f.registerTemplateSelection).mockRejectedValueOnce(new Error('HUB_UNAVAILABLE'))
 await expect(f.manager.profiles({action:'activate',id:templateBorn})).rejects.toThrow('HUB_UNAVAILABLE')
 await expect(f.active()).resolves.toBe(first)
})
it('does not acknowledge activation until its local selection is durable',async()=>{
 const f=fixture(),id=await f.createTemplateBorn()
 let release!:()=>void
 const gate=new Promise<void>(resolve=>{release=resolve})
 vi.spyOn(ContentProfileStore.prototype,'register').mockReturnValue(gate)
 let completed=false
 const selecting=f.manager.profiles({action:'activate',id}).then(value=>{completed=true;return value})
 await new Promise(resolve=>setImmediate(resolve))
 expect(completed).toBe(false)
 release()
 await expect(selecting).resolves.toMatchObject({registered:true})
})
it('rejects an activation whose local selection no longer exists',async()=>{
 const f=fixture(),id=await f.createTemplateBorn()
 vi.spyOn(ContentProfileStore.prototype,'register').mockRejectedValue(Error('HUB_PROFILE_NOT_FOUND'))
 await expect(f.manager.profiles({action:'activate',id})).rejects.toThrow('HUB_PROFILE_NOT_FOUND')
})

it.each(['create','set-active','mark-applied'])('rejects the renderer %s mutation bypass',async action=>{
 const f=fixture()
 await expect(f.manager.profiles({action,id:randomUUID()})).rejects.toThrow('HUB_PROFILE_ACTION_FORBIDDEN')
})
it('serializes overlapping template registrations and persists the same winner as Hub',async()=>{
 const f=fixture(),a=await f.createTemplateBorn(),b=await f.createTemplateBorn()
 let remote:string|undefined
 const profiles=new ContentProfileStore(join(f.root,CONTENT_PROFILES_FILENAME))
 const aTemplate=profiles.get(a)!.sourceTemplateId,bTemplate=profiles.get(b)!.sourceTemplateId
 let release!:()=>void,started!:()=>void
 const gate=new Promise<void>(resolve=>{release=resolve}),firstStarted=new Promise<void>(resolve=>{started=resolve})
 f.registerTemplateSelection.mockImplementation(async(_ctx,input)=>{
  remote=input.templateId
  if(remote===aTemplate){started();await gate}
  return{templateId:input.templateId,profileId:input.profileId,revision:input.revision,items:[],mcpEndpoints:[],skippedItems:[]}
 })
 const first=f.manager.profiles({action:'activate',id:a});await firstStarted
 const second=f.manager.profiles({action:'activate',id:b})
 await new Promise(resolve=>setImmediate(resolve))
 expect(remote).toBe(aTemplate)
 release();await first;await second
 expect(remote).toBe(bTemplate);await expect(f.active()).resolves.toBe(b)
 await expect(f.manager.profiles({action:'status'})).resolves.toMatchObject({registeredId:b,appliedId:null,apply:{phase:'registered'}})
})

it('reconciles an acknowledged healthy application on the Host after reconnect without renderer writes',async()=>{
 const f=fixture(true),id=await f.createTemplateBorn(),profiles=new ContentProfileStore(join(f.root,CONTENT_PROFILES_FILENAME))
 await f.manager.profiles({action:'activate',id})
 const scope=new HubGenerationStore(f.root,f.identity).scope
 const application={contentProfileId:id,selectionDigest:profiles.selectionDigest(id),operationId:randomUUID(),planDigest:'1'.repeat(64),generationDigest:'2'.repeat(64),scope}
 await profiles.beginApplication(application)
 const record={...application,phase:'ACTIVATED',pendingReceipt:null,descriptorDigest:'3'.repeat(64)}
 vi.mocked(HubExecutionJournal.prototype.read).mockReturnValue(record as never)
 vi.mocked(HubGenerationStore.prototype.readState).mockReturnValue({active:{descriptorDigest:record.descriptorDigest}} as never)
 vi.mocked(inspectSavedHubPlan).mockReturnValue({plan:{planId:randomUUID(),items:[]}} as never)
 await f.manager.status({operationId:application.operationId})
 expect(profiles.projection()).toMatchObject({appliedId:id,apply:{phase:'idle'}})
 expect(profiles.get(id)?.lastAppliedAt).toBeDefined()
 expect(profiles.get(id)?.selectionOperation?.operationId).toBe(application.operationId)
 const initialRegistrations=f.registerTemplateSelection.mock.calls.length
 vi.mocked(HubGenerationStore.prototype.readState).mockReturnValue({active:null} as never)
 await f.manager.profiles({action:'activate',id})
 expect(f.registerTemplateSelection).toHaveBeenCalledTimes(initialRegistrations)
 expect(f.registerOperationSelection).toHaveBeenCalledTimes(2)
})
it('does not attribute another operation or an unacknowledged receipt to the registered Profile',async()=>{
 const f=fixture(true),id=await f.createTemplateBorn(),profiles=new ContentProfileStore(join(f.root,CONTENT_PROFILES_FILENAME))
 await f.manager.profiles({action:'activate',id})
 const application={contentProfileId:id,selectionDigest:profiles.selectionDigest(id),operationId:randomUUID(),planDigest:'1'.repeat(64),generationDigest:'2'.repeat(64),scope:new HubGenerationStore(f.root,f.identity).scope}
 await profiles.beginApplication(application)
 vi.mocked(HubExecutionJournal.prototype.read).mockReturnValue({...application,operationId:randomUUID(),phase:'ACTIVATED',pendingReceipt:null} as never)
 await f.manager.status({})
 expect(profiles.projection().appliedId).toBeNull()
 vi.mocked(HubExecutionJournal.prototype.read).mockReturnValue({...application,phase:'ACTIVATED',pendingReceipt:{phase:'ACTIVATED',seq:0,errorCode:null}} as never)
 await f.manager.status({})
 expect(profiles.projection().appliedId).toBeNull()
 expect(profiles.get(id)?.lastAppliedAt).toBeUndefined()
})

it('recovers a crash after persisting an application but before creating its journal',async()=>{
 const f=fixture(true),id=await f.createTemplateBorn(),profiles=new ContentProfileStore(join(f.root,CONTENT_PROFILES_FILENAME))
 await f.manager.profiles({action:'activate',id})
 await profiles.beginApplication({contentProfileId:id,selectionDigest:profiles.selectionDigest(id),operationId:randomUUID(),planDigest:'1'.repeat(64),generationDigest:'2'.repeat(64),scope:new HubGenerationStore(f.root,f.identity).scope})
 f.policy.ensureMutationAllowed.mockRejectedValue(Error('HUB_DESKTOP_UPDATE_REQUIRED'))
 await expect(f.manager.status({})).rejects.toThrow('HUB_OPERATION_NOT_FOUND')
 expect(profiles.application()).toBeUndefined()
 expect(profiles.projection()).toMatchObject({appliedId:null,apply:{phase:'failed',error:'HUB_STAGE_INTERRUPTED'}})
})

it('serializes concurrent healthy receipt reconciliation without a second completion write',async()=>{
 const f=fixture(true),id=await f.createTemplateBorn(),profiles=new ContentProfileStore(join(f.root,CONTENT_PROFILES_FILENAME))
 await f.manager.profiles({action:'activate',id})
 const application={contentProfileId:id,selectionDigest:profiles.selectionDigest(id),operationId:randomUUID(),planDigest:'1'.repeat(64),generationDigest:'2'.repeat(64),scope:new HubGenerationStore(f.root,f.identity).scope}
 await profiles.beginApplication(application)
 const record={...application,phase:'ACTIVATED',pendingReceipt:null,descriptorDigest:'3'.repeat(64)}
 vi.mocked(HubExecutionJournal.prototype.read).mockReturnValue(record as never)
 vi.mocked(HubGenerationStore.prototype.readState).mockReturnValue({active:{descriptorDigest:record.descriptorDigest}} as never)
 vi.mocked(inspectSavedHubPlan).mockReturnValue({plan:{planId:randomUUID(),items:[]}} as never)
 const original=ContentProfileStore.prototype.finishApplication
 let release!:()=>void,started!:()=>void
 const gate=new Promise<void>(resolve=>{release=resolve}),entered=new Promise<void>(resolve=>{started=resolve})
 const finish=vi.spyOn(ContentProfileStore.prototype,'finishApplication').mockImplementation(async function(this:ContentProfileStore,...args){started();await gate;return original.apply(this,args)})
 const first=f.manager.status({});await entered
 const second=f.manager.status({});await new Promise(resolve=>setImmediate(resolve))
 expect(finish).toHaveBeenCalledOnce()
 release();await Promise.all([first,second])
 expect(profiles.projection().appliedId).toBe(id)
})
