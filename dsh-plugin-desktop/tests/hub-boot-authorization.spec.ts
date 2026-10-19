import{expect,it}from'vitest'
import{generateKeyPairSync,randomUUID,sign}from'node:crypto'
import{verifyHubBootAuthorization,hubBootAuthorizationData}from'../src/hub-boot-authorization.ts'
import{hubCanonicalJson,hubSyncDigest}from'../src/hub-sync-verifier.ts'
it('accepts only a signed exact base/identity/content lease and rejects expiry',()=>{
 const now=Date.now(),keys=generateKeyPairSync('ed25519'),authorization={schemaVersion:'hub-generation-boot-v1',origin:'https://ai.hozonauto.com/plugins/api' as const,tenantId:randomUUID(),actorRef:'user:example',deviceId:randomUUID(),profileId:randomUUID(),target:{sensteedVersion:'1.0.0',harnessVersion:'1.0.0',os:'darwin' as const,arch:'arm64' as const,nodeVersion:'22.0.0',cordisVersion:'4.0.5',libc:null,nodeAbi:'127',hostCapabilities:[],hostBuildDigest:'b'.repeat(64)},generationDigest:'a'.repeat(64),contentDigest:'a'.repeat(64),policyRevision:1,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+86400000).toISOString()}
 const envelope={authorization,signature:{algorithm:'Ed25519',canonicalization:'RFC8785',keyId:'test',payloadDigest:hubSyncDigest(authorization),signature:sign(null,Buffer.from(hubCanonicalJson(authorization)),keys.privateKey).toString('base64')}},trust={schemaVersion:1 as const,keys:{test:keys.publicKey.export({type:'spki',format:'der'}).toString('base64')},revokedKeyIds:[]},expected={...authorization,minimumPolicyRevision:1}
 expect(hubBootAuthorizationData(verifyHubBootAuthorization(envelope,trust,expected)).generationDigest).toBe(authorization.generationDigest)
 expect(()=>verifyHubBootAuthorization(envelope,trust,{...expected,deviceId:randomUUID()})).toThrow('binding')
 expect(()=>verifyHubBootAuthorization(envelope,trust,{...expected,target:{...expected.target,hostBuildDigest:'c'.repeat(64)}})).toThrow('target')
 expect(()=>verifyHubBootAuthorization(envelope,trust,expected,now+86400000)).toThrow('expired')
 expect(()=>hubBootAuthorizationData({}as never)).toThrow('Invalid')
})
