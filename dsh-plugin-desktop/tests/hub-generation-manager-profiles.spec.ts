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
import {readSealedHubReleaseTrust} from '../src/hub-release-trust.ts'
import {hubCanonicalJson,hubSyncDigest,verifyHubSyncSnapshot,type HubSyncExpected} from '../src/hub-sync-verifier.ts'
vi.mock('../src/hub-host-identity.ts',()=>({resolveHubHostIdentity:vi.fn()}))
vi.mock('../src/hub-release-trust.ts',()=>({readSealedHubReleaseTrust:vi.fn()}))
const roots:string[]=[]
afterEach(()=>{vi.restoreAllMocks();vi.clearAllMocks();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true})})
/** docs/1022 十次审查缺口 2：activate 意图的 Host 侧编排（模板出生重注册/自定义仅本地/未知 id/注册失败不置当前）。 */
function fixture(){
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
 const client={context:async()=>({tenantId:identity.tenantId,actorRef:identity.actorRef}),check,registerTemplateSelection,watchInvalidation:()=>()=>{},watchOfflineDenial:()=>()=>{}}
 let manager!: {profiles(input:unknown):Promise<unknown>}
 const policy={snapshot:()=>({phase:'none' as 'none'|'notice'|'blocking'}),ensureMutationAllowed:vi.fn(async()=>{})}
 const scope={get:()=>policy,hubHostClient:client,provide:(_name:string,value:unknown)=>{manager=value as typeof manager},effect:()=>{},inject:()=>{}}
 registerHubGenerationManager({inject:(_keys:string[],fn:(v:unknown)=>void)=>fn(scope)} as never,{target,userData:root,profileDirectory:root})
 const createTemplateBorn=async()=>{
  const profile=await manager.profiles({action:'create',name:'模板出生',templateId:randomUUID(),templateRevision:3,items:[{kind:'skill',itemId:randomUUID(),enabled:true}],mcpEndpoints:[],skippedItems:[]}) as {id:string}
  return profile.id
 }
 // 自定义组装不再有创建入口（§6.3 Tab B 等价 = 目录勾选流程）；早期实验壳的
 // 无模板来源行经直写存储落盘，验证 activate 仍按本地切换兼容。
 const legacyCustom=()=>{
  const id=randomUUID()
  writeFileSync(join(root,CONTENT_PROFILES_FILENAME),`${JSON.stringify({version:1,activeId:null,profiles:[{id,name:'自定义组装',summary:{skills:1,plugins:0,mcpEndpoints:0,skipped:0},items:[{kind:'skill',itemId:randomUUID(),enabled:true}],skippedItems:[],createdAt:new Date().toISOString()}]},null,2)}\n`)
  return id
 }
 return{manager,check,registerTemplateSelection,identity,createTemplateBorn,legacyCustom,active:()=>manager.profiles({action:'active'})}
}
it('activate on a template-born profile re-registers the frozen revision and reports skipped items',async()=>{
 const f=fixture(),id=await f.createTemplateBorn()
 await expect(f.manager.profiles({action:'activate',id})).resolves.toEqual({switched:true,skippedCount:1})
 expect(f.registerTemplateSelection).toHaveBeenCalledOnce()
 expect(f.registerTemplateSelection.mock.calls[0]![1]).toMatchObject({deviceId:f.identity.deviceId,profileId:f.identity.profileId,revision:3})
 await expect(f.active()).resolves.toBe(id)
 // 自定义组装不触达 Hub 注册
 expect(f.check).toHaveBeenCalledOnce()
})
it('activate on a custom profile switches locally without touching Hub',async()=>{
 const f=fixture(),id=f.legacyCustom()
 await expect(f.manager.profiles({action:'activate',id})).resolves.toEqual({switched:true,skippedCount:0})
 expect(f.registerTemplateSelection).not.toHaveBeenCalled()
 await expect(f.active()).resolves.toBe(id)
})
it('activate on an unknown id fails without changing the active profile',async()=>{
 const f=fixture(),id=f.legacyCustom()
 await expect(f.manager.profiles({action:'activate',id:randomUUID()})).rejects.toThrow('HUB_PROFILE_NOT_FOUND')
 await expect(f.active()).resolves.toBe(null)
 await expect(f.manager.profiles({action:'activate',id})).resolves.toEqual({switched:true,skippedCount:0})
})
it('a failed re-registration keeps the previously active profile',async()=>{
 const f=fixture(),first=f.legacyCustom()
 await expect(f.manager.profiles({action:'activate',id:first})).resolves.toEqual({switched:true,skippedCount:0})
 const templateBorn=await f.createTemplateBorn()
 vi.mocked(f.registerTemplateSelection).mockRejectedValueOnce(new Error('HUB_UNAVAILABLE'))
 await expect(f.manager.profiles({action:'activate',id:templateBorn})).rejects.toThrow('HUB_UNAVAILABLE')
 await expect(f.active()).resolves.toBe(first)
})
it('does not acknowledge activation until its local selection is durable',async()=>{
 const f=fixture(),id=f.legacyCustom()
 let release!:(result:boolean)=>void
 const gate=new Promise<boolean>(resolve=>{release=resolve})
 vi.spyOn(ContentProfileStore.prototype,'setActive').mockReturnValue(gate)
 let completed=false
 const selecting=f.manager.profiles({action:'activate',id}).then(value=>{completed=true;return value})
 await new Promise(resolve=>setImmediate(resolve))
 expect(completed).toBe(false)
 release(true)
 await expect(selecting).resolves.toMatchObject({switched:true})
})
it('rejects an activation whose local selection no longer exists',async()=>{
 const f=fixture(),id=f.legacyCustom()
 vi.spyOn(ContentProfileStore.prototype,'setActive').mockResolvedValue(false)
 await expect(f.manager.profiles({action:'activate',id})).rejects.toThrow('HUB_PROFILE_NOT_FOUND')
})
