import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { generationPlanData, hubGenerationContentDigest, verifyHubGenerationPlan, type HubGenerationPlan, type HubGenerationPlanExpected } from '../src/hub-generation-verifier.ts'
import { hubCanonicalJson, hubSyncDigest, type HubReleaseTrust } from '../src/hub-sync-verifier.ts'
import { HubGenerationClient, hubGenerationConsumptionData } from '../src/hub-generation-client.ts'
import {verifyHubGenerationDownloads} from '../src/hub-generation-downloads.ts'
function fixture() {
  const now = Date.now(), keys = generateKeyPairSync('ed25519')
  const trust: HubReleaseTrust = { schemaVersion: 1, keys: { test: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }, revokedKeyIds: [] }
  const item: HubGenerationPlan['items'][number] = { kind: 'skill', itemId: randomUUID(), action: 'install', enabled: true, releaseId: randomUUID(), artifactDigest: '1'.repeat(64), manifestDigest: '2'.repeat(64), channelRevision: 1, lockGraphDigest: null, packSetDigest: null }
  const expected: HubGenerationPlanExpected = { origin: 'https://ai.hozonauto.com/plugins/api', tenantId: randomUUID(), actorRef: 'user@example.com', deviceId: randomUUID(), profileId: randomUUID(), channel: 'stable',
    snapshotId: randomUUID(), snapshotDigest: '3'.repeat(64), observedStateDigest: '4'.repeat(64), expectedActiveGenerationDigest: null, minimumPolicyRevision: 1,
    target: { sensteedVersion: '1.0.0', harnessVersion: '1.0.0', os: 'darwin', arch: 'arm64', nodeVersion: '22.0.0', cordisVersion: '4.0.5', libc: null, nodeAbi: '127', hostCapabilities: [], hostBuildDigest: 'b'.repeat(64) },
    requested: [{ kind: item.kind, itemId: item.itemId, action: item.action, enabled: item.enabled }] }
  const { requested: _requested, minimumPolicyRevision: _revision, ...binding } = expected
  const plan: HubGenerationPlan = { ...binding, schemaVersion: 'hub-generation-plan-v1', planId: randomUUID(), policyRevision: 1, catalogDigest: '5'.repeat(64), proposedGenerationDigest: hubGenerationContentDigest([item]), items: [item], closureDigest: '6'.repeat(64), totalBytes: 20, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 300000).toISOString(), planDigest: '0'.repeat(64) }
  function signed(value = plan) {
    const { planDigest: _old, ...payload } = value
    const final = { ...payload, planDigest: hubSyncDigest(payload) }
    return { plan: final, signature: { algorithm: 'Ed25519', canonicalization: 'RFC8785', keyId: 'test', payloadDigest: hubSyncDigest(final), signature: sign(null, Buffer.from(hubCanonicalJson(final)), keys.privateKey).toString('base64') } }
  }
  return { now, trust, expected, plan, signed }
}


it('requires complete signed manifest and exact aggregate locator coverage',async()=>{
 const f=fixture(), keys=generateKeyPairSync('ed25519'),item=f.plan.items[0]!
 const manifest={schemaVersion:'1.1',fileManifestDigest:'a'.repeat(64),tenantId:f.plan.tenantId,skillId:item.itemId,releaseId:item.releaseId,kind:'skill',installName:'example',version:'1.0.0',artifact:{sha256:item.artifactDigest,bytes:20,format:'zip'},compatibility:{sensteed:'*',testedTargets:[]},accessDeclaration:{containsScripts:false,networkHosts:[],fileAccess:'none'},issuedAt:new Date().toISOString()}
 const signManifest={manifest,signature:{algorithm:'Ed25519',canonicalization:'RFC8785',keyId:'artifact',payloadDigest:hubSyncDigest(manifest),signature:sign(null,Buffer.from(hubCanonicalJson(manifest)),keys.privateKey).toString('base64')}}
 const itemBound={...item,manifestDigest:hubSyncDigest(manifest)},plan={...f.plan,items:[itemBound],proposedGenerationDigest:hubGenerationContentDigest([itemBound])},cap=verifyHubGenerationPlan(f.signed(plan),f.trust,f.expected)
 const operationId=randomUUID(),client=new HubGenerationClient({assertCurrent(){},generationRequest:async()=>({planId:plan.planId,operationId,state:'consumed',authorized:true,executionGeneration:'1',executionExpiresAt:new Date(Date.now()+1800000).toISOString(),proposedGenerationDigest:plan.proposedGenerationDigest})} as never,{tenantId:plan.tenantId,actorRef:plan.actorRef} as never)
 const proof=await client.consumption(cap,operationId),trust={schemaVersion:1 as const,keys:{artifact:keys.publicKey.export({type:'spki',format:'der'}).toString('base64')},revokedKeyIds:[]}
 const downloads={manifests:[{kind:'skill',itemId:item.itemId,envelope:signManifest}],descriptors:[{downloadId:randomUUID(),kind:'skill',itemId:item.itemId,nodeId:null,artifactDigest:item.artifactDigest,bytes:20,contentType:'application/zip',role:'primary'}]}
 expect(verifyHubGenerationDownloads(downloads,generationPlanData(cap),proof,trust).descriptors).toHaveLength(1)
 expect(()=>verifyHubGenerationDownloads({...downloads,descriptors:[]},generationPlanData(cap),proof,trust)).toThrow('mismatch')
 expect(()=>verifyHubGenerationDownloads({...downloads,descriptors:[...downloads.descriptors,...downloads.descriptors]},generationPlanData(cap),proof,trust)).toThrow('mismatch')
 signManifest.manifest.artifact.bytes++
 expect(()=>verifyHubGenerationDownloads(downloads,generationPlanData(cap),proof,trust)).toThrow('digest')
})
