/** Recover cryptographic inventory as observation; this never mints execution authority. */
import{HubGenerationPlanSchema,inspectHubGenerationPlanForRecovery,type HubGenerationPlanExpected}from'./hub-generation-verifier.ts'
import type{HubGenerationIdentity}from'./hub-generation-store.ts'
import type{HubSyncTarget,HubReleaseTrust}from'./hub-sync-verifier.ts'
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
