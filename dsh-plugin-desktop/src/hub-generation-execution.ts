/** Host-owned aggregate transaction: consume once, materialize privately, then stage for a safe restart. */
import { randomUUID } from 'node:crypto'
import { HubExecutionJournal, type HubExecutionRecord } from './hub-execution-journal.ts'
import { HubGenerationClient, hubGenerationConsumptionData, type VerifiedHubGenerationConsumption } from './hub-generation-client.ts'
import { generationPlanData, type VerifiedHubGenerationPlan } from './hub-generation-verifier.ts'
import { materializeHubGeneration } from './hub-generation-materializer.ts'
import { HubGenerationStore } from './hub-generation-store.ts'
import type { HubReleaseTrust } from './hub-sync-verifier.ts'
import { hubSyncDigest } from './hub-sync-verifier.ts'
import type { HubHostClient, HubHostContext } from './hub-host-client.ts'
export class HubGenerationExecution {
 constructor(private readonly store:HubGenerationStore,private readonly execution:HubGenerationClient,
  private readonly client:HubHostClient,private readonly context:HubHostContext,private readonly trust:HubReleaseTrust){}
 /** Leaves active generation untouched. Launcher must stop old writers before separate activation. */
 async stage(cap:VerifiedHubGenerationPlan):Promise<HubExecutionRecord>{
  const journal=new HubExecutionJournal(this.store),plan=generationPlanData(cap)
  let record=await journal.begin(cap),proof:VerifiedHubGenerationConsumption|undefined
  try{
   const grant=await this.execution.authorize(cap)
   record=await journal.advance(record,'CONSUMING')
   // Unknown consume results are recovered only with the same persisted operationId.
   try{await this.execution.consume(cap,grant,record.operationId)}catch{await this.execution.status(cap,record.operationId)}
   proof=await this.execution.consumption(cap,record.operationId)
   const authority=hubGenerationConsumptionData(proof)
   record=await journal.advance(record,'AUTHORIZED',{executionGeneration:authority.executionGeneration,executionExpiresAt:authority.executionExpiresAt})
   const downloads=await this.execution.downloads(cap,proof)
   const descriptor=await materializeHubGeneration({store:this.store,generationId:randomUUID(),plan,proof,downloads,trust:this.trust,client:this.client,context:this.context})
   hubGenerationConsumptionData(proof)
   const state=await this.store.prepare(descriptor)
   record=await journal.advance(record,'STAGED',{descriptorDigest:state.pending!.descriptorDigest})
   record=await journal.queueReceipt(record,{phase:'STAGED',evidenceDigest:hubSyncDigest({descriptorDigest:state.pending!.descriptorDigest,files:descriptor.files}),occurredAt:new Date().toISOString(),errorCode:null})
   await this.execution.receipt(proof,record.pendingReceipt!)
   return await journal.acknowledgeReceipt(record)
  }catch(cause){
   // A queued receipt must be retried exactly, never replaced with a contradictory failure phase.
   const latest=journal.read()
   if(latest && latest.pendingReceipt===null && latest.phase!=='ACTIVATED'&&latest.phase!=='ROLLED_BACK'){
    const phase=proof===undefined||this.store.readState().phase==='prepared'?'NEEDS_ATTENTION':'ROLLED_BACK'
    record=await journal.advance(latest,phase)
    if(proof!==undefined){
     record=await journal.queueReceipt(record,{phase:phase as 'ROLLED_BACK'|'NEEDS_ATTENTION',evidenceDigest:hubSyncDigest({error:'HUB_STAGE_FAILED',activeUnchanged:true}),occurredAt:new Date().toISOString(),errorCode:'HUB_STAGE_FAILED'})
     await this.execution.receipt(proof,record.pendingReceipt!).then(async()=>{await journal.acknowledgeReceipt(record)}).catch(()=>{})
    }
   }
   throw cause
  }
 }
}
