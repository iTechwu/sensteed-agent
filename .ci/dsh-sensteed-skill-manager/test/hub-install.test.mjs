import assert from 'node:assert/strict'
import test from 'node:test'
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, writeFile, readdir, rename, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { HubCatalogClient, downloadHubArchive, boundedBody, callHubCatalog } from '../hub-client.js'
import { HubSkillInstaller } from '../hub-skill-installer.js'
import { parseSkillFrontmatter, __test } from '../index.js'
import { verifyRelease, planDigest } from '../hub-release-verifier.js'
import { unpackSkillArchive, fileManifestDigest, jcs, sha256, validateZipArchive } from '../skill-archive.js'
const team = randomUUID(), tenant = randomUUID(), skillId = randomUUID(), deviceId = randomUUID(), grantId = randomUUID()
const key = generateKeyPairSync('ed25519')
const trust = {schemaVersion:1,keys:{test:key.publicKey.export({format:'der',type:'spki'}).toString('base64')},revokedKeyIds:[]}
function artifact(version = '1.0.0',extra = {}) {
  const files = {'SKILL.md':Buffer.from(`---\nname: reviewed-skill\ndescription: Reviewed\n---\nVersion ${version}`),'零.txt':Buffer.from(''), ...extra}
  const archive = Buffer.from(zipSync(files,{level:6}))
  const manifest = {schemaVersion:'1.1',tenantId:tenant,skillId,releaseId:randomUUID(),kind:'skill',installName:'reviewed-skill',version,
    artifact:{sha256:sha256(archive),bytes:archive.length,format:'zip'},fileManifestDigest:fileManifestDigest(files),
    compatibility:{sensteed:'>=0.2.0',testedTargets:[]},accessDeclaration:{containsScripts:false,networkHosts:[],fileAccess:'none'},source:{kind:'upload'},issuedAt:new Date().toISOString()}
  return {archive,files,signed:seal(manifest)}
}
function seal(manifest) {
  const payload = Buffer.from(jcs(manifest))
  return {manifest,signature:{algorithm:'Ed25519',canonicalization:'RFC8785',keyId:'test',payloadDigest:sha256(payload),signature:sign(null,payload,key.privateKey).toString('base64')}}
}
async function fixture(t,options = {}) {
  const home = await realpath(await mkdtemp(join(tmpdir(),'hub-host-')))
  t.after(() => rm(home,{recursive:true,force:true}))
  let session = {operator:'sso-actor',tenantId:team,accessToken:'host-only-test-placeholder'}
  let release = artifact(), reportOffline = false, consumeUnknown = false, consumeSwitch = false
  let listener; const reports = [], calls = [], plans = new Map()
  const ctx = {dofeAuth:{getDatasourceSession:() => session,watchBinding:fn => {listener=fn;return () => {}}},skills:{
    snapshot:async () => {
      const path = join(home,'skills','reviewed-skill','SKILL.md')
      const text = await readFile(path,'utf8').catch(() => null)
      return {complete:true,skills:text ? [{name:'reviewed-skill',path,source:'user-dsh',provider:'filesystem'}] : []}
    },
    get:async () => ({name:'reviewed-skill',path:join(home,'skills','reviewed-skill','SKILL.md'),source:'user-dsh',provider:'filesystem',content:(await readFile(join(home,'skills','reviewed-skill','SKILL.md'),'utf8')).split('---\n').slice(2).join('---\n').trim()}),
  }}
  const json = data => Response.json({code:200,msg:'ok',data})
  const fetch = async (url,init) => {
    assert.equal(new URL(url).origin,'https://ai.hozonauto.com'); assert.equal(init.redirect,'error'); assert.equal(init.credentials,'omit')
    assert.equal(init.headers.Authorization,`Bearer ${session.accessToken}`)
    const path = new URL(url).pathname.replace('/plugins/api/skillhub/v1',''), body = init.body ? JSON.parse(init.body) : undefined
    calls.push({path,body})
    if (path === '/me') return json({tenantId:tenant,permissions:['hub.skill.install'],workspace:{ssoTeam:{id:team,name:'企业工作空间'}}})
    if (path === '/devices/bind') return json({deviceId,ownerRef:'hub-actor',lastSeenAt:null})
    if (path === `/skills/${skillId}`) return json({channels:[{name:'stable',releaseId:release.signed.manifest.releaseId,version:release.signed.manifest.version}]})
    if (path.endsWith('/manifest')) return json(release.signed)
    if (path.endsWith('/download-grants')) return json({grantId,expiresAt:new Date(Date.now()+60000).toISOString(),downloadUrl:`/plugins/api/skillhub/v1/downloads/${grantId}/content`})
    if (path === `/downloads/${grantId}/content`) return new Response(release.archive,{headers:{'content-type':'application/zip','content-length':String(release.archive.length)}})
    if (path === '/skills/install-plans') {
      const manifest = release.signed.manifest
      const value = {tenantId:tenant,actorRef:'hub-actor',deviceId,policyRevision:1,planId:randomUUID(),action:body.action,skillId,
        releaseId:body.releaseId,version:manifest.version,artifactDigest:manifest.artifact.sha256,installName:manifest.installName,target:body.target,
        requiresReload:true,expiresAt:new Date(Date.now()+60000).toISOString(),observedStateDigest:body.observedStateDigest}
      value.planDigest = planDigest(value); plans.set(value.planId,value); return json(value)
    }
    if (path.endsWith('/authorize')) return json({executionGrant:randomUUID(),expiresAt:new Date(Date.now()+60000).toISOString()})
    if (path.endsWith('/consume')) {
      const before = await readFile(join(home,'skills','reviewed-skill','SKILL.md'),'utf8').catch(() => null)
      const plan = plans.get(path.split('/').at(-2))
      if (plan.action === 'install') assert.equal(before,null)
      else assert.equal(typeof before,'string')
      if (plan.action === 'update') assert.equal(before.includes(`Version ${plan.version}`),false)
      if (consumeUnknown) throw Error('connection ended after server consumption')
      if (consumeSwitch) { session = {...session,operator:'different-actor'};listener?.() }
      return json({ack:true})
    }
    if (path === '/skills/installation-reports') {
      if (reportOffline) throw Error('offline')
      reports.push(structuredClone(body)); return json({ack:true})
    }
    throw Error(`unexpected route ${path}`)
  }
  const hub = new HubCatalogClient(ctx,{fetch})
  const installer = new HubSkillInstaller(ctx,hub,{home,trust:() => trust,hostVersion:'0.2.1-alpha.3-beta.202610150942',bundledRoots:[],parseSkill:parseSkillFrontmatter,discoveryAttempts:1,...options})
  return {home,ctx,installer,hub,calls,reports,get release(){return release},set release(value){release=value},set offline(value){reportOffline=value},set unknown(value){consumeUnknown=value},set switchOnConsume(value){consumeSwitch=value},
    switchActor(){session={...session,operator:'different-actor'};listener?.()},restoreActor(){session={...session,operator:'sso-actor'};listener?.()}}
}

test('matches the Hub golden ZIP and UTF-16/JCS file order including zero files and non-BMP paths',async () => {
  const bytes = await readFile(new URL('./fixtures/skill-zip-v1/skill.zip',import.meta.url)), expected=JSON.parse(await readFile(new URL('./fixtures/skill-zip-v1/expected.json',import.meta.url)))
  assert.equal(sha256(bytes),expected.artifact.sha256); assert.equal(fileManifestDigest(unpackSkillArchive(bytes)),expected.fileManifestDigest)
  assert.equal(jcs({'\uE000':1,'😀':2,a:'中'}),'{"a":"中","😀":2,"":1}')
  const extra=artifact('1.0.0',{'😀.txt':Buffer.from('中'),'\uE000.txt':Buffer.alloc(0)})
  assert.equal(fileManifestDigest(unpackSkillArchive(extra.archive)),extra.signed.manifest.fileManifestDigest)
})

test('verifies real Ed25519 signatures; rejects unknown/revoked roots, schema drift and incompatible hosts',() => {
  const {signed} = artifact()
  assert.equal(verifyRelease(signed,trust,'0.2.1').installName,'reviewed-skill')
  for (const candidate of [{...trust,keys:{}},{...trust,revokedKeyIds:['test']}]) assert.throws(() => verifyRelease(signed,candidate,'0.2.1'),{code:'HUB_UNTRUSTED_KEY'})
  assert.throws(() => verifyRelease({...signed,manifest:{...signed.manifest,version:'9.0.0'}},trust),{code:'HUB_SIGNATURE_INVALID'})
  assert.throws(() => verifyRelease(seal({...signed.manifest,installName:'bad--name'}),trust),{code:'HUB_INVALID_RESPONSE'})
  assert.throws(() => verifyRelease(signed,trust,'0.1.0'),{code:'HUB_INCOMPATIBLE_HOST'})
  assert.throws(() => verifyRelease({...signed,manifest:{...signed.manifest,unknown:true}},trust),{code:'HUB_INVALID_RESPONSE'})
})

test('rejects CRC corruption, central/local mismatch, special devices, excessive path depth and portable conflicts',() => {
  const {archive} = artifact()
  const damaged = Buffer.from(archive); damaged[40] ^= 1
  assert.throws(() => unpackSkillArchive(damaged),{code:'HUB_UNSAFE_ARCHIVE'})
  const special = Buffer.from(archive), central=special.indexOf(Buffer.from([0x50,0x4b,0x01,0x02])); special.writeUInt32LE((0o020600 << 16) >>> 0,central+38)
  assert.throws(() => validateZipArchive(special),{code:'HUB_UNSAFE_ARCHIVE'})
  for (const paths of [{['a/'.repeat(13)+'x.txt']:Buffer.from('x')},{'A.txt':Buffer.from('x'),'a.txt':Buffer.from('x')},{'a.txt':Buffer.from('x'),'a.txt/x':Buffer.from('x')},
    {'A/x.txt':Buffer.from('x'),'a/y.txt':Buffer.from('x')},{'é/x.txt':Buffer.from('x'),'e\u0301/y.txt':Buffer.from('x')}]) {
    assert.throws(() => unpackSkillArchive(artifact('1.0.0',paths).archive),{code:'HUB_UNSAFE_ARCHIVE'})
  }
})

test('pins grant content exactly and bounds streamed JSON and binary responses',async () => {
  for (const downloadUrl of ['https://evil.invalid/x',`/plugins/api/skillhub/v1/downloads/${grantId}/content?x=1`,`/plugins/api/skillhub/v1/downloads/${randomUUID()}/content`,`/plugins/api/skillhub/v1/downloads/${grantId}/%63ontent`]) {
    await assert.rejects(downloadHubArchive({}, {grantId,expiresAt:new Date(Date.now()+60000).toISOString(),downloadUrl},{session:{accessToken:'x'},fetch:() => {throw Error('must never fetch')}}),{code:'HUB_INVALID_RESPONSE'})
  }
  await assert.rejects(boundedBody(new Response('123456'),5),{code:'HUB_RESPONSE_TOO_LARGE'})
  await assert.rejects(callHubCatalog({},'/skillhub/v1/skills/../../me',{session:{accessToken:'x'}}),{code:'HUB_INVALID_REQUEST'})
})

test('preview never mutates skills; explicit confirmation consumes first, writes and reports actual discovery',async t => {
  const f=await fixture(t), intent=await f.installer.preview({action:'install',skillId})
  assert.deepEqual(await readdir(join(f.home,'skills')),[])
  assert.equal(f.calls.some(call => call.path.endsWith('/consume')),false)
  assert.equal(JSON.stringify(intent).includes('host-only-test-placeholder'),false);assert.equal(JSON.stringify(intent).includes(f.home),false)
  const result=await f.installer.execute({intentId:intent.intentId})
  assert.equal(result.status,'DONE');assert.equal(result.state,'DISCOVERED');assert.equal(result.receiptPending,false)
  assert.deepEqual(f.reports.map(row=>row.state),['WRITTEN','DISCOVERED'])
  assert.deepEqual(await readdir(join(f.home,'skills','reviewed-skill')),['SKILL.md','零.txt'])
  const journal=JSON.stringify(await f.installer.store.operations())
  assert.equal(journal.includes('host-only-test-placeholder'),false); assert.equal(journal.includes('executionGrant'),false)
  await assert.rejects(f.installer.execute({intentId:intent.intentId}),{code:'HUB_INTENT_EXPIRED'})
})

test('updates only unchanged Hub content and uninstalls through the same consumed-plan state machine',async t => {
  const f=await fixture(t)
  await f.installer.execute({intentId:(await f.installer.preview({action:'install',skillId})).intentId})
  f.release=artifact('2.0.0')
  const intent=await f.installer.preview({action:'update',skillId})
  const updated=await f.installer.execute({intentId:intent.intentId})
  assert.equal(updated.state,'DISCOVERED')
  const removal=await f.installer.preview({action:'uninstall',skillId})
  const removed=await f.installer.execute({intentId:removal.intentId})
  assert.equal(removed.state,'REMOVED'); assert.equal(f.reports.at(-1).installedVersion,null)
  assert.deepEqual(await readdir(join(f.home,'skills')),[])
  assert.equal((await f.installer.receipts()).length,0)
})

test('rejects local changes, bundled shadows, foreign ownership and stale confirmation without consuming',async t => {
  const f=await fixture(t)
  await f.installer.execute({intentId:(await f.installer.preview({action:'install',skillId})).intentId})
  const before=f.calls.filter(call=>call.path.endsWith('/consume')).length
  const intent=await f.installer.preview({action:'uninstall',skillId})
  await writeFile(join(f.home,'skills','reviewed-skill','notes.txt'),'user content')
  await assert.rejects(f.installer.execute({intentId:intent.intentId}),{code:'HUB_LOCAL_MODIFIED'})
  assert.equal(f.calls.filter(call=>call.path.endsWith('/consume')).length,before)
  f.switchActor()
  await assert.rejects(f.installer.preview({action:'update',skillId}),{code:'HUB_LOCAL_CONFLICT'})
  const root=join(f.home,'bundled');await mkdir(join(root,'reviewed-skill'),{recursive:true});f.installer.options.bundledRoots=[root]
  await assert.rejects(f.installer.preview({action:'install',skillId}),{code:'HUB_LOCAL_CONFLICT'})
  assert.equal(await readFile(join(f.home,'skills','reviewed-skill','notes.txt'),'utf8'),'user content')
})

test('consume uncertainty and post-ack identity switches never start target mutation',async t => {
  for (const mode of ['unknown','switchOnConsume']) {
    const f=await fixture(t),intent=await f.installer.preview({action:'install',skillId});f[mode]=true
    const result=await f.installer.execute({intentId:intent.intentId})
    assert.equal(result.status,mode === 'unknown' ? 'CONSUME_UNKNOWN' : 'NEEDS_ATTENTION')
    assert.deepEqual(await readdir(join(f.home,'skills')),[])
    const restarted=new HubSkillInstaller(f.ctx,f.hub,f.installer.options);await restarted.initialize()
    assert.deepEqual(await readdir(join(f.home,'skills')),[])
  }
})

test('switching actor after durable CONSUMING aborts before sending consume',async t => {
  const f=await fixture(t)
  f.installer.options.afterPhase=async phase=>{if(phase==='CONSUMING')f.switchActor()}
  const result=await f.installer.execute({intentId:(await f.installer.preview({action:'install',skillId})).intentId})
  assert.equal(result.status,'ABORTED')
  assert.equal(f.calls.some(call=>call.path.endsWith('/consume')),false)
  assert.deepEqual(await readdir(join(f.home,'skills')),[])
  assert.equal((await f.installer.store.operations())[0].phase,'ABORTED')
})

test('stale registry bodies cannot claim discovery and offline receipts replay byte-identically only under the original actor',async t => {
  const f=await fixture(t); f.ctx.skills.get=async()=>({content:'stale'});f.offline=true
  const result=await f.installer.execute({intentId:(await f.installer.preview({action:'install',skillId})).intentId})
  assert.equal(result.state,'DISCOVERY_FAILED');assert.equal(result.receiptPending,true)
  const operation=(await f.installer.store.operations())[0], original=JSON.stringify(operation.events)
  operation.retryAt=0;await f.installer.store.save(operation)
  f.offline=false;f.switchActor();await f.installer.status();assert.equal(f.reports.length,0)
  f.restoreActor();await f.installer.status()
  assert.equal(JSON.stringify(f.reports),original)
})

test('recovery restores a backed-up old tree and reconstructs receipts after a published target',async t => {
  for (const phase of ['SWAPPING','PUBLISHED']) {
    const f=await fixture(t)
    await f.installer.execute({intentId:(await f.installer.preview({action:'install',skillId})).intentId})
    const operation=(await f.installer.store.operations())[0]
    operation.phase=phase;operation.events=[];operation.acked=[]
    if(phase === 'SWAPPING') {
      operation.beforeTreeDigest=operation.afterTreeDigest
      await rename(join(f.home,'skills','reviewed-skill'),join(f.home,'.sensteed-hub','backups',operation.operationId))
    } else await f.installer.store.removeReceipt('reviewed-skill')
    await f.installer.store.save(operation)
    const restarted=new HubSkillInstaller(f.ctx,f.hub,f.installer.options);await restarted.initialize()
    assert.equal((await readFile(join(f.home,'skills','reviewed-skill','SKILL.md'),'utf8')).includes('Version 1.0.0'),true)
    const recovered=(await restarted.store.operations())[0]
    assert.equal(recovered.phase,phase === 'SWAPPING' ? 'NEEDS_ATTENTION' : 'DONE')
    if (phase === 'PUBLISHED') {assert.equal((await restarted.store.receipt('reviewed-skill')).operationId,operation.operationId);assert.deepEqual(recovered.events[0],operation.commitEvent)}
  }
})

test('serializes separate Host instances on one physical target without tenant-shaped lock keys',async t => {
  const f=await fixture(t), second=new HubSkillInstaller(f.ctx,f.hub,f.installer.options)
  const intents=await Promise.all([f.installer.preview({action:'install',skillId}),second.preview({action:'install',skillId})])
  const outcomes=await Promise.allSettled([f.installer.execute({intentId:intents[0].intentId}),second.execute({intentId:intents[1].intentId})])
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length,1)
  assert.equal(f.calls.filter(call => call.path.endsWith('/consume')).length,1)
  assert.equal((await f.installer.store.operations())[0].phase,'DONE')
})

test('fails before consumption if the durable journal cannot be written and refuses symlink targets',async t => {
  const f=await fixture(t),intent=await f.installer.preview({action:'install',skillId})
  const original=f.installer.store.save.bind(f.installer.store)
  f.installer.store.save=async()=>{throw Object.assign(Error('disk full'),{code:'ENOSPC'})}
  await assert.rejects(f.installer.execute({intentId:intent.intentId}))
  assert.equal(f.calls.some(call=>call.path.endsWith('/consume')),false)
  assert.deepEqual(await readdir(join(f.home,'skills')),[])
  f.installer.store.save=original
  const {symlink}=await import('node:fs/promises')
  const external=join(f.home,'external');await mkdir(external)
  await symlink(external,join(f.home,'skills','reviewed-skill'),process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(f.installer.preview({action:'install',skillId}),{code:'HUB_LOCAL_CONFLICT'})
})

test('rejects a user-rewritten ownership receipt even when its modified tree digests match',async t => {
  const f=await fixture(t)
  await f.installer.execute({intentId:(await f.installer.preview({action:'install',skillId})).intentId})
  const receipt=await f.installer.store.receipt('reviewed-skill')
  receipt.version='7.0.0';await f.installer.store.saveReceipt('reviewed-skill',receipt)
  await assert.rejects(f.installer.preview({action:'uninstall',skillId}),{code:'HUB_LOCAL_MODIFIED'})
})

test('journal boundary faults preserve zero pre-consume changes and recover published files without fabricating discovery',async t => {
  for(const phase of ['PREPARED','CONSUMING','CONSUMED','SWAPPING','BACKED_UP','PUBLISHED']) {
    let failed=false
    const f=await fixture(t,{afterPhase:async value=>{if(value===phase && !failed){failed=true;throw Error('simulated interruption')}}})
    const intent=await f.installer.preview({action:'install',skillId}),result=await f.installer.execute({intentId:intent.intentId})
    if(phase==='PUBLISHED'){
      assert.equal(result.status,'DONE');assert.equal(result.state,'DISCOVERY_FAILED')
      assert.equal((await f.installer.store.operations())[0].events[0].state,'WRITTEN')
    }else{
      assert.deepEqual(await readdir(join(f.home,'skills')),[])
      assert.equal(result.status,['PREPARED','CONSUMING'].includes(phase)?'ABORTED':'NEEDS_ATTENTION')
    }
    const restarted=new HubSkillInstaller(f.ctx,f.hub,{...f.installer.options,afterPhase:undefined});await restarted.initialize()
    assert.equal((await restarted.store.operations())[0].phase,result.status)
  }
})
