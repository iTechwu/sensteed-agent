/** CI-only proof entry. Does not mint consumption or accept an injectable/mock loader. */
import { readSealedHubReleaseTrust } from './hub-release-trust.ts'
import { prepareTargetProofBase } from './hub-target-proof-base.ts'
import { createHash } from 'node:crypto'
import { createRequire, registerHooks } from 'node:module'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, isAbsolute, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import { load, JSON_SCHEMA } from 'js-yaml'
import { HubSyncTargetSchema, HubReleaseSignatureSchema, hubSyncDigest, verifyHubReleaseSignature, type HubReleaseTrust } from './hub-sync-verifier.ts'
import { SkillManifestSchema, PluginManifestV2Schema } from './hub-artifact-schemas.ts'
import { readHubPluginArchive } from './hub-plugin-archive.ts'
import { unpackSkillArchive, fileManifestDigest } from './hub-skill-archive.mjs'
import { hubPackageIsHostOwned } from './hub-base-ownership.ts'
import { readPackagedHubBuildIdentity, type HubBuildFileAccess } from './hub-build-identity.ts'

const digest=z.string().regex(/^[a-f0-9]{64}$/u)
export const ProofJobSchema=z.strictObject({schemaVersion:z.literal('hub-target-proof-job-v1'),kind:z.enum(['skill','plugin']),releaseId:z.uuid(),target:HubSyncTargetSchema,runnerId:z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u),runId:z.uuid(),nonce:digest,tenantId:z.uuid(),artifactDigest:digest,manifestDigest:digest,lockGraphDigest:digest.nullable(),packSetDigest:digest.nullable(),targetDigest:digest,hostBuildDigest:digest,policyVersion:z.literal('host-loader-proof-v1'),issuedAt:z.iso.datetime(),expiresAt:z.iso.datetime(),proofExpiresAt:z.iso.datetime()})
export const ProofInputSchema=z.strictObject({job:ProofJobSchema,envelope:z.union([z.strictObject({manifest:SkillManifestSchema,signature:HubReleaseSignatureSchema}),z.strictObject({manifest:PluginManifestV2Schema,signature:HubReleaseSignatureSchema})]),artifacts:z.array(z.strictObject({nodeId:z.string().max(1000).nullable(),sha256:digest,bytes:z.number().int().positive(),contentType:z.enum(['application/zip','application/gzip']),path:z.string().min(1).max(1000)})).min(1).max(500)})
export type ProofInput=z.infer<typeof ProofInputSchema>
type Composition={entries:{id:string;name:string;config:Record<string,unknown>}[];skillName?:string;skillPath?:string;packageName?:string;hostEntry?:string;files:Record<string,string>;root:string}
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
function assert(value:unknown,message:string):asserts value {if(!value)throw Error(`Hub target proof: ${message}`)}
function safePath(value:string):void {assert(value&&value===value.normalize('NFC')&&!isAbsolute(value)&&!value.split('/').some(p=>!p||p==='.'||p==='..'||/[\\<>:"|?*\x00-\x1f\x7f]/u.test(p)||/[. ]$/u.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(p)),'unsafe path')}
function independentFile(root:string,path:string):Buffer {
 safePath(path);let current=root
 for(const part of path.split('/')){current=join(current,part);const stat=lstatSync(current);assert(!stat.isSymbolicLink(),'symlink input')}
 const stat=lstatSync(current);assert(stat.isFile()&&stat.nlink===1&&stat.size<=268435456,'non-independent or oversized artifact');return readFileSync(current)
}
function data(value:unknown,seen=new Set<object>(),depth=0):void {
 assert(depth<=32,'patch depth');if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return
 assert(typeof value==='object'&&!seen.has(value),'non-data activation');seen.add(value)
 for(const [key,child]of Object.entries(value)){assert(!['__proto__','prototype','constructor','__jsExpr'].includes(key),'executable activation');data(child,seen,depth+1)}
}
function parentInstance(value:string):string {const index=value.lastIndexOf('/node_modules/');return index<0?'':value.slice(0,index)}
function activation(patch:Buffer|undefined,name:string):Composition['entries'] {
 if(!patch)return [{id:'proof-candidate',name,config:{}}]
 assert(patch.length<=262144,'patch too large');const value=load(patch.toString('utf8'),{schema:JSON_SCHEMA,json:false});data(value)
 assert(Array.isArray(value)&&value.length>0&&value.length<=100,'invalid self activation');const ids=new Set<string>(),entries:Composition['entries']=[]
 for(const op of value){assert(op&&typeof op==='object'&&Object.keys(op).join()==='insert'&&Array.isArray(op.insert),'foreign operation')
  for(const item of op.insert){assert(item&&typeof item==='object'&&Object.keys(item).every(k=>['id','name','config'].includes(k))&&typeof item.id==='string'&&item.id.length>0&&item.name===name&&!ids.has(item.id),'foreign insertion');assert(item.config===undefined||item.config&&typeof item.config==='object'&&!Array.isArray(item.config),'invalid config');ids.add(item.id);entries.push({id:item.id,name,config:item.config??{}})}
 }return entries
}
/** No candidate code is imported here. All archive bytes, closure nodes and topology are checked first. */
export function materializeProofInput(raw:unknown,trust:HubReleaseTrust,inputDirectory:string,root:string,now=Date.now()):{input:ProofInput;composition:Composition} {
 const input=ProofInputSchema.parse(raw),{job,envelope}=input,m=envelope.manifest
 assert(input.artifacts.reduce((sum,a)=>sum+a.bytes,0)<=1073741824,'compressed closure budget')
 assert(input.artifacts.every(a=>a.contentType===(job.kind==='skill'?'application/zip':'application/gzip')),'artifact MIME mismatch')
 assert(Date.parse(job.issuedAt)<=now+30000&&Date.parse(job.expiresAt)>now&&Date.parse(job.expiresAt)-Date.parse(job.issuedAt)<=1800000,'expired job')
 assert(job.targetDigest===hubSyncDigest(job.target)&&job.target.hostBuildDigest===job.hostBuildDigest,'target binding')
 verifyHubReleaseSignature(m,envelope.signature,trust)
 assert(m.tenantId===job.tenantId&&m.releaseId===job.releaseId&&hubSyncDigest(m)===job.manifestDigest,'release binding')
 assert(new Set(input.artifacts.map(a=>a.nodeId)).size===input.artifacts.length,'duplicate artifact')
 const composition:Composition={entries:[],files:{},root};let expanded=0
 const put=(path:string,bytes:Buffer)=>{safePath(path);assert(!Object.keys(composition.files).some(p=>p.toLowerCase()===path.toLowerCase()),'portable collision');assert(Object.keys(composition.files).length<20000&&(expanded+=bytes.length)<=1073741824,'expanded budget');mkdirSync(dirname(join(root,path)),{recursive:true,mode:0o700});writeFileSync(join(root,path),bytes,{flag:'wx',mode:0o600});composition.files[path]=sha(bytes)}
 const artifact=(nodeId:string|null,expected:string,size:number)=>{const row=input.artifacts.find(a=>a.nodeId===nodeId);assert(row&&row.sha256===expected&&row.bytes===size,'artifact coverage');const bytes=independentFile(inputDirectory,row.path);assert(bytes.length===size&&sha(bytes)===expected,'artifact digest');return bytes}
 if(job.kind==='skill'){
  assert('artifact'in m&&input.artifacts.length===1&&job.lockGraphDigest===null&&job.packSetDigest===null,'skill envelope')
  assert(m.artifact.sha256===job.artifactDigest,'skill digest');const unpacked=unpackSkillArchive(artifact(null,m.artifact.sha256,m.artifact.bytes)) as Record<string,Buffer>
  assert(fileManifestDigest(unpacked)===m.fileManifestDigest,'skill file manifest');for(const [path,bytes]of Object.entries(unpacked))put(`skills/${m.installName}/${path}`,bytes)
  assert(unpacked['SKILL.md'],'skill missing');composition.skillName=m.installName;composition.skillPath=join(root,'skills',m.installName,'SKILL.md')
 }else{
  assert('graph'in m&&m.tarballDigest===job.artifactDigest&&m.lockGraphDigest===job.lockGraphDigest&&m.packSetDigest===job.packSetDigest,'plugin envelope')
  assert(hubSyncDigest(m.graph)===m.lockGraphDigest&&hubSyncDigest(m.graph.nodes.map(n=>({nodeId:n.nodeId,name:n.name,version:n.version,sha256:n.sha256,sri:n.sri,bytes:n.bytes,fileManifestDigest:n.fileManifestDigest})).sort((a,b)=>a.nodeId<b.nodeId?-1:a.nodeId>b.nodeId?1:0))===m.packSetDigest,'closure digest')
  const nodes=new Map(m.graph.nodes.map(n=>[n.nodeId,n]));assert(nodes.size===m.graph.nodes.length&&nodes.has('')&&input.artifacts.length===nodes.size&&m.artifacts.length===nodes.size,'closure coverage')
  assert(Object.entries(m.graph.target).every(([key,value])=>value===job.target[key==='cpu'?'arch':key as keyof typeof job.target]),'closure target mismatch')
  const rootNode=nodes.get('')!;assert(rootNode.name===m.npmPackageName&&rootNode.version===m.exactVersion&&rootNode.sha256===m.tarballDigest&&rootNode.sri===m.sri,'root identity mismatch')
  const prefix=`node_modules/${m.npmPackageName}`
  for(const node of nodes.values()){
   assert(!hubPackageIsHostOwned(node.name),'Host package substitution')
   if(node.nodeId){safePath(node.nodeId);assert(/^node_modules\/(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/u.test(node.nodeId),'closure layout')}
   const signed=m.artifacts.find(a=>a.nodeId===node.nodeId);assert(signed&&signed.sri===node.sri&&signed.sha256===node.sha256&&signed.bytes===node.bytes&&signed.fileManifestDigest===node.fileManifestDigest,'signed node mismatch')
   const bytes=artifact(node.nodeId,node.sha256,node.bytes);assert(`sha512-${createHash('sha512').update(bytes).digest('base64')}`===node.sri,'SRI mismatch')
   const files=readHubPluginArchive(bytes),list=[...files].map(([path,b])=>({path,bytes:b.length,sha256:sha(b)})).sort((a,b)=>a.path<b.path?-1:1)
   assert(hubSyncDigest(list)===node.fileManifestDigest,'node file manifest');const pkg=JSON.parse(files.get('package.json')!.toString('utf8')) as Record<string,unknown>;assert(pkg.name===node.name&&pkg.version===node.version,'node identity')
   const scripts=pkg.scripts as Record<string,unknown>|undefined;assert(!scripts||!['preinstall','install','postinstall'].some(k=>Object.hasOwn(scripts,k)),'install hooks prohibited')
   for(const field of ['dependencies','peerDependencies']as const){const declared=pkg[field]??{};assert(declared&&typeof declared==='object'&&!Array.isArray(declared),'dependency declaration')
    for(const [name,requested]of Object.entries(declared)){const edge=m.graph.edges.find(e=>e.from===node.nodeId&&e.name===name&&e.kind===(field==='dependencies'?'prod':'peer'));assert(edge&&edge.requested===requested&&nodes.has(edge.to),'missing closure edge');let from=field==='peerDependencies'&&node.nodeId?parentInstance(node.nodeId):node.nodeId,resolved:string|undefined;while(true){const candidate=from?`${from}/node_modules/${name}`:`node_modules/${name}`;if(nodes.has(candidate)){resolved=candidate;break}if(!from)break;from=parentInstance(from)}assert(resolved===edge.to,'closure topology mismatch')}
   }
   for(const [path,b]of files)put(`${prefix}${node.nodeId?`/${node.nodeId}`:''}/${path}`,b)
   if(node.nodeId===''){assert(m.root.hostEntry&&files.has(m.root.hostEntry)&&hubSyncDigest(list)===m.root.fileManifestDigest,'root entry mismatch');assert(!m.root.bundlePatch||files.has(m.root.bundlePatch),'signed activation missing');composition.entries=activation(m.root.bundlePatch?files.get(m.root.bundlePatch):undefined,m.npmPackageName);composition.packageName=m.npmPackageName;composition.hostEntry=join(root,prefix,m.root.hostEntry)}
  }
 }
 writeFileSync(join(root,'package.json'),'{"private":true,"type":"module"}\n',{flag:'wx',mode:0o600});writeFileSync(join(root,'root.yml'),'[]\n',{flag:'wx',mode:0o600});mkdirSync(join(root,'skills'),{recursive:true,mode:0o700})
 return {input,composition}
}
/** Uses the actual Cordis Loader and real filesystem skill registry from this installation. */
export async function loadProofComposition(composition:Composition,capabilities:readonly string[]=[],fullBase=false):Promise<{entryIds:string[];skillNames:string[];moduleDigests:string[]}> {
 const [{boot},skillModule,filesystem]=await Promise.all([import('@deepseek-ai/dsh-app-boot'),import('@deepseek-ai/dsh-skill'),import('@deepseek-ai/dsh-skill-filesystem')])
 const loaded=new Set<string>(),prefix=pathToFileURL(composition.root+sep).href
 const hooks=registerHooks({resolve(specifier,context,nextResolve){const result=nextResolve(specifier,hubPackageIsHostOwned(specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0]!)&&context.parentURL?.startsWith(prefix)?{...context,parentURL:import.meta.url}:context);if(result.url.startsWith(prefix))loaded.add(result.url);return result}})
 let ctx:Awaited<ReturnType<typeof boot>>|undefined
 try{
  ctx=await boot('hub-target-proof',join(composition.root,'root.yml'),[{insert:composition.entries}],async ctx=>{
   if(fullBase)await prepareTargetProofBase(ctx,composition.root)
   await ctx.plugin(skillModule.default)
   filesystem.installFilesystemSkillRootPolicy(ctx,{generationId:'target-proof',providerName:'target-proof',roots:[{path:join(composition.root,'skills'),source:'hub',rank:100}]})
   await ctx.plugin(filesystem,{providerName:'target-proof',includeDefaultRoots:false,watch:false})
   for(const capability of capabilities){const value=ctx.get(capability as never);assert(value!==undefined,'target capability absent')}
  },pathToFileURL(join(composition.root,'package.json')).href)
  for(const capability of capabilities)assert(ctx.get(capability as never)!==undefined,'Host capability disappeared')
  const entries=[...ctx.loader.entries()]
  for(const expected of composition.entries){const rows=entries.filter(e=>e.options.id===expected.id);assert(rows.length===1&&rows[0]!.options.name===expected.name&&!rows[0]!.disabled&&rows[0]!.fiber?.state===2,'real Host entry inactive')}
  if(composition.packageName)assert([...loaded].some(url=>url.startsWith(pathToFileURL(join(composition.root,'node_modules',composition.packageName!)+sep).href)&&!url.endsWith('/package.json')),'no observed candidate module')
  const skills=await ctx.skills.list();if(composition.skillName){const candidates=skills.filter(s=>s.name===composition.skillName);assert(candidates.length===1&&candidates[0]!.provider==='target-proof'&&candidates[0]!.source==='hub'&&candidates[0]!.path===composition.skillPath,'real skill discovery mismatch');assert((await ctx.skills.get(composition.skillName))?.content,'real skill body missing')}
  return {entryIds:composition.entries.map(e=>e.id),skillNames:composition.skillName?[composition.skillName]:[],moduleDigests:[...loaded].filter(url=>url.startsWith('file:')).map(url=>sha(readFileSync(fileURLToPath(url)))).sort()}
 }finally{await ctx?.fiber.dispose();hooks.deregister()}
}
function packageVersion(name:string):string {let directory=dirname(fileURLToPath(import.meta.resolve(name)));for(let i=0;i<12;i++){try{const p=JSON.parse(readFileSync(join(directory,'package.json'),'utf8'))as{name?:string;version?:string};if(p.name===name&&p.version)return p.version}catch{}directory=dirname(directory)}throw Error('Host package version unavailable')}
/** Production entry must be compiled inside the exact sealed base it claims. */
export async function runSealedTargetProof(inputPath:string,resourcesPath:string,outputPath:string):Promise<void>{
 const resources=resolve(resourcesPath),app=join(resources,'app.asar'),own=fileURLToPath(import.meta.url)
 assert(process.versions.electron&&own.startsWith(app+sep),'runner must execute inside sealed Electron ASAR')
 for(const name of ['@deepseek-ai/dsh-app-boot','@deepseek-ai/cordis','@deepseek-ai/dsh-skill'])assert(fileURLToPath(import.meta.resolve(name)).startsWith(app+sep),'Host core resolved outside sealed base')
 const originalModule=createRequire(import.meta.url)('original-fs') as typeof import('node:fs')
 const original:HubBuildFileAccess={lstat:originalModule.lstatSync,readdir:originalModule.readdirSync,readFile:originalModule.readFileSync,createReadStream:originalModule.createReadStream}
 const base=await readPackagedHubBuildIdentity(app,resources,original)
 const raw=JSON.parse(readFileSync(inputPath,'utf8')) as unknown,input=ProofInputSchema.parse(raw),trust=readSealedHubReleaseTrust()
 const {job}=input,target=job.target
 assert(base.hostBuildDigest===job.hostBuildDigest&&target.os===process.platform&&target.arch===process.arch&&target.nodeVersion===process.versions.node&&target.nodeAbi===process.versions.modules&&target.sensteedVersion===JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version&&target.cordisVersion===packageVersion('@deepseek-ai/cordis')&&target.harnessVersion===packageVersion('@deepseek-ai/dsh-app-boot'),'actual Host target mismatch')
 if(process.platform==='linux'){const report=process.report.getReport() as {header?:{glibcVersionRuntime?:string}};assert(target.libc===(report.header?.glibcVersionRuntime?'glibc':'musl'),'actual libc mismatch')}else assert(target.libc===null,'unexpected libc')
 const startedAt=new Date().toISOString(),scratch=mkdtempSync(join(tmpdir(),'hub-target-proof-'));let materializedExactClosure=false,realHostLoader=false,negativeControls=false;let evidence:unknown={failure:'proof incomplete'}
 try{
  const root=join(scratch,'positive');mkdirSync(root,{mode:0o700});const validated=materializeProofInput(raw,trust,dirname(inputPath),root);materializedExactClosure=true
  const positive=await loadProofComposition(validated.composition,target.hostCapabilities,true);realHostLoader=true
  // Corrupted original-byte input must fail before loading, independent of Host code behavior.
  const corrupt=structuredClone(input);corrupt.artifacts[0]!.sha256='0'.repeat(64);let corruptRejected=false
  try{const dir=join(scratch,'corrupt');mkdirSync(dir);materializeProofInput(corrupt,trust,dirname(inputPath),dir)}catch{corruptRejected=true}
  // A real missing entry/skill must fail the same Host observation path.
  const negativeRoot=join(scratch,'negative');mkdirSync(negativeRoot);const negative=materializeProofInput(raw,trust,dirname(inputPath),negativeRoot).composition
  if(negative.hostEntry)writeFileSync(negative.hostEntry,'throw new Error("target-proof-negative-control")\n')
  else if(negative.skillPath)rmSync(negative.skillPath)
  let realNegativeRejected=false;try{await loadProofComposition(negative,target.hostCapabilities,true)}catch{realNegativeRejected=true}
  assert(corruptRejected&&realNegativeRejected,'negative control unexpectedly loaded')
  for(const [path,hash]of Object.entries(validated.composition.files))assert(sha(readFileSync(join(root,path)))===hash,'candidate changed its frozen artifact')
  assert((await readPackagedHubBuildIdentity(app,resources,original)).hostBuildDigest===base.hostBuildDigest,'sealed base changed during test')
  negativeControls=true
  evidence={schemaVersion:'hub-target-proof-observation-v1',positive,corruptRejected,realNegativeRejected,fileSetDigest:hubSyncDigest(validated.composition.files)}
 }catch{evidence={schemaVersion:'hub-target-proof-observation-v1',failure:'actual materialization, Host loading or negative control failed'}}finally{rmSync(scratch,{recursive:true,force:true})}
 const result={schemaVersion:'hub-target-proof-result-v1',runId:job.runId,nonce:job.nonce,jobDigest:hubSyncDigest(job),targetDigest:job.targetDigest,hostBuildDigest:job.hostBuildDigest,status:materializedExactClosure&&realHostLoader&&negativeControls?'PASS':'FAIL',checks:{materializedExactClosure,realHostLoader,negativeControls},evidenceDigest:hubSyncDigest(evidence),startedAt,finishedAt:new Date().toISOString()}
 writeFileSync(outputPath,JSON.stringify({result,evidence}),{flag:'wx',mode:0o600})
}
if(process.argv[2]==='--hub-target-proof'){
 const args=process.argv.slice(3);assert(args.length===3,'expected input/resources/output paths')
 await runSealedTargetProof(args[0]!,args[1]!,args[2]!)
}
