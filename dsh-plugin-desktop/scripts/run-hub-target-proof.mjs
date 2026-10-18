#!/usr/bin/env node
/** CI boundary: prefetch private originals, execute only the sealed entry offline, sign outside Agent. */
import { createHash, createPrivateKey, sign } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
const fail=message=>{throw Error(`Hub proof CI: ${message}`)}
const canonical=value=>JSON.stringify(value===null||typeof value!=='object'?value:Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])))
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const args=process.argv.slice(2),opts={}
for(let i=0;i<args.length;i+=2){if(!/^--[a-z-]+$/u.test(args[i]??'')||!args[i+1]||opts[args[i]])fail('invalid CLI');opts[args[i]]=args[i+1]}
for(const name of ['--run-id','--session-token-file','--resources','--electron','--private-key','--output'])if(!opts[name])fail(`missing ${name}`)
if(!/^[a-f0-9-]{36}$/u.test(opts['--run-id']))fail('invalid run ID')
const allowed=new Set(['--run-id','--session-token-file','--resources','--electron','--private-key','--output']);if(Object.keys(opts).some(k=>!allowed.has(k)))fail('unsupported option')
const origin='https://ai.hozonauto.com/plugins/api',resources=realpathSync(opts['--resources']),electron=realpathSync(opts['--electron']),keyPath=realpathSync(opts['--private-key'])
if((process.platform==='darwin'?dirname(dirname(electron))!==dirname(resources):dirname(electron)!==dirname(resources)))fail('Electron must belong to the same packaged application')
if(!existsSync(join(resources,'app.asar'))||!lstatSync(electron).isFile())fail('sealed package missing')
const tokenPath=realpathSync(opts['--session-token-file'])
if([keyPath,tokenPath].some(p=>p.startsWith(resources+sep)||p.startsWith(dirname(electron)+sep))||['/System/','/usr/','/bin/','/sbin/','/dev/','/private/etc/'].some(p=>keyPath.startsWith(p)))fail('signing key must remain outside sandbox read roots')
const scratch=realpathSync(mkdtempSync(join(tmpdir(),'hub-proof-ci-')))
const token=readFileSync(opts['--session-token-file'],'utf8').trim()
if(!token||/[\r\n]/u.test(token))fail('invalid SSO token file')
const request=async(path,body)=>{const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(120000)});if(!response.ok)fail('admin artifact API denied request');return response}
try{
 const run=opts['--run-id'],response=await request(`/skillhub/v1/target-proofs/runs/${run}/inputs`,{}),payload=await response.json(),input=payload.data
 if(input?.job?.runId!==run||!Array.isArray(input.artifacts)||!input.artifacts.length||input.artifacts.length>500)fail('invalid proof inputs')
 let total=0
 for(let i=0;i<input.artifacts.length;i++){
  const a=input.artifacts[i];if(!Number.isSafeInteger(a.bytes)||a.bytes<=0||a.bytes>256*1024*1024||(total+=a.bytes)>1024*1024*1024||!/^[a-f0-9]{64}$/u.test(a.sha256))fail('invalid artifact budget')
  const response=await request(`/skillhub/v1/target-proofs/runs/${run}/content`,{nodeId:a.nodeId})
  const chunks=[];let length=0;for await(const part of response.body){length+=part.length;if(length>a.bytes)fail('artifact exceeded signed size');chunks.push(part)}const bytes=Buffer.concat(chunks)
  if(bytes.length!==a.bytes||sha(bytes)!==a.sha256)fail('artifact original digest mismatch')
  a.path=`artifact-${i}`;writeFileSync(join(scratch,a.path),bytes,{flag:'wx',mode:0o600})
 }
 const inputPath=join(scratch,'input.json'),output=join(scratch,'unsigned.json')
 writeFileSync(inputPath,JSON.stringify(input),{flag:'wx',mode:0o600})
 for(const name of ['home','tmp','dsh'])mkdirSync(join(scratch,name),{mode:0o700})
 const entry=join(resources,'app.asar','lib','hub-target-proof-runner.js'),runnerArgs=[entry,'--hub-target-proof',inputPath,resources,output]
 let command,commandArgs
 if(process.platform==='darwin'){
  command='/usr/bin/sandbox-exec';if(!existsSync(command))fail('offline OS sandbox unavailable')
  const literal=s=>JSON.stringify(s),readRoots=[resources,scratch,'/System','/usr','/bin','/sbin','/dev','/private/etc','/private/var/db/dyld',dirname(electron)]
  const policy=`(version 1)(deny default)(allow process*)(allow sysctl-read)(allow mach-lookup)(allow file-read* ${readRoots.map(p=>`(subpath ${literal(p)})`).join(' ')})(allow file-write* (subpath ${literal(scratch)}))(deny network*)(allow network-bind (local ip "127.0.0.1:*"))(allow network-inbound (local ip "127.0.0.1:*"))`
  commandArgs=['-p',policy,electron,...runnerArgs]
 }else if(process.platform==='linux'){
  command='/usr/bin/bwrap';if(!existsSync(command))fail('offline OS sandbox unavailable')
  commandArgs=['--unshare-all','--die-with-parent','--new-session','--proc','/proc','--dev','/dev']
  for(const p of ['/usr','/bin','/sbin','/lib','/lib64'])if(existsSync(p))commandArgs.push('--ro-bind',p,p)
  for(const p of [resources,dirname(electron)])commandArgs.push('--ro-bind',p,p)
  commandArgs.push('--bind',scratch,scratch,'--chdir',scratch,'--',electron,...runnerArgs)
 }else fail('unsupported offline sandbox OS')
 const child=spawnSync(command,commandArgs,{cwd:scratch,env:{PATH:'/usr/bin:/bin',HOME:join(scratch,'home'),TMPDIR:join(scratch,'tmp'),DSH_HOME:join(scratch,'dsh'),ELECTRON_RUN_AS_NODE:'1'},stdio:'ignore',timeout:1500000,killSignal:'SIGKILL'})
 if(child.error||child.status!==0||!existsSync(output))fail('sealed offline runner failed')
 const {result,evidence}=JSON.parse(readFileSync(output,'utf8'))
 if(result?.runId!==run||result.jobDigest!==sha(Buffer.from(canonical(input.job)))||result.evidenceDigest!==sha(Buffer.from(canonical(evidence)))||result.hostBuildDigest!==input.job.hostBuildDigest)fail('runner output binding mismatch')
 if(!['PASS','FAIL'].includes(result.status)||Object.keys(result.checks??{}).sort().join(',')!=='materializedExactClosure,negativeControls,realHostLoader')fail('invalid result shape')
 if(result.status==='PASS'&&!Object.values(result.checks??{}).every(v=>v===true))fail('inconsistent PASS')
 const privateKey=createPrivateKey(readFileSync(keyPath));if(privateKey.asymmetricKeyType!=='ed25519')fail('runner key must be Ed25519')
 const submission={runnerId:input.job.runnerId,result,signature:sign(null,Buffer.from(canonical(result)),privateKey).toString('base64')}
 writeFileSync(resolve(opts['--output']),JSON.stringify({submission,evidence})+'\n',{flag:'wx',mode:0o600})
 process.stdout.write(`Hub target proof: ${result.status}; signed submission saved.\n`)
}finally{rmSync(scratch,{force:true,recursive:true})}
