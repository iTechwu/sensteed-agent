import type {} from '@dofe/dsh-sensteed-product/update-policy'
/** Host-only UI intents. All identities, targets, paths and grants remain below this boundary. */
import{inspectSavedHubPlan,inspectSavedHubInventory}from'./hub-saved-plan.ts'
import{join}from'node:path'
import{ContentProfileStore,handleContentProfilesRequest,recordInstantiatedProfile,CONTENT_PROFILES_FILENAME}from'./content-profiles.ts'
import{relayHubTelemetry}from'./hub-analytics-relay.ts'
import{verifyHubBootAuthorization}from'./hub-boot-authorization.ts'
import{randomUUID}from'node:crypto'
import type{Context}from'@deepseek-ai/cordis'
import{HubHostError,type HubHostClient,type HubProfileTemplatePublic}from'./hub-host-client.ts'
import{loadHubOfflineBoot,saveHubOfflineBoot,clearHubOfflineBoot}from'./hub-offline-boot.ts'
import{resolveHubHostIdentity}from'./hub-host-identity.ts'
import{HubGenerationStore}from'./hub-generation-store.ts'
import{HubGenerationClient,HubRecoveryAuthorizationUnavailable}from'./hub-generation-client.ts'
import{HubGenerationExecution}from'./hub-generation-execution.ts'
import{HubExecutionJournal,hubExecutionCanBegin}from'./hub-execution-journal.ts'
import{readSealedHubReleaseTrust}from'./hub-release-trust.ts'
import{hubSyncSnapshotData,hubSyncDigest,type HubSyncTarget,type HubSyncExpected}from'./hub-sync-verifier.ts'
import{generationPlanData,type VerifiedHubGenerationPlan,type HubGenerationPlanExpected}from'./hub-generation-verifier.ts'
import{z}from'zod'
const requestedSchema=z.array(z.strictObject({kind:z.enum(['skill','plugin']),itemId:z.uuid(),action:z.enum(['retain','install','update','uninstall']),enabled:z.boolean()})).max(256)
type Intent={nonce:string;cap:VerifiedHubGenerationPlan;client:HubGenerationClient;execution:HubGenerationExecution;store:HubGenerationStore}
export function registerHubGenerationManager(ctx:Context,options:{readonly target:HubSyncTarget;readonly userData:string;readonly profileDirectory:string;readonly managed?:boolean}):void{
 ctx.inject(['hubHostClient'],scope=>{
  const client=scope.hubHostClient as HubHostClient,trust=readSealedHubReleaseTrust(),intents=new Map<string,Intent>()
  let profiles:ContentProfileStore|undefined
  let lastStore:HubGenerationStore|undefined
  let closing=false
  async function closeManaged(){if(!options.managed||closing)return;closing=true;await scope.hubGenerationSupervisor.request({kind:'base'})}
  const unwatch=client.watchInvalidation(()=>{intents.clear();if(options.managed){void closeManaged().catch(()=>{})}else{const pending=recovery;setImmediate(()=>{void (pending??Promise.resolve()).catch(()=>{}).then(()=>resume()).catch(()=>{})})}})
  scope.effect(()=>()=>unwatch(),'Hub identity fence')
  const undeny=client.watchOfflineDenial(()=>{intents.clear();clearHubOfflineBoot(options);void closeManaged().catch(()=>{})})
  scope.effect(()=>()=>undeny(),'Hub explicit refusal fence')
  async function environment(requestedChannel?:'stable'|'beta',requireIdle=false){
   const context=await client.context(),identity=await resolveHubHostIdentity(options.userData,options.profileDirectory,client,context)
   const store=new HubGenerationStore(options.userData,identity);lastStore=store
   const state=store.readState(),journal=new HubExecutionJournal(store),pendingRecord=journal.read(),record=pendingRecord?.descriptorDigest===state.active?.descriptorDigest?pendingRecord:journal.readHealthyInventory()
   if(requireIdle&&!hubExecutionCanBegin(pendingRecord))throw new Error('HUB_OPERATION_PENDING')
   let activeGenerationDigest:string|null=null,minimumPolicyRevision=0,channel=requestedChannel??'stable'
   let installed:Parameters<HubHostClient['check']>[1]['installed']=[]
   if(state.active!==null){
    if(!record||record.phase!=='ACTIVATED'&&record.phase!=='COMMITTED')throw new Error('HUB_ACTIVE_INVENTORY_RECOVERY_REQUIRED')
    const saved=inspectSavedHubInventory(record,identity,options.target,trust)
    channel=requestedChannel??saved.plan.channel
    // An old active generation is inventory evidence for planning, not a
    // prerequisite for querying or repairing it. Its boot lease may have been
    // revoked while a newer compatible release is still installable.
    activeGenerationDigest=saved.plan.proposedGenerationDigest;minimumPolicyRevision=saved.plan.policyRevision
    installed=saved.plan.items.map(i=>({kind:i.kind,itemId:i.itemId,releaseId:i.releaseId,artifactDigest:i.artifactDigest,channelRevision:i.channelRevision,enabled:i.enabled,userRemoved:i.action==='uninstall'}))
   }
   const expected:HubSyncExpected={...identity,channel,target:options.target,observedStateDigest:hubSyncDigest(installed),minimumPolicyRevision}
   const snapshot=hubSyncSnapshotData(await client.check(context,{mode:activeGenerationDigest===null?'initial':'check',installed},expected,trust))
   return{context,identity,store,expected,snapshot,activeGenerationDigest,installed}

  }
  async function requireMutationAllowed(){const policy=scope.get('sensteedMandatoryUpdatePolicy');await policy?.ensureMutationAllowed?.();if(policy?.snapshot().phase==='blocking')throw new Error('HUB_DESKTOP_UPDATE_REQUIRED')}
  const manager={
   async check(input:unknown){
    const{channel}=z.strictObject({channel:z.enum(['stable','beta']).optional()}).parse(input),env=await environment(channel)
    return{channel:env.snapshot.channel,profileId:env.identity.profileId,activeGenerationDigest:env.activeGenerationDigest,entries:env.snapshot.entries,activeItems:env.installed.filter(i=>!i.userRemoved).map(i=>({kind:i.kind,itemId:i.itemId,enabled:i.enabled})),operation:summary(env.store)}
   },
   async profiles(input:unknown){
    // docs/1022 §6.4：内容 Profile 存储 Host 所有；双壳渲染进程经同一意图通道触达。
    profiles ??= new ContentProfileStore(join(options.profileDirectory, CONTENT_PROFILES_FILENAME))
    const request=z.object({action:z.string()}).passthrough().parse(input??{})
    if(request.action==='activate'){
     // §6.2 切换必须重新应用：模板出生的 Profile 按冻结修订重注册期望集（Hub 目录
     // 随之改向），再本地置当前；自定义 Profile 仅本地切换（不重定目录范围）。
     const{id}=z.strictObject({action:z.literal('activate'),id:z.uuid()}).parse(input)
     await requireMutationAllowed()
     const profile=profiles.get(id)
     if(!profile)throw new Error('HUB_PROFILE_NOT_FOUND')
     let skippedCount=0
     if(profile.sourceTemplateId&&profile.sourceTemplateRevision){
      const env=await environment()
      const result=await client.registerTemplateSelection(env.context,{
       templateId:profile.sourceTemplateId,revision:profile.sourceTemplateRevision,
       deviceId:env.identity.deviceId,profileId:env.identity.profileId})
      skippedCount=result.skippedItems.length
     }
     if(!profiles.setActive(id))throw new Error('HUB_PROFILE_NOT_FOUND')
     return{switched:true,skippedCount}
    }
    return handleContentProfilesRequest(profiles, input)
   },
   async telemetry(input:unknown){
    const{events}=z.strictObject({events:z.array(z.unknown()).max(64)}).parse(input)
    return await relayHubTelemetry(events)
   },
   async templates(input:unknown){
    const{channel}=z.strictObject({channel:z.enum(['stable','beta']).optional()}).parse(input??{}),env=await environment(channel)
    // 分页拉全量（上限 10 页防御）：模板选择器不做服务端翻页
    const list:HubProfileTemplatePublic[]=[]
    let total=0
    for(let page=1;page<=10;page+=1){
      const result=await client.profileTemplates(env.context,page)
      total=result.total;list.push(...result.list)
      if(list.length>=total||result.list.length===0)break
    }
    return{list,total}
   },
   async instantiate(input:unknown){
    await requireMutationAllowed()
    const{channel,templateId,profileName}=z.strictObject({channel:z.enum(['stable','beta']).optional(),templateId:z.uuid(),profileName:z.string().min(1).max(24)}).parse(input)
    const env=await environment(channel)
    // docs/1022 方案 B：注册期望集（profileId=本端 Profile 目录身份），物化走既有
    // preview→execute→restart 意图管线（快照已被期望集裁剪）
    const result=await client.instantiateProfileTemplate(env.context,{templateId,profileName,deviceId:env.identity.deviceId,profileId:env.identity.profileId})
    // 本地内容 Profile 落库并置当前（§6.3 创建即应用）：切换器/回执/切换埋点的数据源
    profiles ??= new ContentProfileStore(join(options.profileDirectory, CONTENT_PROFILES_FILENAME))
    const local=await recordInstantiatedProfile(profiles,profileName,result)
    return{profileId:env.identity.profileId,contentProfileId:local.id,templateId:result.templateId,revision:result.revision,profileName:result.profileName,items:result.items,mcpEndpoints:result.mcpEndpoints,skippedItems:result.skippedItems,entries:env.snapshot.entries,operation:summary(env.store)}
   },
   async preview(input:unknown){
    await requireMutationAllowed()
    const{channel,requested}=z.strictObject({channel:z.enum(['stable','beta']),requested:requestedSchema}).parse(input),env=await environment(channel,true)
    const pending=new HubExecutionJournal(env.store).read()
    if(!hubExecutionCanBegin(pending))throw new Error('HUB_OPERATION_PENDING')
    const executionClient=new HubGenerationClient(client,env.context),expected:HubGenerationPlanExpected={...env.expected,snapshotId:env.snapshot.snapshotId,snapshotDigest:hubSyncDigest(env.snapshot),expectedActiveGenerationDigest:env.activeGenerationDigest,requested}
    const cap=await executionClient.prepare(expected,trust,randomUUID()),plan=generationPlanData(cap),intentId=randomUUID(),confirmationNonce=randomUUID()
    intents.clear();intents.set(intentId,{nonce:confirmationNonce,cap,client:executionClient,execution:new HubGenerationExecution(env.store,executionClient,client,env.context,trust),store:env.store})
    return{intentId,confirmationNonce,profileId:env.identity.profileId,planDigest:plan.planDigest,expiresAt:plan.expiresAt,totalBytes:plan.totalBytes,items:plan.items.map(i=>({kind:i.kind,itemId:i.itemId,action:i.action,enabled:i.enabled,releaseId:i.releaseId,displayName:env.snapshot.entries.find(e=>e.kind===i.kind&&e.itemId===i.itemId)?.displayName,version:env.snapshot.entries.find(e=>e.kind===i.kind&&e.itemId===i.itemId)?.version,accessDeclaration:env.snapshot.entries.find(e=>e.kind===i.kind&&e.itemId===i.itemId)?.accessDeclaration??null,compatibility:env.snapshot.entries.find(e=>e.kind===i.kind&&e.itemId===i.itemId)?.disposition,evidence:env.snapshot.entries.find(e=>e.kind===i.kind&&e.itemId===i.itemId)?.reason}))}
   },
   async execute(input:unknown){
    await requireMutationAllowed()
    const{intentId,confirmationNonce}=z.strictObject({intentId:z.uuid(),confirmationNonce:z.uuid()}).parse(input),intent=intents.get(intentId)
    intents.delete(intentId)
    if(!intent||intent.nonce!==confirmationNonce)throw new Error('HUB_INTENT_EXPIRED')
    const record=await intent.execution.stage(intent.cap)
    return{operationId:record.operationId,state:'STAGED',phase:record.phase,restartRequired:true,restartReady:false}
   },
   async restart(input:unknown){
    await requireMutationAllowed()
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
  let recovery:Promise<void>|undefined
  async function recoverBoot(){
   try{await resumeOnce()}
   catch(error){
    // Only transport loss or a cold SSO restore may reuse bounded healthy authority.
    // Explicit Hub 401/403 fences offlineOwner(), so it cannot enter this branch.
    if(error instanceof HubHostError&&(error.code==='HUB_UNAVAILABLE'||error.code==='HUB_SSO_REQUIRED')){
     const cached=await loadHubOfflineBoot({...options,client,trust,recoverUnconfirmed:!options.managed}).catch(()=>undefined)
     if(cached){if(!options.managed)await scope.hubGenerationSupervisor.request({kind:'managed',...cached});return}
    }
    if(error instanceof HubHostError&&(error.code==='HUB_ACCESS_DENIED'||error.code==='HUB_SSO_REQUIRED'&&!await client.offlineOwner()))clearHubOfflineBoot(options)
    throw error
   }
  }
  function resume():Promise<void>{if(recovery)return recovery;const pending=recoverBoot();recovery=pending;void pending.finally(()=>{if(recovery===pending)recovery=undefined}).catch(()=>{});return pending}
  async function resumeOnce(){
   const context=await client.context(),identity=await resolveHubHostIdentity(options.userData,options.profileDirectory,client,context),store=new HubGenerationStore(options.userData,identity),journal=new HubExecutionJournal(store)
   let record=journal.read();if(!record)return
   // A new sealed Host can observe prior choices but cannot reuse old execution or boot grants.
   if(record.signedPlan&&inspectSavedHubInventory(record,identity,options.target,trust).hostTargetChanged){
    clearHubOfflineBoot(options)
    await closeManaged()
    return
   }
   const state=store.readState(),active=state.active
   // A prepared candidate is still awaiting restart consent. Otherwise an
   // offline-restored checkpoint must reconcile the failed execution first.
   const awaitingRestart=record.phase==='STAGED'&&state.phase==='prepared'&&state.pending?.descriptorDigest===record.descriptorDigest
   if(active?.descriptorDigest!==record.descriptorDigest
    &&(record.phase==='STAGED'||record.phase==='COMMITTED'||record.phase==='ACTIVATED'||record.phase==='ROLLED_BACK'&&record.pendingReceipt!==null)){
    const failed=inspectSavedHubPlan(record,identity,options.target,trust),executionClient=new HubGenerationClient(client,context)
    let failureOnly=!awaitingRestart&&(!record.pendingReceipt||record.pendingReceipt.phase==='ROLLED_BACK'||record.pendingReceipt.phase==='NEEDS_ATTENTION')
    const recover=()=>executionClient.failureConsumptionForRecovery(failed.envelope,trust,failed.expected,record!.operationId)
    const recovered=await(failureOnly?recover():executionClient.consumptionForRecovery(failed.envelope,trust,failed.expected,record.operationId).catch(async error=>{
     if(!(error instanceof HubRecoveryAuthorizationUnavailable))throw error
     failureOnly=true;return await recover()
    }))
    if(awaitingRestart&&failureOnly){client.assertCurrent(context);await store.discardPrepared(state.revision,record.descriptorDigest!)}
    // Ambiguous sends retain their original sequence, timestamp and evidence.
    // Expired positive sends can only be superseded by a later failure sequence.
    if(record.pendingReceipt&&(!failureOnly||record.pendingReceipt.phase==='ROLLED_BACK'||record.pendingReceipt.phase==='NEEDS_ATTENTION')){await executionClient.receipt(recovered.proof,record.pendingReceipt);record=await journal.acknowledgeReceipt(record)}
    if(record.phase!=='ROLLED_BACK'&&(!awaitingRestart||failureOnly)){
     record=await journal.queueRollbackReceipt(record,{evidenceDigest:hubSyncDigest({activeDescriptorDigest:active?.descriptorDigest??null}),occurredAt:new Date().toISOString(),errorCode:failureOnly&&awaitingRestart?'HUB_EXECUTION_EXPIRED':'HUB_BOOT_FAILED'},failureOnly)
     await executionClient.receipt(recovered.proof,record.pendingReceipt!);record=await journal.acknowledgeReceipt(record)
    }
   }
   if(!active)return
   if(record.descriptorDigest!==active.descriptorDigest){record=journal.readHealthyInventory();if(!record||record.descriptorDigest!==active.descriptorDigest)return}

   const saved=inspectSavedHubPlan(record,identity,options.target,trust),executionClient=new HubGenerationClient(client,context)
   if(record.phase==='STAGED'&&store.readState().phase==='verifying'){
    const recovered=await executionClient.consumptionForRecovery(saved.envelope,trust,saved.expected,record.operationId).catch(async error=>{
     if(options.managed||!(error instanceof HubRecoveryAuthorizationUnavailable))throw error
     client.assertCurrent(context);await store.rollback(state.revision);return undefined
    })
    if(!recovered){await resumeOnce();return}
    if(record.pendingReceipt){await executionClient.receipt(recovered.proof,record.pendingReceipt);record=await journal.acknowledgeReceipt(record)}
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
   if(record.phase==='ACTIVATED')await saveHubOfflineBoot({...options,client,trust,store,lease})
   if(!options.managed){await scope.hubGenerationSupervisor.request({kind:'managed',identity,generationDigest:record.generationDigest,lease});return}
   if(record.phase==='COMMITTED'){
    const evidence=await scope.hubGenerationBoot.inspectLoaded(scope.skills,`hub-${store.readState().active!.generationId}`)
    await scope.hubGenerationSupervisor.waitRendererHealthy(evidence.generationId)
    client.assertCurrent(context)
    verifyHubBootAuthorization(lease,trust,{...identity,target:options.target,generationDigest:record.generationDigest,minimumPolicyRevision:saved.plan.policyRevision})
    const recovered=await executionClient.consumptionForRecovery(saved.envelope,trust,saved.expected,record.operationId)
    if(store.readState().phase==='verifying')await store.markHealthy(evidence.generationId)
    record=await journal.advance(record,'ACTIVATED')
    record=await journal.queueReceipt(record,{phase:'ACTIVATED',evidenceDigest:hubSyncDigest(evidence),occurredAt:new Date().toISOString(),errorCode:null})
    await executionClient.receipt(recovered.proof,record.pendingReceipt!);await journal.acknowledgeReceipt(record);await journal.saveHealthyInventory()
    await saveHubOfflineBoot({...options,client,trust,store,lease})
   }
  }
  if(options.managed){const timer=setInterval(()=>{void resume().catch(()=>{void closeManaged().catch(()=>{})})},60_000);timer.unref();scope.effect(()=>()=>clearInterval(timer),'Hub managed lease renewal')}
  scope.inject(['appReady'],ready=>{ready.appReady?.onReady(()=>{void resume().catch(()=>{scope.logger('hub-generation').warn('Hub managed boot requires authenticated recovery');void closeManaged().catch(()=>{})})})})
  scope.provide('hubGenerationManager',manager)
  scope.effect(()=>()=>intents.clear(),'Desktop Hub intent lifetime')
 })
}
/** Renderer-safe projection of durable journal state. Evidence digests and timestamps stay Host-only. */
export function hubOperationSummary(store:HubGenerationStore){
 const record=new HubExecutionJournal(store).read()
 if(record===undefined)return undefined
 const pending=record.pendingReceipt??null,pendingReceipt=pending===null?undefined:{phase:pending.phase,seq:pending.seq,errorCode:pending.errorCode}
 return {operationId:record.operationId,state:record.phase,phase:record.phase,retryAllowed:record.phase==='NEEDS_ATTENTION'&&hubExecutionCanBegin(record),restartRequired:record.phase==='STAGED'||record.phase==='COMMITTED',restartReady:record.phase==='STAGED'&&pending===null,errorCode:pendingReceipt?.errorCode??(record.phase==='NEEDS_ATTENTION'?'HUB_NEEDS_ATTENTION':undefined),receiptSeq:record.receiptSeq,outboxState:pendingReceipt===undefined?'clear' as const:'pending' as const,pendingReceipt}
}
function summary(store:HubGenerationStore){return hubOperationSummary(store)}
declare module'@deepseek-ai/cordis'{interface Context{hubGenerationManager:unknown}}
