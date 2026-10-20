import type { z } from 'zod'
import type { HubGenerationDownloadsSchema } from './hub-artifact-schemas.ts'
import type { HubGenerationPlan } from './hub-generation-verifier.ts'
import { verifyHubRequirements } from './hub-requirements-verifier.ts'
export function verifyHubManifestRequirements(rows:z.infer<typeof HubGenerationDownloadsSchema>['manifests'],plan:Readonly<HubGenerationPlan>):void{
 verifyHubRequirements(rows.map(row=>{
  const manifest=row.envelope.manifest
  return {kind:row.kind,identity:row.kind==='skill'?row.envelope.manifest.installName:row.envelope.manifest.npmPackageName,version:row.kind==='skill'?row.envelope.manifest.version:row.envelope.manifest.exactVersion,enabled:plan.items.some(item=>item.kind===row.kind&&item.itemId===row.itemId&&item.action!=='uninstall'&&item.enabled),...('requirements'in manifest?{requirements:manifest.requirements}:{})}
 }),plan.target)
}
