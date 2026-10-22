import type {} from '@dofe/dsh-sensteed-product/update-policy'
/** Host-only UI intents. All identities, targets, paths and grants remain below this boundary. */
import{inspectSavedHubPlan,inspectSavedHubInventory}from'./hub-saved-plan.ts'
import{join}from'node:path'
import{withFileLock}from'@deepseek-ai/dsh-atomic-write'
import{withDesktopMaintenance}from'./desktop-maintenance.ts'
import{ContentProfileStore,handleContentProfilesRequest,CONTENT_PROFILES_FILENAME,type ContentProfileApplication}from'./content-profiles.ts'
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
type Intent={nonce:string;cap:VerifiedHubGenerationPlan;client:HubGenerationClient;execution:HubGenerationExecution;store:HubGenerationStore;selection?:{id:string;digest:string}|undefined}
export function registerHubGenerationManager(ctx:Context,options:{readonly target:HubSyncTarget;readonly userData:string;readonly profileDirectory:string;readonly managed?:boolean}):void{
 ctx.inject(['hubHostClient'],scope=>{
  const client=scope.hubHostClient as HubHostClient,trust=readSealedHubReleaseTrust(),intents=new Map<string,Intent>()
  let profiles:ContentProfileStore|undefined
  const content=()=>profiles??=new ContentProfileStore(join(options.profileDirectory,CONTENT_PROFILES_FILENAME))
  let disposed=false
  let mutationTail:Promise<unknown>=Promise.resolve()
  function mutate<T>(action:()=>Promise<T>,authorize=true):Promise<T>{
   const work=mutationTail.then(()=>withDesktopMaintenance('profile-switch',()=>withFileLock(join(options.profileDirectory,`${CONTENT_PROFILES_FILENAME}.selection`),async()=>{if(disposed)throw Error('HUB_HOST_DISPOSED');if(authorize)await requireMutationAllowed();return action()})))
   mutationTail=work.catch(()=>{});return work
  }
  async function applyMcp(items:ReturnType<ContentProfileStore['list']>[number]['items']){
   const endpoints=items.filter(item=>item.kind==='mcp.endpoint').map(({service,domain,version,enabled})=>({service,domain,version,enabled}))
   const mcp=scope.get('hubMcp') as unknown as {applyProfileEndpoints?:(selection:typeof endpoints)=>Promise<void>}|undefined
   if(!mcp?.applyProfileEndpoints){if(endpoints.length)throw Error('HUB_MCP_HOST_UNAVAILABLE');return}
   await mcp.applyProfileEndpoints(endpoints)
  }
  function reconcileContent(store:HubGenerationStore){return mutate(async()=>{
   const application=content().application();if(!application||application.scope!==store.scope)return
   const record=new HubExecutionJournal(store).read()
   // The selection is written before stage starts. No matching journal after a
   // crash means staging never began; recovery remains available during updates.
   if(!record||record.operationId!==application.operationId&&hubExecutionCanBegin(record)){
    await content().finishApplication(application,false,'HUB_STAGE_INTERRUPTED');return
   }
   if(record.operationId!==application.operationId||record.planDigest!==application.planDigest||record.generationDigest!==application.generationDigest)return
   if(record.phase==='ACTIVATED'&&record.pendingReceipt===null&&options.managed&&store.readState().active?.descriptorDigest===record.descriptorDigest){
    const saved=inspectSavedHubPlan(record,store.identity,options.target,trust)
    const profile=content().get(application.contentProfileId)
    if(!profile||content().selectionDigest(profile.id)!==application.selectionDigest)throw Error('HUB_PROFILE_SELECTION_CHANGED')
    await applyMcp(profile.items)
    const context=await client.context()
    const resolved=await client.registerOperationSelection(context,{deviceId:store.identity.deviceId,profileId:store.identity.profileId,planId:saved.plan.planId,operationId:record.operationId})
    const key=(item:{kind:string;itemId:string;releaseId:string;enabled:boolean})=>JSON.stringify([item.kind,item.itemId,item.releaseId,item.enabled])
    if(resolved.items.map(key).sort().join('\n')!==saved.plan.items.filter(item=>item.action!=='uninstall').map(key).sort().join('\n'))throw Error('HUB_PROFILE_OPERATION_SELECTION_MISMATCH')
    await content().finishApplication(application,true,undefined,{items:resolved.items,planId:saved.plan.planId})
   }else if(record.pendingReceipt===null&&(record.phase==='ROLLED_BACK'||record.phase==='NEEDS_ATTENTION'&&hubExecutionCanBegin(record))){await content().finishApplication(application,false,'HUB_PROFILE_APPLY_FAILED')}
  },false)}
  let lastStore:HubGenerationStore|undefined
  function projectContent(){
   const projection=content().projection(),state=content().load()
   if(!options.managed||!lastStore||state.appliedScope!==lastStore.scope)return{...projection,appliedId:null}
   const active=lastStore.readState().active,loaded=scope.hubGenerationBoot
   if(!active||loaded?.generationId!==active.generationId)return{...projection,appliedId:null}
   const journal=new HubExecutionJournal(lastStore),pending=journal.read(),record=pending?.descriptorDigest===active.descriptorDigest?pending:journal.readHealthyInventory()
   const applied=state.profiles.find(profile=>profile.id===state.appliedId)
   if(record?.phase!=='ACTIVATED'||record.pendingReceipt!==null||record.descriptorDigest!==active.descriptorDigest||applied?.selectionOperation?.operationId!==record.operationId)return{...projection,appliedId:null}
   return projection
  }
  let closing=false
  async function closeManaged(){if(!options.managed||closing)return;closing=true;await scope.hubGenerationSupervisor.request({kind:'base'})}
  const unwatch=client.watchInvalidation(()=>{intents.clear();lastStore=undefined;if(options.managed){void closeManaged().catch(()=>{})}else{const pending=recovery;setImmediate(()=>{void (pending??Promise.resolve()).catch(()=>{}).then(()=>resume()).catch(()=>{})})}})
  scope.effect(()=>()=>unwatch(),'Hub identity fence')
  const undeny=client.watchOfflineDenial(()=>{intents.clear();lastStore=undefined;clearHubOfflineBoot(options);void closeManaged().catch(()=>{})})
  scope.effect(()=>()=>undeny(),'Hub explicit refusal fence')
  async function identityEnvironment(requireIdle=false){
   const context=await client.context(),identity=await resolveHubHostIdentity(options.userData,options.profileDirectory,client,context)
   const store=new HubGenerationStore(options.userData,identity);lastStore=store
   if(requireIdle&&!hubExecutionCanBegin(new HubExecutionJournal(store).read()))throw new Error('HUB_OPERATION_PENDING')
   return{context,identity,store}
  }
  async function environment(requestedChannel?:'stable'|'beta',requireIdle=false){
   const{context,identity,store}=await identityEnvironment(requireIdle)
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
    await reconcileContent(env.store)
    return{channel:env.snapshot.channel,profileId:env.identity.profileId,activeGenerationDigest:env.activeGenerationDigest,entries:env.snapshot.entries,activeItems:env.installed.filter(i=>!i.userRemoved).map(i=>({kind:i.kind,itemId:i.itemId,enabled:i.enabled})),operation:summary(env.store),contentProfile:projectContent()}
   },
   async profiles(input:unknown){
    const request=z.object({action:z.string()}).passthrough().parse(input??{})
    if(request.action==='status')return projectContent()
    if(['create','set-active','mark-applied'].includes(request.action))throw Error('HUB_PROFILE_ACTION_FORBIDDEN')
    if(request.action==='activate')return mutate(async()=>{
     const{id}=z.strictObject({action:z.literal('activate'),id:z.uuid()}).parse(input)
     const profile=content().get(id)
     if(!profile)throw Error('HUB_PROFILE_NOT_FOUND')
     if(!profile.sourceTemplateId||!profile.sourceTemplateRevision)throw Error('HUB_PROFILE_TEMPLATE_REQUIRED')
     const env=await identityEnvironment(true)
     await content().beginRegistration(id);intents.clear()
     try{
      const result=profile.selectionOperation?{...await client.registerOperationSelection(env.context,{...profile.selectionOperation,deviceId:env.identity.deviceId,profileId:env.identity.profileId}),revision:profile.sourceTemplateRevision,mcpEndpoints:profile.items.filter(item=>item.kind==='mcp.endpoint'),skippedItems:profile.skippedItems,templateId:profile.sourceTemplateId}:await client.registerTemplateSelection(env.context,{templateId:profile.sourceTemplateId,revision:profile.sourceTemplateRevision,deviceId:env.identity.deviceId,profileId:env.identity.profileId})
      await content().register(id,{...result,templateRevision:result.revision})
      return{registered:true,skippedCount:result.skippedItems.length}
     }catch(error){await content().registrationFailed(id);throw error}
    })
    if(request.action==='rename'||request.action==='remove')return mutate(()=>handleContentProfilesRequest(content(),input))
    return handleContentProfilesRequest(content(),input)
   },
   async telemetry(input:unknown){
    const{events}=z.strictObject({events:z.array(z.unknown()).max(64)}).parse(input)
    return await relayHubTelemetry(events)
   },
   async templates(input:unknown){
    z.strictObject({channel:z.enum(['stable','beta']).optional()}).parse(input??{});const env=await identityEnvironment()
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
   async'template-preview'(input:unknown){
    // docs/1022 §6.3：卡片展开逐项 disposition 预览（创建前阻断项显式呈现）
    const{templateId}=z.strictObject({channel:z.enum(['stable','beta']).optional(),templateId:z.uuid()}).parse(input)
    const env=await identityEnvironment()
    return await client.profileTemplatePreview(env.context,templateId)
   },
   async instantiate(input:unknown){return mutate(async()=>{
    const{templateId,templateRevision,profileName}=z.strictObject({channel:z.enum(['stable','beta']).optional(),templateId:z.uuid(),templateRevision:z.number().int().positive().optional(),profileName:z.string().trim().min(1).max(24)}).parse(input)
    const env=await identityEnvironment(true),preview=await client.profileTemplatePreview(env.context,templateId)
    if(templateRevision!==undefined&&templateRevision!==preview.revision)throw Error('HUB_TEMPLATE_CHANGED')
    const local=await content().create(profileName,{templateId,templateRevision:preview.revision,items:[],mcpEndpoints:[],skippedItems:[]})
    await content().beginRegistration(local.id);intents.clear()
    try{
     const result=await client.registerTemplateSelection(env.context,{templateId,revision:preview.revision,deviceId:env.identity.deviceId,profileId:env.identity.profileId})
     await content().register(local.id,{...result,templateRevision:result.revision})
     return{profileId:env.identity.profileId,contentProfileId:local.id,templateId,revision:result.revision,profileName:local.name,items:result.items,mcpEndpoints:result.mcpEndpoints,skippedItems:result.skippedItems,entries:[],operation:summary(env.store)}
    }catch(error){await content().registrationFailed(local.id);throw error}
   })},
   async preview(input:unknown){return mutate(async()=>{
    const state=content().projection()
    if(state.apply.phase==='registering'||state.apply.error==='HUB_PROFILE_REGISTRATION_UNCONFIRMED')throw Error('HUB_PROFILE_REGISTRATION_UNCONFIRMED')
    const{channel,requested}=z.strictObject({channel:z.enum(['stable','beta']),requested:requestedSchema}).parse(input),env=await environment(channel,true)
    const pending=new HubExecutionJournal(env.store).read()
    if(!hubExecutionCanBegin(pending))throw new Error('HUB_OPERATION_PENDING')
    const executionClient=new HubGenerationClient(client,env.context),expected:HubGenerationPlanExpected={...env.expected,snapshotId:env.snapshot.snapshotId,snapshotDigest:hubSyncDigest(env.snapshot),expectedActiveGenerationDigest:env.activeGenerationDigest,requested}
    const cap=await executionClient.prepare(expected,trust,randomUUID()),plan=generationPlanData(cap),intentId=randomUUID(),confirmationNonce=randomUUID()
    const registeredId=content().activeId(),selection=registeredId?{id:registeredId,digest:content().selectionDigest(registeredId)}:undefined
    intents.clear();intents.set(intentId,{selection,nonce:confirmationNonce,cap,client:executionClient,execution:new HubGenerationExecution(env.store,executionClient,client,env.context,trust),store:env.store})
    return{intentId,confirmationNonce,profileId:env.identity.profileId,planDigest:plan.planDigest,expiresAt:plan.expiresAt,totalBytes:plan.totalBytes,items:plan.items.map(i=>({kind:i.kind,itemId:i.itemId,action:i.action,enabled:i.enabled,releaseId:i.releaseId,displayName:env.snapshot.entries.find(e=>e.kind===i.kind&&e.itemId===i.itemId)?.displayName,version:env.snapshot.entries.find(e=>e.kind===i.kind&&e.itemId===i.itemId)?.version,accessDeclaration:env.snapshot.entries.find(e=>e.kind===i.kind&&e.itemId===i.itemId)?.accessDeclaration??null,compatibility:env.snapshot.entries.find(e=>e.kind===i.kind&&e.itemId===i.itemId)?.disposition,evidence:env.snapshot.entries.find(e=>e.kind===i.kind&&e.itemId===i.itemId)?.reason}))}
   })},
   async execute(input:unknown){return mutate(async()=>{
    const{intentId,confirmationNonce}=z.strictObject({intentId:z.uuid(),confirmationNonce:z.uuid()}).parse(input),intent=intents.get(intentId)
    intents.delete(intentId)
    if(!intent||intent.nonce!==confirmationNonce)throw new Error('HUB_INTENT_EXPIRED')
    if(intent.selection&&(content().activeId()!==intent.selection.id||content().selectionDigest(intent.selection.id)!==intent.selection.digest))throw Error('HUB_PROFILE_SELECTION_CHANGED')
    const operationId=randomUUID(),plan=generationPlanData(intent.cap)
    const application:ContentProfileApplication|undefined=intent.selection?{contentProfileId:intent.selection.id,selectionDigest:intent.selection.digest,operationId,planDigest:plan.planDigest,generationDigest:plan.proposedGenerationDigest,scope:intent.store.scope}:undefined
    if(application)await content().beginApplication(application)
    let record
    try{record=await intent.execution.stage(intent.cap,operationId)}catch(error){
     const pending=new HubExecutionJournal(intent.store).read()
     if(application&&(!pending||pending.operationId!==operationId||hubExecutionCanBegin(pending)))await content().finishApplication(application,false,'HUB_STAGE_FAILED')
     throw error
    }
    return{operationId:record.operationId,state:'STAGED',phase:record.phase,restartRequired:true,restartReady:false}
   })},
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
    await reconcileContent(lastStore)
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
     if(cached){lastStore=new HubGenerationStore(options.userData,cached.identity);if(!options.managed)await scope.hubGenerationSupervisor.request({kind:'managed',...cached});return}
    }
    if(error instanceof HubHostError&&(error.code==='HUB_ACCESS_DENIED'||error.code==='HUB_SSO_REQUIRED'&&!await client.offlineOwner()))clearHubOfflineBoot(options)
    throw error
   }
  }
  function resume():Promise<void>{if(recovery)return recovery;const pending=recoverBoot();recovery=pending;void pending.finally(()=>{if(recovery===pending)recovery=undefined}).catch(()=>{});return pending}
  async function resumeOnce(){
   const context=await client.context(),identity=await resolveHubHostIdentity(options.userData,options.profileDirectory,client,context),store=new HubGenerationStore(options.userData,identity),journal=new HubExecutionJournal(store)
   lastStore=store
   let record=journal.read();if(!record){await reconcileContent(store);return}
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
    const application=content().application()
    if(application?.scope===store.scope&&application.operationId===record.operationId){const profile=content().get(application.contentProfileId);if(!profile||content().selectionDigest(profile.id)!==application.selectionDigest)throw Error('HUB_PROFILE_SELECTION_CHANGED');await applyMcp(profile.items)}
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
   await reconcileContent(store)
   if(options.managed&&!content().application()&&content().load().appliedId&&content().load().appliedScope===store.scope)await applyMcp(content().load().appliedItems??[])
  }
  if(options.managed){const timer=setInterval(()=>{void resume().catch(()=>{void closeManaged().catch(()=>{})})},60_000);timer.unref();scope.effect(()=>()=>clearInterval(timer),'Hub managed lease renewal')}
  scope.inject(['appReady'],ready=>{ready.appReady?.onReady(()=>{void resume().catch(()=>{scope.logger('hub-generation').warn('Hub managed boot requires authenticated recovery');void closeManaged().catch(()=>{})})})})
  scope.provide('hubGenerationManager',manager)
  scope.effect(()=>async()=>{disposed=true;intents.clear();await recovery?.catch(()=>{});await mutationTail;await profiles?.flush()},'Desktop Hub intent lifetime')
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
