import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadProofComposition, runSealedTargetProof } from '../src/hub-target-proof-runner.ts'
const roots:string[]=[]
function root(){const r=realpathSync(mkdtempSync(join(tmpdir(),'hub-proof-test-')));roots.push(r);mkdirSync(join(r,'skills'));writeFileSync(join(r,'package.json'),'{"private":true,"type":"module"}');writeFileSync(join(r,'root.yml'),'[]\n');return r}
afterEach(()=>{for(const r of roots.splice(0))rmSync(r,{force:true,recursive:true})})
it('uses the actual filesystem provider and rejects a missing real skill',async()=>{
 const r=root(),dir=join(r,'skills','proof-example');mkdirSync(dir);const path=join(dir,'SKILL.md');writeFileSync(path,'---\nname: proof-example\ndescription: Actual filesystem provider fixture\n---\nReal source body.\n')
 const c={root:r,entries:[],files:{},skillName:'proof-example',skillPath:path}
 expect((await loadProofComposition(c)).skillNames).toEqual(['proof-example'])
 rmSync(path);await expect(loadProofComposition(c)).rejects.toThrow('real skill discovery mismatch')
})
it('rejects execution outside the sealed Electron entry before any candidate code',async()=>{
 await expect(runSealedTargetProof('/missing','/missing','/missing')).rejects.toThrow('inside sealed Electron ASAR')
})
it('observes a real candidate through Cordis Loader and rejects a throwing entry',async()=>{
 const r=root(),dir=join(r,'node_modules','proof-candidate');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'package.json'),JSON.stringify({name:'proof-candidate',version:'1.0.0',type:'module',exports:'./index.js'}));const path=join(dir,'index.js');writeFileSync(path,'export default function(ctx) {}\n')
 const c={root:r,entries:[{id:'proof-candidate',name:'proof-candidate',config:{}}],files:{},packageName:'proof-candidate',hostEntry:path}
 expect((await loadProofComposition(c)).entryIds).toEqual(['proof-candidate'])
 const other=root(),otherDir=join(other,'node_modules','proof-candidate');mkdirSync(otherDir,{recursive:true});writeFileSync(join(otherDir,'package.json'),JSON.stringify({name:'proof-candidate',version:'1.0.0',type:'module',exports:'./index.js'}));writeFileSync(join(otherDir,'index.js'),'throw new Error("actual negative control")\n')
 await expect(loadProofComposition({...c,root:other,hostEntry:join(otherDir,'index.js')})).rejects.toThrow()
})
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { zipSync } from 'fflate'
import { materializeProofInput } from '../src/hub-target-proof-runner.ts'
import { hubCanonicalJson, hubSyncDigest } from '../src/hub-sync-verifier.ts'
import { fileManifestDigest } from '../src/hub-skill-archive.mjs'
it('verifies exact signed original ZIP before real filesystem loading and rejects byte corruption',async()=>{
 const r=root(),inputDir=root(),keys=generateKeyPairSync('ed25519'),now=Date.now(),tenantId=randomUUID(),releaseId=randomUUID()
 const content=Buffer.from('---\nname: signed-proof\ndescription: Signed original archive\n---\nOriginal content.\n'),bytes=Buffer.from(zipSync({'SKILL.md':content})),hash=createHash('sha256').update(bytes).digest('hex')
 writeFileSync(join(inputDir,'archive.zip'),bytes)
 const manifest={schemaVersion:'1.1',fileManifestDigest:fileManifestDigest({'SKILL.md':content}),tenantId,skillId:randomUUID(),releaseId,kind:'skill',installName:'signed-proof',version:'1.0.0',artifact:{sha256:hash,bytes:bytes.length,format:'zip'},compatibility:{sensteed:'*',testedTargets:[]},accessDeclaration:{containsScripts:false,networkHosts:[],fileAccess:'none'},issuedAt:new Date(now).toISOString()}
 const target={sensteedVersion:'1.0.0',harnessVersion:'1.0.0',os:'darwin',arch:'arm64',nodeVersion:'24.0.0',cordisVersion:'4.0.5',libc:null,nodeAbi:'137',hostCapabilities:[],hostBuildDigest:'a'.repeat(64)}
 const job={schemaVersion:'hub-target-proof-job-v1',kind:'skill',releaseId,target,runnerId:'test-runner',runId:randomUUID(),nonce:'b'.repeat(64),tenantId,artifactDigest:hash,manifestDigest:hubSyncDigest(manifest),lockGraphDigest:null,packSetDigest:null,targetDigest:hubSyncDigest(target),hostBuildDigest:target.hostBuildDigest,policyVersion:'host-loader-proof-v1',issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+1800000).toISOString(),proofExpiresAt:new Date(now+86400000).toISOString()}
 const signature={algorithm:'Ed25519',canonicalization:'RFC8785',keyId:'test',payloadDigest:hubSyncDigest(manifest),signature:sign(null,Buffer.from(hubCanonicalJson(manifest)),keys.privateKey).toString('base64')},trust={schemaVersion:1 as const,keys:{test:keys.publicKey.export({type:'spki',format:'der'}).toString('base64')},revokedKeyIds:[]}
 const input={job,envelope:{manifest,signature},artifacts:[{nodeId:null,sha256:hash,bytes:bytes.length,contentType:'application/zip',path:'archive.zip'}]}
 // materializer always creates its own immutable root metadata.
 rmSync(join(r,'package.json'));rmSync(join(r,'root.yml'))
 const result=materializeProofInput(input,trust,inputDir,r)
 expect((await loadProofComposition(result.composition)).skillNames).toEqual(['signed-proof'])
 writeFileSync(join(inputDir,'archive.zip'),Buffer.from('corrupted'))
 const bad=root();rmSync(join(bad,'package.json'));rmSync(join(bad,'root.yml'))
 expect(()=>materializeProofInput(input,trust,inputDir,bad)).toThrow('artifact digest')
 expect(()=>materializeProofInput({...input,envelope:{...input.envelope,manifest:{...manifest,installName:'other'}}},trust,inputDir,bad)).toThrow()
})
it('constructs actual private L0 auth, settings, tools, attachments and web services without logged-in credentials',async()=>{
 const r=root()
 const result=await loadProofComposition({root:r,entries:[],files:{}},['dofeAuth','dofeAccessSettings','credentials','settings','tools','systemPrompt','attachments','webServer','sensteedAudit'],true)
 expect(result.entryIds).toEqual([])
})
it('loads a candidate that injects real sealed services and refuses absent capabilities',async()=>{
 const r=root(),dir=join(r,'node_modules','proof-service-consumer');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'package.json'),JSON.stringify({name:'proof-service-consumer',version:'1.0.0',type:'module',exports:'./index.js'}));writeFileSync(join(dir,'index.js'),'export const inject=["dofeAuth","credentials","settings","tools","systemPrompt","attachments","webServer"]; export function apply(ctx) { if(ctx.dofeAuth.getStatus().status!=="idle") throw Error("proof must have no logged-in credential"); }\n')
 const c={root:r,entries:[{id:'real-service-consumer',name:'proof-service-consumer',config:{}}],files:{},packageName:'proof-service-consumer'}
 expect((await loadProofComposition(c,[],true)).entryIds).toEqual(['real-service-consumer'])
 await expect(loadProofComposition({root:root(),entries:[],files:{}},['nonexistentHostService'],true)).rejects.toThrow()
})
