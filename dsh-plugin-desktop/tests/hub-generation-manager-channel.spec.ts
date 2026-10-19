import {generateKeyPairSync,randomUUID,sign} from 'node:crypto'
import {mkdtempSync,realpathSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,expect,it,vi} from 'vitest'
import {registerHubGenerationManager} from '../src/hub-generation-manager.ts'
import {HubGenerationStore} from '../src/hub-generation-store.ts'
import {HubExecutionJournal} from '../src/hub-execution-journal.ts'
import {HubGenerationClient} from '../src/hub-generation-client.ts'
import {inspectSavedHubPlan} from '../src/hub-saved-plan.ts'
import {resolveHubHostIdentity} from '../src/hub-host-identity.ts'
import {readSealedHubReleaseTrust} from '../src/hub-release-trust.ts'
import {hubCanonicalJson,hubSyncDigest,verifyHubSyncSnapshot,type HubSyncExpected} from '../src/hub-sync-verifier.ts'
vi.mock('../src/hub-saved-plan.ts',()=>({inspectSavedHubPlan:vi.fn()}))
vi.mock('../src/hub-host-identity.ts',()=>({resolveHubHostIdentity:vi.fn()}))
vi.mock('../src/hub-release-trust.ts',()=>({readSealedHubReleaseTrust:vi.fn()}))
vi.mock('../src/hub-boot-authorization.ts',()=>({verifyHubBootAuthorization:vi.fn()}))
const roots:string[]=[]
afterEach(()=>{vi.restoreAllMocks();vi.clearAllMocks();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true})})
function fixture(active:boolean){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'hub-channel-')));roots.push(root)
 const identity={origin:'https://ai.hozonauto.com/plugins/api' as const,tenantId:randomUUID(),actorRef:'test:user',deviceId:randomUUID(),profileId:randomUUID()}
 const target={sensteedVersion:'1.0.0',harnessVersion:'1.0.0',os:'darwin' as const,arch:'arm64' as const,nodeVersion:'22.0.0',cordisVersion:'4.0.5',libc:null,nodeAbi:'127',hostCapabilities:[],hostBuildDigest:'b'.repeat(64)}
 const keys=generateKeyPairSync('ed25519'),trust={schemaVersion:1 as const,keys:{test:keys.publicKey.export({type:'spki',format:'der'}).toString('base64')},revokedKeyIds:[]}
 vi.mocked(readSealedHubReleaseTrust).mockReturnValue(trust);vi.mocked(resolveHubHostIdentity).mockResolvedValue(identity)
 vi.spyOn(HubGenerationStore.prototype,'readState').mockReturnValue({active:active?{descriptorDigest:'a'.repeat(64)}:null} as never)
 vi.spyOn(HubExecutionJournal.prototype,'read').mockReturnValue(active?{phase:'ACTIVATED',descriptorDigest:'a'.repeat(64)} as never:undefined)
 vi.mocked(inspectSavedHubPlan).mockReturnValue({plan:{channel:'beta',proposedGenerationDigest:'c'.repeat(64),policyRevision:1,items:[]}} as never)
 const check=vi.fn(async(_context:unknown,_request:unknown,expected:HubSyncExpected)=>{
  const {minimumPolicyRevision:_floor,...binding}=expected,now=Date.now()
  const snapshot={...binding,schemaVersion:'hub-sync-v1',snapshotId:randomUUID(),policyRevision:1,catalogDigest:'d'.repeat(64),entries:[],issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+300000).toISOString()}
  return verifyHubSyncSnapshot({snapshot,signature:{algorithm:'Ed25519',canonicalization:'RFC8785',keyId:'test',payloadDigest:hubSyncDigest(snapshot),signature:sign(null,Buffer.from(hubCanonicalJson(snapshot)),keys.privateKey).toString('base64')}},trust,expected)
 })
 const client={context:async()=>({tenantId:identity.tenantId,actorRef:identity.actorRef}),check,bootAuthorization:vi.fn(async()=>({})),watchInvalidation:()=>()=>{},watchOfflineDenial:()=>()=>{}}
 let manager!:{check(input:unknown):Promise<{channel:'stable'|'beta'}>;preview(input:unknown):Promise<unknown>}
 const scope={hubHostClient:client,provide:(_name:string,value:unknown)=>{manager=value as typeof manager},effect:()=>{},inject:()=>{}}
 registerHubGenerationManager({inject:(_keys:string[],fn:(v:unknown)=>void)=>fn(scope)} as never,{target,userData:root,profileDirectory:root})
 return{manager,check,client}
}
it.each([[true,{},'beta'],[false,{},'stable'],[true,{channel:'stable'},'stable'],[false,{channel:'beta'},'beta']]as const)('resolves channel from verified active inventory while preserving explicit intent (%s, %j)',async(active,input,expected)=>{
 const f=fixture(active),result=await f.manager.check(input)
 expect(result.channel).toBe(expected);expect(f.check.mock.calls[0]![2].channel).toBe(expected)
 expect(inspectSavedHubPlan).toHaveBeenCalledTimes(active?1:0)
})
it.each([{channel:'nightly'},{channel:null},{channel:1},{channel:'beta',target:{}},null])('rejects invalid channel intents before catalog access (%j)',async input=>{
 const f=fixture(true);await expect(f.manager.check(input)).rejects.toThrow();expect(f.check).not.toHaveBeenCalled()
})
it('requires a channel for preview and never guesses from invalid inventory',async()=>{
 const f=fixture(true);await expect(f.manager.preview({requested:[]})).rejects.toThrow()
 vi.mocked(inspectSavedHubPlan).mockImplementation(()=>{throw Error('invalid signed inventory')})
 await expect(f.manager.check({})).rejects.toThrow('invalid signed inventory');expect(f.check).not.toHaveBeenCalled()
})
it('keeps the repair check available when the old active boot lease is revoked',async()=>{
 const f=fixture(true);vi.mocked(f.client.bootAuthorization).mockRejectedValue(new Error('old lease revoked'))
 await expect(f.manager.check({})).resolves.toMatchObject({activeGenerationDigest:'c'.repeat(64)})
 expect(f.check).toHaveBeenCalledTimes(1)
})
it('previews a fresh plan after an authorization failure before consumption',async()=>{
 const f=fixture(false)
 vi.mocked(HubExecutionJournal.prototype.read).mockReturnValue({phase:'NEEDS_ATTENTION',pendingReceipt:null,consumptionStarted:false} as never)
 const prepare=vi.spyOn(HubGenerationClient.prototype,'prepare').mockRejectedValue(new Error('PREPARE_REACHED'))
 await expect(f.manager.preview({channel:'stable',requested:[]})).rejects.toThrow('PREPARE_REACHED')
 expect(prepare).toHaveBeenCalledOnce()
})
it.each([
 {phase:'NEEDS_ATTENTION',pendingReceipt:null,consumptionStarted:true},
 {phase:'NEEDS_ATTENTION',pendingReceipt:{phase:'NEEDS_ATTENTION'},consumptionStarted:false},
 {phase:'CONSUMING',pendingReceipt:null,consumptionStarted:true},
])('keeps ambiguous consumption and unsent receipts fenced (%j)',async record=>{
 const f=fixture(false)
 vi.mocked(HubExecutionJournal.prototype.read).mockReturnValue(record as never)
 const prepare=vi.spyOn(HubGenerationClient.prototype,'prepare')
 await expect(f.manager.preview({channel:'stable',requested:[]})).rejects.toThrow('HUB_OPERATION_PENDING')
 expect(prepare).not.toHaveBeenCalled()
})
