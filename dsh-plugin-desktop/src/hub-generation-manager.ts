/** Host-only UI intents. All identities, targets, paths and grants remain below this boundary. */
import{inspectSavedHubPlan}from'./hub-saved-plan.ts'
import{verifyHubBootAuthorization}from'./hub-boot-authorization.ts'
import{randomUUID}from'node:crypto'
import type{Context}from'@deepseek-ai/cordis'
import type{HubHostClient}from'./hub-host-client.ts'
import{resolveHubHostIdentity}from'./hub-host-identity.ts'
import{HubGenerationStore}from'./hub-generation-store.ts'
import{HubGenerationClient}from'./hub-generation-client.ts'
import{HubGenerationExecution}from'./hub-generation-execution.ts'
import{HubExecutionJournal}from'./hub-execution-journal.ts'
import{readSealedHubReleaseTrust}from'./hub-release-trust.ts'
import{hubSyncSnapshotData,hubSyncDigest,type HubSyncTarget,type HubSyncExpected}from'./hub-sync-verifier.ts'
import{generationPlanData,type VerifiedHubGenerationPlan,type HubGenerationPlanExpected}from'./hub-generation-verifier.ts'
import{z}from'zod'
const requestedSchema=z.array(z.strictObject({kind:z.enum(['skill','plugin']),itemId:z.uuid(),action:z.enum(['retain','install','update','uninstall']),enabled:z.boolean()})).max(256)
type Intent={nonce:string;cap:VerifiedHubGenerationPlan;client:HubGenerationClient;execution:HubGenerationExecution;store:HubGenerationStore}
export function registerHubGenerationManager(ctx:Context,options:{readonly target:HubSyncTarget;readonly userData:string;readonly profileDirectory:string;readonly managed?:boolean}):void{
 ctx.inject(['hubHostClient'],scope=>{
  const client=scope.hubHostClient as HubHostClient,trust=readSealedHubReleaseTrust(),intents=new Map<string,Intent>()
  let lastStore:HubGenerationStore|undefined
  let closing=false
  async function closeManaged(){if(!options.managed||closing)return;closing=true;await scope.hubGenerationSupervisor.request({kind:'base'})}
  const unwatch=client.watchInvalidation(()=>{intents.clear();if(options.managed){void closeManaged().catch(()=>{})}else{setImmediate(()=>{void resume().catch(()=>{})})}})
  scope.effect(()=>()=>unwatch(),'Hub identity fence')
  async function environment(channel:'stable'|'beta'){
   const context=await client.context(),identity=await resolveHubHostIdentity(options.userData,options.profileDirectory,client,context)
   const store=new HubGenerationStore(options.userData,identity);lastStore=store
   const state=store.readState(),journal=new HubExecutionJournal(store),pendingRecord=journal.read(),record=pendingRecord?.descriptorDigest===state.active?.descriptorDigest?pendingRecord:journal.readHealthyInventory()
   let activeGenerationDigest:string|null=null,minimumPolicyRevision=0
   let installed:Parameters<HubHostClient['check']>[1]['installed']=[]
   if(state.active!==null){
    if(!record||record.phase!=='ACTIVATED'&&record.phase!=='COMMITTED')throw new Error('HUB_ACTIVE_INVENTORY_RECOVERY_REQUIRED')
    const saved=inspectSavedHubPlan(record,identity,options.target,trust)
    const lease=await client.bootAuthorization(context,{deviceId:identity.deviceId,profileId:identity.profileId,generationDigest:saved.plan.proposedGenerationDigest,target:options.target})
    verifyHubBootAuthorization(lease,trust,{...identity,target:options.target,generationDigest:saved.plan.proposedGenerationDigest,minimumPolicyRevision:saved.plan.policyRevision})
    activeGenerationDigest=saved.plan.proposedGenerationDigest;minimumPolicyRevision=saved.plan.policyRevision
    installed=saved.plan.items.map(i=>({kind:i.kind,itemId:i.itemId,releaseId:i.releaseId,artifactDigest:i.artifactDigest,channelRevision:i.channelRevision,enabled:i.enabled,userRemoved:i.action==='uninstall'}))
   }
   const expected:HubSyncExpected={...identity,channel,target:options.target,observedStateDigest:hubSyncDigest(installed),minimumPolicyRevision}
   const snapshot=hubSyncSnapshotData(await client.check(context,{mode:activeGenerationDigest===null?'initial':'check',installed},expected,trust))
   return{context,identity,store,expected,snapshot,activeGenerationDigest,installed}

  }
  const manager={
   async check(input:unknown){
    const{channel}=z.strictObject({channel:z.enum(['stable','beta'])}).parse(input),env=await environment(channel)
    return{profileId:env.identity.profileId,activeGenerationDigest:env.activeGenerationDigest,entries:env.snapshot.entries,activeItems:env.installed.filter(i=>!i.userRemoved).map(i=>({kind:i.kind,itemId:i.itemId,enabled:i.enabled})),operation:summary(env.store)}
   },
   async preview(input:unknown){
    const{channel,requested}=z.strictObject({channel:z.enum(['stable','beta']),requested:requestedSchema}).parse(input),env=await environment(channel)
    const pending=new HubExecutionJournal(env.store).read()
    if(pending&&pending.phase!=='ACTIVATED'&&pending.phase!=='ROLLED_BACK')throw new Error('HUB_OPERATION_PENDING')
    const executionClient=new HubGenerationClient(client,env.context),expected:HubGenerationPlanExpected={...env.expected,snapshotId:env.snapshot.snapshotId,snapshotDigest:hubSyncDigest(env.snapshot),expectedActiveGenerationDigest:env.activeGenerationDigest,requested}
    const cap=await executionClient.prepare(expected,trust,randomUUID()),plan=generationPlanData(cap),intentId=randomUUID(),confirmationNonce=randomUUID()
    intents.clear();intents.set(intentId,{nonce:confirmationNonce,cap,client:executionClient,execution:new HubGenerationExecution(env.store,executionClient,client,env.context,trust),store:env.store})
    return{intentId,confirmationNonce,profileId:env.identity.profileId,planDigest:plan.planDigest,expiresAt:plan.expiresAt,totalBytes:plan.totalBytes,items:plan.items.map(i=>({kind:i.kind,itemId:i.itemId,action:i.action,enabled:i.enabled,releaseId:i.releaseId,displayName:env.snapshot.entries.find(e=>e.kind===i.kind&&e.itemId===i.itemId)?.displayName,version:env.snapshot.entries.find(e=>e.kind===i.kind&&e.itemId===i.itemId)?.version,compatibility:env.snapshot.entries.find(e=>e.kind===i.kind&&e.itemId===i.itemId)?.disposition,evidence:env.snapshot.entries.find(e=>e.kind===i.kind&&e.itemId===i.itemId)?.reason}))}
   },
   async execute(input:unknown){
    const{intentId,confirmationNonce}=z.strictObject({intentId:z.uuid(),confirmationNonce:z.uuid()}).parse(input),intent=intents.get(intentId)
    intents.delete(intentId)
    if(!intent||intent.nonce!==confirmationNonce)throw new Error('HUB_INTENT_EXPIRED')
    const record=await intent.execution.stage(intent.cap)
    return{operationId:record.operationId,state:'STAGED',phase:record.phase,restartRequired:true,restartReady:false}
   },
   async restart(input:unknown){
    const{operationId}=z.strictObject({operationId:z.uuid()}).parse(input),context=await client.context(),identity=await resolveHubHostIdentity(options.userData,options.profileDirectory,client,context)
    const store=new HubGenerationStore(options.userData,identity),record=new HubExecutionJournal(store).read()
    if(!record||record.operationId!==operationId||record.phase!=='STAGED'||record.pendingReceipt!==null)throw new Error('HUB_RESTART_NOT_READY')
    inspectSavedHubPlan(record,identity,options.target,trust)
    await scope.hubGenerationSupervisor.request({kind:'activate',identity,operationId})
    return{operationId,state:'RESTARTING',restartRequired:true,restartReady:false}
   },
   async status(input:unknown){
    const{operationId}=z.strictObject({operationId:z.uuid().optional()}).parse(input)
    const current=await client.context()
    const identity=await resolveHubHostIdentity(options.userData,options.profileDirectory,client,current)
    lastStore=new HubGenerationStore(options.userData,identity)
    if(current.tenantId!==lastStore.identity.tenantId||current.actorRef!==lastStore.identity.actorRef)throw new Error('HUB_CONTEXT_CHANGED')
    const result=summary(lastStore)
    if(!result||operationId!==undefined&&result.operationId!==operationId)throw new Error('HUB_OPERATION_NOT_FOUND')
    return result
   },
  }
  async function resume(){
   const context=await client.context(),identity=await resolveHubHostIdentity(options.userData,options.profileDirectory,client,context),store=new HubGenerationStore(options.userData,identity),journal=new HubExecutionJournal(store)
   let record=journal.read();if(!record)return
   const active=store.readState().active
   if(record.phase==='COMMITTED'&&active?.descriptorDigest!==record.descriptorDigest){
    const failed=inspectSavedHubPlan(record,identity,options.target,trust),executionClient=new HubGenerationClient(client,context)
    const recovered=await executionClient.consumptionForRecovery(failed.envelope,trust,failed.expected,record.operationId)
    record=await journal.advance(record,'ROLLED_BACK')
    record=await journal.queueReceipt(record,{phase:'ROLLED_BACK',evidenceDigest:hubSyncDigest({activeDescriptorDigest:active?.descriptorDigest??null}),occurredAt:new Date().toISOString(),errorCode:'HUB_BOOT_FAILED'})
    await executionClient.receipt(recovered.proof,record.pendingReceipt!);record=await journal.acknowledgeReceipt(record)
   }
   if(!active)return
   if(record.descriptorDigest!==active.descriptorDigest){record=journal.readHealthyInventory();if(!record||record.descriptorDigest!==active.descriptorDigest)return}

   const saved=inspectSavedHubPlan(record,identity,options.target,trust),executionClient=new HubGenerationClient(client,context)
   if(record.phase==='STAGED'&&store.readState().phase==='verifying'){
    const recovered=await executionClient.consumptionForRecovery(saved.envelope,trust,saved.expected,record.operationId)
    record=await journal.advance(record,'COMMITTED')
    record=await journal.queueReceipt(record,{phase:'COMMITTED',evidenceDigest:hubSyncDigest({descriptorDigest:record.descriptorDigest,generationDigest:record.generationDigest}),occurredAt:new Date().toISOString(),errorCode:null})
    await executionClient.receipt(recovered.proof,record.pendingReceipt!);record=await journal.acknowledgeReceipt(record)
   }else if(record.pendingReceipt){
    const recovered=await executionClient.consumptionForRecovery(saved.envelope,trust,saved.expected,record.operationId)
    await executionClient.receipt(recovered.proof,record.pendingReceipt);record=await journal.acknowledgeReceipt(record)
   }
   if(record.phase==='ACTIVATED'&&record.pendingReceipt===null&&journal.read()?.operationId===record.operationId)await journal.saveHealthyInventory()
   if(record.phase!=='COMMITTED'&&record.phase!=='ACTIVATED')return
   const lease=await client.bootAuthorization(context,{deviceId:identity.deviceId,profileId:identity.profileId,generationDigest:record.generationDigest,target:options.target})
   verifyHubBootAuthorization(lease,trust,{...identity,target:options.target,generationDigest:record.generationDigest,minimumPolicyRevision:saved.plan.policyRevision})
   client.assertCurrent(context)
   if(!options.managed){await scope.hubGenerationSupervisor.request({kind:'managed',identity,generationDigest:record.generationDigest,lease});return}
   if(record.phase==='COMMITTED'){
    const evidence=await scope.hubGenerationBoot.inspectLoaded(scope.skills,`hub-${store.readState().active!.generationId}`)
    const recovered=await executionClient.consumptionForRecovery(saved.envelope,trust,saved.expected,record.operationId)
    if(store.readState().phase==='verifying')await store.markHealthy(evidence.generationId)
    record=await journal.advance(record,'ACTIVATED')
    record=await journal.queueReceipt(record,{phase:'ACTIVATED',evidenceDigest:hubSyncDigest(evidence),occurredAt:new Date().toISOString(),errorCode:null})
    await executionClient.receipt(recovered.proof,record.pendingReceipt!);await journal.acknowledgeReceipt(record);await journal.saveHealthyInventory()
   }
  }
  if(options.managed){const timer=setInterval(()=>{void resume().catch(()=>{void closeManaged().catch(()=>{})})},60_000);timer.unref();scope.effect(()=>()=>clearInterval(timer),'Hub managed lease renewal')}
  scope.inject(['appReady'],ready=>{ready.appReady?.onReady(()=>{void resume().catch(()=>{scope.logger('hub-generation').warn('Hub managed boot requires authenticated recovery');void closeManaged().catch(()=>{})})})})
  scope.provide('hubGenerationManager',manager)
  scope.effect(()=>()=>intents.clear(),'Desktop Hub intent lifetime')
 })
}
function summary(store:HubGenerationStore){const record=new HubExecutionJournal(store).read();return record===undefined?undefined:{operationId:record.operationId,state:record.phase,phase:record.phase,restartRequired:record.phase==='STAGED'||record.phase==='COMMITTED',restartReady:record.phase==='STAGED'&&record.pendingReceipt===null}}
declare module'@deepseek-ai/cordis'{interface Context{hubGenerationManager:unknown}}
