import { randomUUID, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, readFile, realpath, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import Skills from '@deepseek-ai/dsh-skill'
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import { expect, it } from 'vitest'
import { zipSync } from 'fflate'
const packageRoot=dirname(createRequire(import.meta.url).resolve('@dofe/dsh-sensteed-skill-manager/package.json'))
const skillManager=await import(pathToFileURL(join(packageRoot,'index.js')).href)
const {jcs,sha256,fileManifestDigest}=await import(pathToFileURL(join(packageRoot,'skill-archive.js')).href)
const {planDigest}=await import(pathToFileURL(join(packageRoot,'hub-release-verifier.js')).href)

const ROUTE = '/api/desktop/sensteed/skills'
function response() {
  const state: {status?:number; headers?:Record<string,string> | undefined; body?:string | undefined} = {}
  const value = Object.assign(new EventEmitter(),{writableEnded:false,
    writeHead(status:number,headers?:Record<string,string>){state.status=status;state.headers=headers},
    end(text?:string){state.body=text;value.writableEnded=true},
  })
  return {value,state}
}
function request(path:string,body?:unknown,cookie?:string) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  return Object.assign(req,{url:path,method:body === undefined ? 'GET' : 'POST',headers:{host:'127.0.0.1:3112',origin:'http://127.0.0.1:3112',...(cookie ? {cookie} : {}),'content-type':'application/json'},socket:{remoteAddress:'127.0.0.1'}})
}

it('requires real Connection owner authentication and observes the installed ZIP through the real filesystem watcher and registry',async () => {
  const home=await realpath(await mkdtemp(join(tmpdir(),'sensteed-hub-discovery-'))),ctx=new Context()
  try {
    const routes:any[]=[]
    ctx.provide('webServer',{host:'127.0.0.1',protocol:'http:',port:3112,register:(route:any)=>{routes.push(route);return()=>{}},registerUpgrade:()=>()=>{},tapIndex:()=>()=>{}} as never)
    let credential:any
    ctx.provide('credentials',{readRecord:async()=>credential,modifyRecord:async(_key:any,mutate:any)=>credential=await mutate(credential)} as never)
    await ctx.plugin(Connection)
    await ctx.plugin(Skills)
    await ctx.plugin(SkillFilesystem,{dshHome:home,agentsHome:join(home,'agents'),watch:true})
    const tenantId=randomUUID(),teamId=randomUUID(),skillId=randomUUID(),releaseId=randomUUID(),deviceId=randomUUID(),grantId=randomUUID()
    ctx.provide('dofeAuth',{getDatasourceSession:()=>({operator:'actual-host-fixture',accessToken:'host-test-placeholder',tenantId:teamId})} as never)
    const {publicKey,privateKey}=generateKeyPairSync('ed25519')
    const files={'SKILL.md':Buffer.from('---\nname: enterprise-review\ndescription: Enterprise test\n---\nActual watched content\n')}
    const archive=Buffer.from(zipSync(files))
    const manifest={schemaVersion:'1.1',tenantId,skillId,releaseId,kind:'skill',installName:'enterprise-review',version:'1.0.0',
      artifact:{sha256:sha256(archive),bytes:archive.length,format:'zip'},fileManifestDigest:fileManifestDigest(files),compatibility:{sensteed:'>=0.2.0',testedTargets:[]},
      accessDeclaration:{containsScripts:false,networkHosts:[],fileAccess:'none'},source:{kind:'upload'},issuedAt:new Date().toISOString()}
    const payload=Buffer.from(jcs(manifest)),signed={manifest,signature:{algorithm:'Ed25519',canonicalization:'RFC8785',keyId:'fixture',payloadDigest:sha256(payload),signature:sign(null,payload,privateKey).toString('base64')}}
    let calls=0;const reports:any[]=[]
    const json=(data:unknown)=>Response.json({code:200,data})
    const fetcher=async(url:string,init:any)=>{
      calls++
      const path=new URL(url).pathname.replace('/plugins/api/skillhub/v1',''),body=init.body?JSON.parse(init.body):undefined
      if(path==='/me')return json({tenantId,permissions:['hub.skill.install'],workspace:{ssoTeam:{id:teamId,name:'Test team'}}})
      if(path==='/devices/bind')return json({deviceId,ownerRef:'hub-fixture-actor',lastSeenAt:null})
      if(path===`/skills/${skillId}`)return json({channels:[{name:'stable',releaseId,version:'1.0.0'}]})
      if(path.endsWith('/manifest'))return json(signed)
      if(path==='/skills/install-plans'){
        const plan={...body,tenantId,actorRef:'hub-fixture-actor',planId:randomUUID(),skillId,version:'1.0.0',artifactDigest:manifest.artifact.sha256,installName:'enterprise-review',requiresReload:true,policyRevision:1,expiresAt:new Date(Date.now()+60000).toISOString()}
        return json({...plan,planDigest:planDigest(plan)})
      }
      if(path.endsWith('/download-grants'))return json({grantId,expiresAt:new Date(Date.now()+60000).toISOString(),downloadUrl:`/plugins/api/skillhub/v1/downloads/${grantId}/content`})
      if(path.endsWith('/content'))return new Response(archive,{headers:{'content-type':'application/zip'}})
      if(path.endsWith('/authorize'))return json({executionGrant:randomUUID(),expiresAt:new Date(Date.now()+60000).toISOString()})
      if(path.endsWith('/consume')){expect(await ctx.skills.snapshot({})).toMatchObject({complete:true,skills:[]});return json({ack:true})}
      if(path==='/skills/installation-reports'){reports.push(body);return json({ack:true})}
      throw Error('unexpected Hub test route')
    }
    await ctx.plugin(skillManager,{fetch:fetcher,hubInstallOptions:{home,bundledRoots:[],discoveryAttempts:30,discoveryDelay:100,
      trust:()=>({schemaVersion:1,keys:{fixture:publicKey.export({format:'der',type:'spki'}).toString('base64')},revokedKeyIds:[]})}})
    const route=routes.find(row=>row.path===ROUTE)
    const rejected=response();await route.handler(request(`${ROUTE}/hub/skills/preview`,{action:'install',skillId}),rejected.value)
    expect(rejected.state.status).toBe(401);expect(calls).toBe(0)
    expect((await readdir(home)).includes('.sensteed-hub')).toBe(false)
    const connection=ctx.connection
    const url=new URL(connection.authenticatedUrl('http://127.0.0.1:3112'))
    const exchange=response();connection.authorizeIndex(request(`${url.pathname}${url.search}`) as never,exchange.value as never)
    const cookie=exchange.state.headers?.['set-cookie']?.split(';')[0]
    expect(cookie).toBeTruthy()
    const unavailable=response();await route.handler(request(`${ROUTE}/hub/skills/preview`,{action:'install',skillId},cookie),unavailable.value)
    expect(unavailable.state.status).toBe(400)
    expect(JSON.parse(unavailable.state.body!)).toMatchObject({code:'HUB_INCOMPATIBLE_HOST'})
    expect(await ctx.skills.snapshot({})).toMatchObject({complete:true,skills:[]})
    // Exercise the production root-provided service, including late availability, without a version override.
    ctx.provide('desktopRuntime',{updates:{currentVersion:'0.2.1-alpha.3-beta.202610150942'}} as never)
    const preview=response();await route.handler(request(`${ROUTE}/hub/skills/preview`,{action:'install',skillId},cookie),preview.value)
    expect(preview.state.status).toBe(200)
    const intent=JSON.parse(preview.state.body!)
    const executed=response();await route.handler(request(`${ROUTE}/hub/skills/execute`,{intentId:intent.intentId},cookie),executed.value)
    expect(executed.state.status).toBe(200)
    expect(JSON.parse(executed.state.body!)).toMatchObject({status:'DONE',state:'DISCOVERED',receiptPending:false})
    expect(reports.map(row=>row.state)).toEqual(['WRITTEN','DISCOVERED'])
    const snapshot=await ctx.skills.snapshot({}),skill=await ctx.skills.get('enterprise-review')
    expect(snapshot.complete).toBe(true)
    expect(snapshot.skills).toContainEqual(expect.objectContaining({name:'enterprise-review',source:'user-dsh',path:join(home,'skills','enterprise-review','SKILL.md')}))
    expect(skill?.content).toBe('Actual watched content')
    expect(await readFile(join(home,'skills','enterprise-review','SKILL.md'),'utf8')).toBe(files['SKILL.md'].toString())
    expect(JSON.stringify(intent)).not.toContain(home);expect(JSON.stringify(intent)).not.toContain('host-test-placeholder')
  } finally {await ctx.fiber.dispose();await rm(home,{recursive:true,force:true})}
},15000)
