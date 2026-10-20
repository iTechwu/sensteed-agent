/** Exact first-party update decisions. Caller input never selects origins or fallback architectures. */
import { z } from 'zod'
import { BRAND_UPDATE_SERVICE } from './generated-product-identity.ts'
import { parseCanonicalSupportedVersion } from '@dofe/dsh-sensteed-product/desktop-version-semver'
const TargetSchema=z.strictObject({os:z.enum(['darwin','win32','linux']),arch:z.enum(['x64','arm64']),format:z.enum(['dmg','exe','zip','appimage','deb']),installationMode:z.enum(['installed','portable'])})
export type DesktopUpdateTarget=z.infer<typeof TargetSchema>
export const DesktopV2ArtifactSchema=TargetSchema.extend({id:z.uuid(),sha256:z.string().regex(/^[a-f0-9]{64}$/u),bytes:z.number().int().positive().max(4*1024**3),downloadPath:z.string().regex(/^\/api\/desktop\/v2\/artifacts\/[0-9a-f-]{36}\/download$/u)})
export type DesktopV2Artifact=z.infer<typeof DesktopV2ArtifactSchema>
const MandatorySchema=z.strictObject({minVersion:z.string(),deadline:z.iso.datetime().optional(),notice:z.strictObject({title:z.string().min(1).max(256).optional(),detail:z.string().min(1).max(16384).optional(),zh:z.string().min(1).max(512).optional(),en:z.string().min(1).max(512).optional()}).optional()})
const PolicySchema=z.strictObject({schemaVersion:z.literal(2),product:z.literal('hozonauto-agent'),channel:z.enum(['stable','beta']),policyRevision:z.number().int().nonnegative(),status:z.enum(['update-available','up-to-date','unsupported-target','manual-migration-required','unavailable']),release:z.strictObject({id:z.uuid(),version:z.string(),releaseGeneration:z.enum(['legacy-v1','harness-v1'])}).nullable(),artifact:DesktopV2ArtifactSchema.nullable(),mandatory:MandatorySchema.nullable().optional()})
export function desktopReleaseGeneration(version:string):'legacy-v1'|'harness-v1'{return version.startsWith('0.')?'harness-v1':'legacy-v1'}
export function desktopUpdatePolicyUrl(version:string,channel:'stable'|'beta',target:DesktopUpdateTarget):string{
 const url=new URL('/api/desktop/v2/update-policy',BRAND_UPDATE_SERVICE.endpoint)
 url.search=new URLSearchParams({product:'hozonauto-agent',channel,currentVersion:version,releaseGeneration:desktopReleaseGeneration(version),...TargetSchema.parse(target)}).toString()
 return url.href
}
export function parseDesktopUpdatePolicy(value:unknown,version:string,channel:'stable'|'beta',target:DesktopUpdateTarget){
 const policy=PolicySchema.parse(value)
 if(policy.channel!==channel)throw Error('Desktop update channel mismatch')
 if(policy.release&&parseCanonicalSupportedVersion(policy.release.version)===null)throw Error('Invalid desktop release version')
 if(policy.artifact){
  for(const field of ['os','arch','format','installationMode'] as const)if(policy.artifact[field]!==target[field])throw Error('Desktop update target mismatch')
  if(policy.artifact.downloadPath!==`/api/desktop/v2/artifacts/${policy.artifact.id}/download`)throw Error('Desktop artifact identity mismatch')
 }
 if(policy.status==='update-available'||policy.status==='manual-migration-required'){
  if(!policy.release||!policy.artifact)throw Error('Incomplete desktop update decision')
  if(policy.status==='update-available'&&policy.release.releaseGeneration!==desktopReleaseGeneration(version))throw Error('Desktop generation requires manual migration')
 }
 if(policy.mandatory&&(policy.release?.version!==policy.mandatory.minVersion||!['update-available','up-to-date'].includes(policy.status)||policy.release.releaseGeneration!==desktopReleaseGeneration(version)||!policy.artifact))throw Error('Mandatory target mismatch')
 if((policy.status==='unsupported-target'||policy.status==='unavailable')&&policy.artifact!==null)throw Error('Unsupported target returned an artifact')
 return policy
}
/** Installation form comes from the native launcher, never a renderer request. */
export function resolveDesktopUpdateTarget(os:NodeJS.Platform,arch:string,env:NodeJS.ProcessEnv,windowsInstalled=false):DesktopUpdateTarget|undefined{
 if((os!=='darwin'&&os!=='win32'&&os!=='linux')||(arch!=='x64'&&arch!=='arm64'))return undefined
 // Extracted Windows ZIP has no electron-builder portable environment variables.
 // Only an NSIS-written marker permits automatic EXE installation.
 const portable=os==='win32'&&(!windowsInstalled||Boolean(env.PORTABLE_EXECUTABLE_DIR||env.PORTABLE_EXECUTABLE_FILE))
 return {os,arch,installationMode:portable?'portable':'installed',format:os==='darwin'?'dmg':os==='win32'?(portable?'zip':'exe'):env.APPIMAGE?'appimage':'deb'}
}
