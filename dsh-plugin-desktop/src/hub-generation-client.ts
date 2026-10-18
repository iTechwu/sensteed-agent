/** Fixed-origin aggregate execution transport. Catalog capabilities never authorize mutation. */
import { z } from 'zod'
import { HubHostClient, type HubHostContext } from './hub-host-client.ts'
import { generationPlanData, verifyHubGenerationPlan, inspectHubGenerationPlanForRecovery, type VerifiedHubGenerationPlan, type HubGenerationPlanExpected } from './hub-generation-verifier.ts'
import type { HubReleaseTrust } from './hub-sync-verifier.ts'
const grantSchema = z.strictObject({ executionGrant: z.uuid(), expiresAt: z.iso.datetime() })
const statusSchema = z.strictObject({
  planId: z.uuid(), operationId: z.uuid(), state: z.enum(['unconsumed', 'consumed', 'expired']), authorized: z.boolean(),
  executionGeneration: z.string().regex(/^[1-9][0-9]*$/u).nullable(), executionExpiresAt: z.iso.datetime().nullable(),
  proposedGenerationDigest: z.string().regex(/^[a-f0-9]{64}$/u),
})
export type HubExecutionStatus = z.infer<typeof statusSchema>
declare const consumptionBrand: unique symbol
export interface VerifiedHubGenerationConsumption { readonly [consumptionBrand]: true }
const consumptions = new WeakMap<VerifiedHubGenerationConsumption, Readonly<{ planId: string; planDigest: string; operationId: string; tenantId: string; actorRef: string; deviceId: string; profileId: string; executionGeneration: string; executionExpiresAt: string; proposedGenerationDigest: string; previousGenerationDigest: string | null }>>()
export function hubGenerationConsumptionData(cap: VerifiedHubGenerationConsumption) {
  const proof = consumptions.get(cap)
  if (!proof || Date.parse(proof.executionExpiresAt) <= Date.now()) throw new Error('Invalid or expired Hub consumption capability')
  consumptionOwners.get(cap)!()
  return proof
}
const consumptionOwners = new WeakMap<VerifiedHubGenerationConsumption, () => void>()
const envelopes = new WeakMap<VerifiedHubGenerationPlan, unknown>()
export function generationPlanEnvelope(cap: VerifiedHubGenerationPlan): unknown {
  generationPlanData(cap)
  if (!envelopes.has(cap)) throw new Error('Plan envelope is unavailable')
  return structuredClone(envelopes.get(cap))
}
export type HubExecutionGrant = Readonly<z.infer<typeof grantSchema>>
export class HubGenerationClient {
  constructor(private readonly client: HubHostClient, private readonly context: HubHostContext) {}
  private binding(cap: VerifiedHubGenerationPlan) {
    this.client.assertCurrent(this.context)
    const plan = generationPlanData(cap)
    if (plan.tenantId !== this.context.tenantId || plan.actorRef !== this.context.actorRef) throw new Error('Hub execution identity changed')
    return { plan, body: { deviceId: plan.deviceId, profileId: plan.profileId, planDigest: plan.planDigest, expectedActiveGenerationDigest: plan.expectedActiveGenerationDigest } }
  }
  async prepare(expected: HubGenerationPlanExpected, trust: HubReleaseTrust, idempotencyKey: string): Promise<VerifiedHubGenerationPlan> {
    this.client.assertCurrent(this.context)
    if (expected.tenantId !== this.context.tenantId || expected.actorRef !== this.context.actorRef) throw new Error('Hub execution identity changed')
    const value = await this.client.generationRequest(this.context, { kind: 'prepare', idempotencyKey, body: {
      deviceId: expected.deviceId, profileId: expected.profileId, snapshotId: expected.snapshotId, snapshotDigest: expected.snapshotDigest,
      target: expected.target, observedStateDigest: expected.observedStateDigest, expectedActiveGenerationDigest: expected.expectedActiveGenerationDigest,
      requested: expected.requested,
    } })
    const cap = verifyHubGenerationPlan(value, trust, expected)
    envelopes.set(cap, structuredClone(value))
    return cap
  }
  async authorize(cap: VerifiedHubGenerationPlan): Promise<HubExecutionGrant> {
    const { plan, body } = this.binding(cap)
    if (Date.parse(plan.expiresAt) <= Date.now()) throw new Error('Hub execution plan expired')
    const grant = grantSchema.parse(await this.client.generationRequest(this.context, { kind: 'authorize', planId: plan.planId, body }))
    if (Date.parse(grant.expiresAt) <= Date.now() || Date.parse(grant.expiresAt) > Date.parse(plan.expiresAt)) throw new Error('Hub execution grant expired')
    return Object.freeze(grant)
  }
  async consume(cap: VerifiedHubGenerationPlan, grant: HubExecutionGrant, operationId: string): Promise<Readonly<HubExecutionStatus>> {
    const { plan, body } = this.binding(cap)
    z.uuid().parse(operationId); grantSchema.parse(grant)
    if (Date.parse(grant.expiresAt) <= Date.now() || Date.parse(plan.expiresAt) <= Date.now()) throw new Error('Hub execution grant expired')
    return this.statusReply(cap, operationId, await this.client.generationRequest(this.context, { kind: 'consume', planId: plan.planId,
      body: { ...body, operationId, executionGrant: grant.executionGrant } }))
  }
  /** Recover unknown consume results with the exact same operation; never mint a replacement operation. */
  async status(cap: VerifiedHubGenerationPlan, operationId: string): Promise<Readonly<HubExecutionStatus>> {
    const { plan, body } = this.binding(cap); z.uuid().parse(operationId)
    return this.statusReply(cap, operationId, await this.client.generationRequest(this.context, { kind: 'consume-status', planId: plan.planId, body: { ...body, operationId } }))
  }
  /** Only a fresh SSO-bound status response can mint this process-local execution proof. */
  async consumption(cap: VerifiedHubGenerationPlan, operationId: string): Promise<VerifiedHubGenerationConsumption> {
    const status = await this.status(cap, operationId), plan = generationPlanData(cap)
    if (!status.authorized || status.state !== 'consumed' || !status.executionGeneration || !status.executionExpiresAt) throw new Error('Hub operation is not authorized')
    const capability = Object.freeze({}) as VerifiedHubGenerationConsumption
    consumptions.set(capability, Object.freeze({ planId: plan.planId, planDigest: plan.planDigest, operationId,
      tenantId: plan.tenantId, actorRef: plan.actorRef, deviceId: plan.deviceId, profileId: plan.profileId,
      executionGeneration: status.executionGeneration, executionExpiresAt: status.executionExpiresAt, proposedGenerationDigest: plan.proposedGenerationDigest, previousGenerationDigest: plan.expectedActiveGenerationDigest }))
    consumptionOwners.set(capability, () => this.client.assertCurrent(this.context))
    return capability
  }
  /** Cryptographic observation alone cannot execute. Fresh operation status is always required. */
  async consumptionForRecovery(envelope: unknown, trust: HubReleaseTrust, expected: HubGenerationPlanExpected, operationId: string) {
    this.client.assertCurrent(this.context)
    if (expected.tenantId !== this.context.tenantId || expected.actorRef !== this.context.actorRef) throw new Error('Hub execution identity changed')
    z.uuid().parse(operationId)
    const plan = inspectHubGenerationPlanForRecovery(envelope, trust, expected)
    const value = await this.client.generationRequest(this.context, { kind: 'consume-status', planId: plan.planId,
      body: { deviceId: plan.deviceId, profileId: plan.profileId, planDigest: plan.planDigest,
        expectedActiveGenerationDigest: plan.expectedActiveGenerationDigest, operationId } })
    const status = statusSchema.parse(value)
    if (status.planId !== plan.planId || status.operationId !== operationId || status.proposedGenerationDigest !== plan.proposedGenerationDigest
      || status.state !== 'consumed' || !status.authorized || !status.executionGeneration || !status.executionExpiresAt
      || Date.parse(status.executionExpiresAt) <= Date.now()) throw new Error('Hub recovery operation is not authorized')
    const proof = Object.freeze({}) as VerifiedHubGenerationConsumption
    consumptions.set(proof, Object.freeze({ planId: plan.planId, planDigest: plan.planDigest, operationId,
      tenantId: plan.tenantId, actorRef: plan.actorRef, deviceId: plan.deviceId, profileId: plan.profileId,
      executionGeneration: status.executionGeneration, executionExpiresAt: status.executionExpiresAt, proposedGenerationDigest: plan.proposedGenerationDigest, previousGenerationDigest: plan.expectedActiveGenerationDigest }))
    consumptionOwners.set(proof, () => this.client.assertCurrent(this.context))
    return Object.freeze({ plan, proof })
  }
  async receipt(proof: VerifiedHubGenerationConsumption, receipt: {
    readonly seq: number; readonly previousGenerationDigest: string | null; readonly phase: 'STAGED' | 'COMMITTED' | 'ACTIVATED' | 'ROLLED_BACK' | 'NEEDS_ATTENTION';
    readonly evidenceDigest: string; readonly occurredAt: string; readonly errorCode: string | null
  }): Promise<void> {
    const authority = consumptions.get(proof)
    if (!authority) throw new Error('Invalid Hub consumption capability')
    consumptionOwners.get(proof)!()
    if (receipt.previousGenerationDigest !== authority.previousGenerationDigest) throw new Error('Hub receipt previous generation mismatch')
    if (authority.tenantId !== this.context.tenantId || authority.actorRef !== this.context.actorRef) throw new Error('Hub receipt identity changed')
    z.strictObject({ seq:z.number().int().nonnegative(),previousGenerationDigest:z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
      phase:z.enum(['STAGED','COMMITTED','ACTIVATED','ROLLED_BACK','NEEDS_ATTENTION']),evidenceDigest:z.string().regex(/^[a-f0-9]{64}$/u),
      occurredAt:z.iso.datetime(),errorCode:z.string().max(120).nullable() }).parse(receipt)
    const result = await this.client.generationRequest(this.context, { kind:'receipt', body:{ ...receipt,
      deviceId:authority.deviceId,profileId:authority.profileId,planId:authority.planId,planDigest:authority.planDigest,
      operationId:authority.operationId,executionGeneration:authority.executionGeneration,generationDigest:authority.proposedGenerationDigest } })
    z.strictObject({ack:z.literal(true)}).parse(result)
  }
  private statusReply(cap: VerifiedHubGenerationPlan, operationId: string, value: unknown): Readonly<HubExecutionStatus> {
    const plan = generationPlanData(cap), status = statusSchema.parse(value)
    if (status.planId !== plan.planId || status.operationId !== operationId || status.proposedGenerationDigest !== plan.proposedGenerationDigest) throw new Error('Hub execution status binding mismatch')
    if (status.state === 'consumed' && (!status.executionGeneration || !status.executionExpiresAt)
      || status.authorized && (status.state !== 'consumed' || Date.parse(status.executionExpiresAt!) <= Date.now())) throw new Error('Hub execution status invalid')
    return Object.freeze(status)
  }
}
