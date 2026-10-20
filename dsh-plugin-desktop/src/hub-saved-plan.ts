/** Recover cryptographic inventory as observation; this never mints execution authority. */
import{HubGenerationPlanSchema,inspectHubGenerationPlanForRecovery,type HubGenerationPlanExpected}from'./hub-generation-verifier.ts'
import type{HubGenerationIdentity}from'./hub-generation-store.ts'
import{hubSyncDigest,type HubSyncTarget,type HubReleaseTrust}from'./hub-sync-verifier.ts'
import type{HubExecutionRecord}from'./hub-execution-journal.ts'
export function inspectSavedHubPlan(record:HubExecutionRecord,identity:HubGenerationIdentity,target:HubSyncTarget,trust:HubReleaseTrust){
 const envelope=record.signedPlan
 if(!envelope)throw new Error('Hub signed inventory is unavailable')
 const observation=HubGenerationPlanSchema.parse(envelope.plan)
 const expected:HubGenerationPlanExpected={...identity,target,channel:observation.channel,snapshotId:observation.snapshotId,snapshotDigest:observation.snapshotDigest,observedStateDigest:observation.observedStateDigest,expectedActiveGenerationDigest:observation.expectedActiveGenerationDigest,minimumPolicyRevision:observation.policyRevision,requested:observation.items.map(i=>({kind:i.kind,itemId:i.itemId,action:i.action,enabled:i.enabled}))}
 const plan=inspectHubGenerationPlanForRecovery(envelope,trust,expected)
 if(plan.planId!==record.planId||plan.planDigest!==record.planDigest||plan.proposedGenerationDigest!==record.generationDigest||plan.expectedActiveGenerationDigest!==record.previousGenerationDigest)throw new Error('Hub journal inventory mismatch')
 return{plan,expected,envelope}
}

/** Signed historical observation for planning only. Never use its old target to boot or execute. */
export function inspectSavedHubInventory(record:HubExecutionRecord,identity:HubGenerationIdentity,target:HubSyncTarget,trust:HubReleaseTrust){
 if(!record.signedPlan)throw new Error('Hub signed inventory is unavailable')
 const observation=HubGenerationPlanSchema.parse(record.signedPlan.plan)
 const saved=inspectSavedHubPlan(record,identity,observation.target,trust)
 return {...saved,hostTargetChanged:hubSyncDigest(saved.plan.target)!==hubSyncDigest(target)}
}
