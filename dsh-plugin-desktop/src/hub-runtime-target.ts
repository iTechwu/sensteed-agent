import { HUB_HOST_CAPABILITIES } from '@dofe/dsh-sensteed-product/public-mcp-capabilities'
import{BRAND_VARIANT}from'./generated-product-identity.ts'
/** Launcher-only actual sealed-base target. Development runs never manufacture enterprise proof. */
import{createRequire}from'node:module'
import{readFileSync}from'node:fs'
import{readPackagedHubBuildIdentity,type HubBuildFileAccess}from'./hub-build-identity.ts'
import{HubSyncTargetSchema,type HubSyncTarget}from'./hub-sync-verifier.ts'
const require=createRequire(import.meta.url)
function version(name:string):string{return (JSON.parse(readFileSync(require.resolve(`${name}/package.json`),'utf8'))as{version:string}).version}
export async function readHubRuntimeTarget(options:{readonly isPackaged:boolean;readonly appPath:string;readonly resourcesPath:string;readonly sensteedVersion:string}):Promise<HubSyncTarget|undefined>{
 if(!options.isPackaged||String(BRAND_VARIANT)!=='sensteed')return undefined
 const fs=require('original-fs') as {lstatSync:HubBuildFileAccess['lstat'];readdirSync:HubBuildFileAccess['readdir'];readFileSync:HubBuildFileAccess['readFile'];createReadStream:HubBuildFileAccess['createReadStream']}
 const build=await readPackagedHubBuildIdentity(options.appPath,options.resourcesPath,{lstat:fs.lstatSync,readdir:fs.readdirSync,readFile:fs.readFileSync,createReadStream:fs.createReadStream})
 const report=process.platform==='linux'?process.report.getReport()as{header?:{glibcVersionRuntime?:string}}:undefined
 return HubSyncTargetSchema.parse({sensteedVersion:options.sensteedVersion,harnessVersion:version('@deepseek-ai/dsh'),cordisVersion:version('@deepseek-ai/cordis'),os:process.platform,arch:process.arch,nodeVersion:process.versions.node,nodeAbi:process.versions.modules,libc:process.platform==='linux'?(report?.header?.glibcVersionRuntime?'glibc':'musl'):null,hostBuildDigest:build.hostBuildDigest,hostCapabilities:[...HUB_HOST_CAPABILITIES]})
}
