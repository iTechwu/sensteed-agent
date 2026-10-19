/** Read-only signed boot authority; cannot authorize an installation or new operation. */
import {z}from'zod'
import {HubReleaseSignatureSchema,HubSyncTargetSchema,hubSyncDigest,verifyHubReleaseSignature,freezeHubValue,type HubReleaseTrust,type HubSyncTarget}from'./hub-sync-verifier.ts'
import {HUB_GENERATION_ORIGIN,type HubGenerationIdentity}from'./hub-generation-store.ts'
const digest=z.string().regex(/^[a-f0-9]{64}$/u)
const schema=z.strictObject({schemaVersion:z.literal('hub-generation-boot-v1'),origin:z.literal(HUB_GENERATION_ORIGIN),tenantId:z.uuid(),actorRef:z.string().min(1).max(128),deviceId:z.uuid(),profileId:z.uuid(),target:HubSyncTargetSchema,generationDigest:digest,contentDigest:digest,policyRevision:z.number().int().nonnegative(),issuedAt:z.iso.datetime(),expiresAt:z.iso.datetime()})
declare const brand:unique symbol
export interface VerifiedHubBootAuthorization{readonly[brand]:true}
const leases=new WeakMap<VerifiedHubBootAuthorization,Readonly<z.infer<typeof schema>>>()
export function verifyHubBootAuthorization(value:unknown,trust:HubReleaseTrust,expected:HubGenerationIdentity&{readonly target:HubSyncTarget;readonly generationDigest:string;readonly minimumPolicyRevision:number},now=Date.now()):VerifiedHubBootAuthorization{
 const{authorization:a,signature}=z.strictObject({authorization:schema,signature:HubReleaseSignatureSchema}).parse(value)
 verifyHubReleaseSignature(a,signature,trust)
 for(const key of ['origin','tenantId','actorRef','deviceId','profileId','generationDigest']as const)if(a[key]!==expected[key])throw new Error('Hub boot authorization binding mismatch')
 if(hubSyncDigest(a.target)!==hubSyncDigest(HubSyncTargetSchema.parse(expected.target))||a.contentDigest!==a.generationDigest||a.policyRevision<expected.minimumPolicyRevision)throw new Error('Hub boot target or policy mismatch')
 const issued=Date.parse(a.issuedAt),expires=Date.parse(a.expiresAt)
 if(!Number.isFinite(now)||issued>now+30000||expires<=now||expires<=issued||expires-issued>86400000)throw new Error('Hub boot authorization expired')
 const cap=Object.freeze({})as VerifiedHubBootAuthorization;leases.set(cap,freezeHubValue(a));return cap
}
export function hubBootAuthorizationData(cap:VerifiedHubBootAuthorization){const lease=leases.get(cap);if(!lease||Date.parse(lease.expiresAt)<=Date.now())throw new Error('Invalid or expired Hub boot authorization');return lease}
