/** Host-only UI intents. All identities, targets, paths and grants remain below this boundary. */
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
export function registerHubGenerationManager(ctx:Context,options:{readonly target:HubSyncTarget;readonly userData:string;readonly profileDirectory:string}):void{
 ctx.inject(['hubHostClient'],scope=>{
  const client=scope.hubHostClient as HubHostClient,trust=readSealedHubReleaseTrust(),intents=new Map<string,Intent>()
  let lastStore:HubGenerationStore|undefined
  async function environment(channel:'stable'|'beta'){
   const context=await client.context(),identity=await resolveHubHostIdentity(options.userData,options.profileDirectory,client,context)
   const store=new HubGenerationStore(options.userData,identity);lastStore=store
   // Existing generations require separately validated durable inventory; never claim empty installed state.
   if(store.readState().active!==null)throw new Error('HUB_ACTIVE_INVENTORY_RECOVERY_REQUIRED')
   const expected:HubSyncExpected={...identity,channel,target:options.target,observedStateDigest:hubSyncDigest([]),minimumPolicyRevision:0}
   const snapshot=hubSyncSnapshotData(await client.check(context,{mode:'initial',installed:[]},expected,trust))
   return{context,identity,store,expected,snapshot}
  }
  const manager={
   async check(input:unknown){
    const{channel}=z.strictObject({channel:z.enum(['stable','beta'])}).parse(input),env=await environment(channel)
    return{profileId:env.identity.profileId,activeGenerationDigest:null,entries:env.snapshot.entries,activeItems:[],operation:summary(env.store)}
   },
   async preview(input:unknown){
    const{channel,requested}=z.strictObject({channel:z.enum(['stable','beta']),requested:requestedSchema}).parse(input),env=await environment(channel)
    const pending=new HubExecutionJournal(env.store).read()
    if(pending&&pending.phase!=='ACTIVATED'&&pending.phase!=='ROLLED_BACK')throw new Error('HUB_OPERATION_PENDING')
    const executionClient=new HubGenerationClient(client,env.context),expected:HubGenerationPlanExpected={...env.expected,snapshotId:env.snapshot.snapshotId,snapshotDigest:hubSyncDigest(env.snapshot),expectedActiveGenerationDigest:null,requested}
    const cap=await executionClient.prepare(expected,trust,randomUUID()),plan=generationPlanData(cap),intentId=randomUUID(),confirmationNonce=randomUUID()
    intents.clear();intents.set(intentId,{nonce:confirmationNonce,cap,client:executionClient,execution:new HubGenerationExecution(env.store,executionClient,client,env.context,trust),store:env.store})
    return{intentId,confirmationNonce,profileId:env.identity.profileId,planDigest:plan.planDigest,expiresAt:plan.expiresAt,totalBytes:plan.totalBytes,items:plan.items.map(i=>({kind:i.kind,itemId:i.itemId,action:i.action,enabled:i.enabled,displayName:env.snapshot.entries.find(e=>e.kind===i.kind&&e.itemId===i.itemId)?.displayName}))}
   },
   async execute(input:unknown){
    const{intentId,confirmationNonce}=z.strictObject({intentId:z.uuid(),confirmationNonce:z.uuid()}).parse(input),intent=intents.get(intentId)
    intents.delete(intentId)
    if(!intent||intent.nonce!==confirmationNonce)throw new Error('HUB_INTENT_EXPIRED')
    const record=await intent.execution.stage(intent.cap)
    return{operationId:record.operationId,state:'STAGED',phase:record.phase,restartRequired:true,restartReady:false}
   },
   async status(input:unknown){
    const{operationId}=z.strictObject({operationId:z.uuid().optional()}).parse(input)
    if(!lastStore)throw new Error('HUB_OPERATION_NOT_FOUND')
    const current=await client.context()
    if(current.tenantId!==lastStore.identity.tenantId||current.actorRef!==lastStore.identity.actorRef)throw new Error('HUB_CONTEXT_CHANGED')
    const result=summary(lastStore)
    if(!result||operationId!==undefined&&result.operationId!==operationId)throw new Error('HUB_OPERATION_NOT_FOUND')
    return result
   },
  }
  scope.provide('hubGenerationManager',manager)
  scope.effect(()=>()=>intents.clear(),'Desktop Hub intent lifetime')
 })
}
function summary(store:HubGenerationStore){const record=new HubExecutionJournal(store).read();return record===undefined?undefined:{operationId:record.operationId,state:record.phase,phase:record.phase,restartRequired:record.phase==='STAGED'||record.phase==='COMMITTED',restartReady:false}}
declare module'@deepseek-ai/cordis'{interface Context{hubGenerationManager:unknown}}
