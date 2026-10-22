/** Recompute this Next installation's real seal; a development tree has no Hub target. */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { readPackagedHubBuildIdentity, type HubBuildFileAccess } from '../../dsh-plugin-desktop/src/hub-build-identity.ts'
import { HubSyncTargetSchema, type HubSyncTarget } from '../../dsh-plugin-desktop/src/hub-sync-verifier.ts'
import { NEXT_PACKAGE } from './profiles.ts'
export async function readNextHubTarget(options:{isPackaged:boolean;appPath:string;resourcesPath:string;version:string}):Promise<HubSyncTarget|undefined>{
 if(!options.isPackaged)return undefined
 const require=createRequire(NEXT_PACKAGE),fs=require('original-fs') as {lstatSync:HubBuildFileAccess['lstat'];readdirSync:HubBuildFileAccess['readdir'];readFileSync:HubBuildFileAccess['readFile'];createReadStream:HubBuildFileAccess['createReadStream']}
 const seal=await readPackagedHubBuildIdentity(options.appPath,options.resourcesPath,{lstat:fs.lstatSync,readdir:fs.readdirSync,readFile:fs.readFileSync,createReadStream:fs.createReadStream})
 const version=(name:string)=>(JSON.parse(readFileSync(require.resolve(`${name}/package.json`),'utf8')) as {version:string}).version
 const {HUB_HOST_CAPABILITIES}=await import('@dofe/dsh-sensteed-product/public-mcp-capabilities')
 return HubSyncTargetSchema.parse({sensteedVersion:options.version,harnessVersion:version('@deepseek-ai/dsh'),cordisVersion:version('@deepseek-ai/cordis'),os:process.platform,arch:process.arch,nodeVersion:process.versions.node,nodeAbi:process.versions.modules,libc:process.platform==='linux'?((process.report.getReport() as {header?:{glibcVersionRuntime?:string}}).header?.glibcVersionRuntime?'glibc':'musl'):null,hostBuildDigest:seal.hostBuildDigest,hostCapabilities:[...HUB_HOST_CAPABILITIES]})
}
