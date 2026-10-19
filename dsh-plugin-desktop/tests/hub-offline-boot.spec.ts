import { afterEach, expect, it, vi } from 'vitest'
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync,readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HubGenerationStore, type HubGenerationDescriptor } from '../src/hub-generation-store.ts'
import { HubExecutionJournal } from '../src/hub-execution-journal.ts'
import { resolveHubHostIdentity } from '../src/hub-host-identity.ts'
import { HubHostClient } from '../src/hub-host-client.ts'
import { hubGenerationContentDigest, verifyHubGenerationPlan } from '../src/hub-generation-verifier.ts'
import { hubCanonicalJson, hubSyncDigest } from '../src/hub-sync-verifier.ts'
import { clearHubOfflineBoot, loadHubOfflineBoot, saveHubOfflineBoot } from '../src/hub-offline-boot.ts'
import { registerHubGenerationManager } from '../src/hub-generation-manager.ts'
import { readSealedHubReleaseTrust } from '../src/hub-release-trust.ts'
import { HUB_RELEASE_EVIDENCE_FILE } from '../src/hub-generation-content.ts'
vi.mock('../src/hub-release-trust.ts',()=>({readSealedHubReleaseTrust:vi.fn()}))

const roots:string[]=[]
afterEach(()=>{vi.useRealTimers();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
async function fixture(){
 const userData=realpathSync(mkdtempSync(join(tmpdir(),'hub-offline-')));roots.push(userData)
 const profileDirectory=join(userData,'profile');mkdirSync(profileDirectory,{mode:0o700})
 const owner={operator:'verified-owner',tenantId:randomUUID()},context={tenantId:randomUUID(),actorRef:owner.operator,workspaceId:randomUUID(),permissions:[],revision:0}
 const identity=await resolveHubHostIdentity(userData,profileDirectory,{assertCurrent(){},bindDevice:async()=>randomUUID()} as never,context)
 const store=new HubGenerationStore(userData,identity),keys=generateKeyPairSync('ed25519')
 const trust={schemaVersion:1 as const,keys:{test:keys.publicKey.export({type:'spki',format:'der'}).toString('base64')},revokedKeyIds:[]}
 const target={sensteedVersion:'1.0.0',harnessVersion:'1.0.0',os:'darwin' as const,arch:'arm64' as const,nodeVersion:'22.0.0',cordisVersion:'4.0.5',libc:null,nodeAbi:'127',hostCapabilities:[],hostBuildDigest:'b'.repeat(64)}
 const signature=(value:unknown)=>({algorithm:'Ed25519',canonicalization:'RFC8785',keyId:'test',payloadDigest:hubSyncDigest(value),signature:sign(null,Buffer.from(hubCanonicalJson(value)),keys.privateKey).toString('base64')})
 const content='# example',skillId=randomUUID(),releaseId=randomUUID(),manifest={schemaVersion:'1.1',kind:'skill',tenantId:identity.tenantId,skillId,releaseId,installName:'example',version:'1.0.0',artifact:{sha256:'d'.repeat(64),bytes:100,format:'zip'},fileManifestDigest:hubSyncDigest([{path:'SKILL.md',bytes:Buffer.byteLength(content),sha256:hubFileDigest(content)}]),compatibility:{sensteed:'*',testedTargets:[]},accessDeclaration:{containsScripts:false,networkHosts:[],fileAccess:'none'},issuedAt:new Date().toISOString()}
 const item={kind:'skill' as const,itemId:skillId,releaseId,action:'install' as const,enabled:true,artifactDigest:manifest.artifact.sha256,manifestDigest:hubSyncDigest(manifest),channelRevision:1,lockGraphDigest:null,packSetDigest:null}
 const releaseEvidence=JSON.stringify({manifests:[{kind:'skill',itemId:skillId,envelope:{manifest,signature:signature(manifest)}}]})
 const now=Date.now(),expected={...identity,target,channel:'stable' as const,snapshotId:randomUUID(),snapshotDigest:'a'.repeat(64),observedStateDigest:'b'.repeat(64),expectedActiveGenerationDigest:null,minimumPolicyRevision:1,requested:[{kind:item.kind,itemId:item.itemId,action:item.action,enabled:true}]}
 const {minimumPolicyRevision:_floor,requested:_items,...binding}=expected
 const payload={...binding,schemaVersion:'hub-generation-plan-v1',planId:randomUUID(),policyRevision:1,catalogDigest:'c'.repeat(64),proposedGenerationDigest:hubGenerationContentDigest([item]),items:[item],closureDigest:hubSyncDigest([]),totalBytes:100,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+300000).toISOString()}
 const plan={...payload,planDigest:hubSyncDigest(payload)},envelope={plan,signature:signature(plan)}
 function descriptor(generationId:string):HubGenerationDescriptor{
  const root=store.generationDirectory(generationId);mkdirSync(root,{mode:0o700});mkdirSync(join(root,'skills'),{mode:0o700})
  mkdirSync(join(root,'skills','example'),{mode:0o700})
  writeFileSync(join(root,'skills','example','SKILL.md'),content,{mode:0o600})
  writeFileSync(join(root,HUB_RELEASE_EVIDENCE_FILE),releaseEvidence,{mode:0o600})
  return {schemaVersion:2,identity,generationId,skillsRoot:'skills',packages:[],files:{'skills/example/SKILL.md':hubFileDigest(content),[HUB_RELEASE_EVIDENCE_FILE]:hubFileDigest(releaseEvidence)},verifiedComposition:{entries:[],skills:[{name:'example',path:'skills/example/SKILL.md',sha256:hubFileDigest(content)}]}}
 }
 const journal=new HubExecutionJournal(store),cap=verifyHubGenerationPlan(envelope,trust,expected)
 let record=await journal.begin(cap,randomUUID(),envelope)
 record=await journal.advance(record,'CONSUMING');record=await journal.advance(record,'AUTHORIZED',{executionGeneration:'1',executionExpiresAt:new Date(now+1800000).toISOString()})
 await store.prepare(descriptor('healthy'))
 record=await journal.advance(record,'STAGED',{descriptorDigest:store.readState().pending!.descriptorDigest})
 await store.activate();record=await journal.advance(record,'COMMITTED');await store.markHealthy('healthy');await journal.advance(record,'ACTIVATED');await journal.saveHealthyInventory()
 const authorization={schemaVersion:'hub-generation-boot-v1',...identity,target,generationDigest:plan.proposedGenerationDigest,contentDigest:plan.proposedGenerationDigest,policyRevision:1,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+86400000).toISOString()}
 const lease={authorization,signature:signature(authorization)}
 let observedOwner:typeof owner|undefined=owner
 const fetcher=vi.fn().mockRejectedValue(new TypeError('network disabled'))
 const client=new HubHostClient({getDatasourceSession:()=>undefined,getOfflineIdentity:async()=>observedOwner,watchBinding:()=>()=>{}},fetcher)
 const options={userData,profileDirectory,client,target,trust}
 return {options,store,lease,descriptor,fetcher,identity,setOwner:(value:typeof owner|undefined)=>{observedOwner=value},owner,now}
}
// File bytes use SHA-256 directly; JSON canonical hashing is intentionally different.
import { createHash } from 'node:crypto'
const hubFileDigest=(text:string)=>createHash('sha256').update(text).digest('hex')

it('cold boots the exact healthy Profile without network or a bearer and rejects another credential owner',async()=>{
 const f=await fixture();await saveHubOfflineBoot({...f.options,store:f.store,lease:f.lease})
 expect(await loadHubOfflineBoot(f.options)).toMatchObject({identity:f.identity,generationDigest:f.lease.authorization.generationDigest,lease:f.lease})
 expect(f.fetcher).not.toHaveBeenCalled()
 f.setOwner({...f.owner,operator:'other'});expect(await loadHubOfflineBoot(f.options)).toBeUndefined()
 f.setOwner(undefined);expect(await loadHubOfflineBoot(f.options)).toBeUndefined()
})
it('rejects expired leases, a changed base/ABI, revoked keys and modified installed bytes',async()=>{
 const f=await fixture();await saveHubOfflineBoot({...f.options,store:f.store,lease:f.lease})
 await expect(loadHubOfflineBoot({...f.options,target:{...f.options.target,nodeAbi:'999'}})).rejects.toThrow('target')
 await expect(loadHubOfflineBoot({...f.options,trust:{...f.options.trust,revokedKeyIds:['test']}})).rejects.toThrow()
 vi.setSystemTime(f.now+86400000);await expect(loadHubOfflineBoot(f.options)).rejects.toThrow('expired');vi.useRealTimers()
 writeFileSync(join(f.store.generationDirectory('healthy'),'skills','example','SKILL.md'),'changed')
 await expect(loadHubOfflineBoot(f.options)).rejects.toThrow('digest')
})
it('rejects replacement payload even when all unsigned checkpoint hashes are rewritten together',async()=>{
 const f=await fixture();await saveHubOfflineBoot({...f.options,store:f.store,lease:f.lease})
 const root=f.store.generationDirectory('healthy'),path='skills/example/SKILL.md',content='malicious replacement'
 writeFileSync(join(root,path),content)
 const descriptorPath=join(root,'descriptor.json'),descriptor=JSON.parse(readFileSync(descriptorPath,'utf8'))
 descriptor.files[path]=hubFileDigest(content);descriptor.verifiedComposition.skills[0].sha256=hubFileDigest(content)
 const bytes=JSON.stringify(descriptor);writeFileSync(descriptorPath,bytes)
 const descriptorDigest=hubFileDigest(bytes)
 for(const name of ['state.json','execution.json','healthy-inventory.json']){
  const file=join(f.store.directory,name),value=JSON.parse(readFileSync(file,'utf8'))
  if(name==='state.json')value.active.descriptorDigest=descriptorDigest;else value.descriptorDigest=descriptorDigest
  writeFileSync(file,JSON.stringify(value))
 }
 const cacheRoot=join(f.options.userData,'hub-offline-boot'),cachePath=join(cacheRoot,readdirSync(cacheRoot).find(name=>name.endsWith('.json'))!)
 const cache=JSON.parse(readFileSync(cachePath,'utf8'));cache.inventory.descriptorDigest=descriptorDigest;writeFileSync(cachePath,JSON.stringify(cache))
 await expect(loadHubOfflineBoot(f.options)).rejects.toThrow('signed file manifest')
})
it('cannot bless an unverified update; after rollback it reuses the previous healthy checkpoint',async()=>{
 const f=await fixture();await saveHubOfflineBoot({...f.options,store:f.store,lease:f.lease})
 await f.store.prepare(f.descriptor('broken'))
 // A prepared update is still waiting for consent; offline startup keeps the
 // previous active version without installing or discarding the candidate.
 expect((await loadHubOfflineBoot(f.options))?.generationDigest).toBe(f.lease.authorization.generationDigest)
 expect(f.store.readState().pending?.generationId).toBe('broken')
 await f.store.activate()
 await expect(loadHubOfflineBoot(f.options)).rejects.toThrow('not healthy')
 await expect(saveHubOfflineBoot({...f.options,store:f.store,lease:f.lease})).rejects.toThrow('not healthy')
 await f.store.rollback()
 expect((await loadHubOfflineBoot(f.options))?.generationDigest).toBe(f.lease.authorization.generationDigest)
 clearHubOfflineBoot(f.options);expect(await loadHubOfflineBoot(f.options)).toBeUndefined()
})
it('base manager restores the healthy checkpoint after a cold crash with all Hub networking disabled',async()=>{
 const f=await fixture();await saveHubOfflineBoot({...f.options,store:f.store,lease:f.lease})
 await f.store.prepare(f.descriptor('crashed'));await f.store.activate()
 vi.mocked(readSealedHubReleaseTrust).mockReturnValue(f.options.trust)
 let ready=()=>{};const cleanup:(()=>void)[]=[],request=vi.fn()
 const scope={hubHostClient:f.options.client,hubGenerationSupervisor:{request},provide:()=>{},effect:(fn:()=>()=>void)=>cleanup.push(fn()),inject:(_keys:string[],fn:(v:unknown)=>void)=>fn({appReady:{onReady:(fn:()=>void)=>{ready=fn}}}),logger:()=>({warn:()=>{}})}
 registerHubGenerationManager({inject:(_keys:string[],fn:(v:unknown)=>void)=>fn(scope)} as never,f.options)
 try{
  ready();await vi.waitFor(()=>expect(request).toHaveBeenCalledWith({kind:'managed',identity:f.identity,lease:f.lease,generationDigest:f.lease.authorization.generationDigest}))
  expect(f.store.readState()).toMatchObject({phase:'stable',active:{generationId:'healthy'}})
  expect(f.fetcher).not.toHaveBeenCalled()
 }finally{cleanup.forEach(fn=>fn())}
})
it('retains the prior checkpoint if the process dies between local health and durable Hub inventory',async()=>{
 const f=await fixture();await saveHubOfflineBoot({...f.options,store:f.store,lease:f.lease})
 await f.store.prepare(f.descriptor('health-commit-crashed'));await f.store.activate();await f.store.markHealthy('health-commit-crashed')
 expect(f.store.readState().previous?.generationId).toBe('healthy')
 // The new journal head may already be durable while its lease cache is not.
 // The old cache carries its own coherent, cryptographically rechecked inventory.
 const healthyPath=join(f.store.directory,'healthy-inventory.json'),head=JSON.parse(readFileSync(healthyPath,'utf8'))
 writeFileSync(healthyPath,JSON.stringify({...head,descriptorDigest:f.store.readState().active!.descriptorDigest}))
 expect((await loadHubOfflineBoot({...f.options,recoverUnconfirmed:true}))?.generationDigest).toBe(f.lease.authorization.generationDigest)
 expect(f.store.readState().active?.generationId).toBe('healthy')
 expect(new HubExecutionJournal(f.store).readHealthyInventory()?.descriptorDigest).toBe(f.store.readState().active!.descriptorDigest)
})
it('does not reuse healthy authority after a Hub access refusal or in another Profile',async()=>{
 const f=await fixture();await saveHubOfflineBoot({...f.options,store:f.store,lease:f.lease})
 const otherProfile=join(f.options.userData,'other');mkdirSync(otherProfile,{mode:0o700})
 expect(await loadHubOfflineBoot({...f.options,profileDirectory:otherProfile})).toBeUndefined()
 const client=new HubHostClient({getDatasourceSession:()=>({...f.owner,accessToken:'test-bearer'}),watchBinding:()=>()=>{}},vi.fn().mockResolvedValue(new Response(null,{status:403})))
 await expect(client.context()).rejects.toThrow('HUB_ACCESS_DENIED')
 expect(await loadHubOfflineBoot({...f.options,client})).toBeUndefined()
 clearHubOfflineBoot(f.options)
 expect(await loadHubOfflineBoot(f.options)).toBeUndefined()
})
it('removes an atomic cache write if the owner is revoked while the write is completing',async()=>{
 const f=await fixture(),client={offlineOwner:vi.fn().mockResolvedValueOnce(f.owner).mockResolvedValueOnce(f.owner).mockResolvedValueOnce(undefined)}
 await expect(saveHubOfflineBoot({...f.options,client:client as never,store:f.store,lease:f.lease})).rejects.toThrow('owner changed')
 expect(await loadHubOfflineBoot(f.options)).toBeUndefined()
})
