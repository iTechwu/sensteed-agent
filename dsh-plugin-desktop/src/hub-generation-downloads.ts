/** Verify complete signed manifest/locator coverage before any archive is downloaded. */
import { HubGenerationDownloadsSchema } from './hub-artifact-schemas.ts'
import { verifyHubReleaseSignature, hubSyncDigest, type HubReleaseTrust } from './hub-sync-verifier.ts'
import { hubGenerationConsumptionData, type VerifiedHubGenerationConsumption } from './hub-generation-client.ts'
import type { HubGenerationPlan } from './hub-generation-verifier.ts'
import { hubPackageIsHostOwned } from './hub-base-ownership.ts'
export function verifyHubGenerationDownloads(value:unknown, plan:Readonly<HubGenerationPlan>, proof:VerifiedHubGenerationConsumption, trust:HubReleaseTrust) {
 const authority=hubGenerationConsumptionData(proof)
 if(authority.planId!==plan.planId || authority.planDigest!==plan.planDigest || authority.proposedGenerationDigest!==plan.proposedGenerationDigest)throw new Error('Hub downloads operation mismatch')
 const result=HubGenerationDownloadsSchema.parse(value), active=plan.items.filter(i=>i.action!=='uninstall')
 if(result.manifests.length!==active.length)throw new Error('Hub downloads collection mismatch')
 const ids=new Set<string>(),downloads=new Set<string>()
 for(const row of result.manifests){
  const key=`${row.kind}:${row.itemId}`,item=active.find(i=>`${i.kind}:${i.itemId}`===key)
  if(!item || ids.has(key))throw new Error('Hub downloads unexpected manifest');ids.add(key)
  const m=row.envelope.manifest
  verifyHubReleaseSignature(m,row.envelope.signature,trust)
  if(m.tenantId!==plan.tenantId || m.releaseId!==item.releaseId || hubSyncDigest(m)!==item.manifestDigest)throw new Error('Hub downloads manifest binding mismatch')
  const locators=result.descriptors.filter(d=>d.kind===row.kind&&d.itemId===row.itemId)
  if(row.kind==='skill'){
   const manifest=row.envelope.manifest
   if(manifest.skillId!==item.itemId || manifest.artifact.sha256!==item.artifactDigest || locators.length!==1)throw new Error('Hub skill download mismatch')
   const d=locators[0]!
   if(d.nodeId!==null || d.role!=='primary' || d.contentType!=='application/zip' || d.artifactDigest!==manifest.artifact.sha256 || d.bytes!==manifest.artifact.bytes)throw new Error('Hub skill locator mismatch')
  }else{
   const manifest=row.envelope.manifest
   if(manifest.pluginId!==item.itemId || manifest.tarballDigest!==item.artifactDigest || manifest.lockGraphDigest!==item.lockGraphDigest || manifest.packSetDigest!==item.packSetDigest || locators.length!==manifest.artifacts.length)throw new Error('Hub plugin download mismatch')
   const target=manifest.graph.target
   if(target.os!==plan.target.os||target.cpu!==plan.target.arch||target.libc!==plan.target.libc||target.nodeVersion!==plan.target.nodeVersion||target.sensteedVersion!==plan.target.sensteedVersion||target.cordisVersion!==plan.target.cordisVersion||target.harnessVersion!==plan.target.harnessVersion)throw new Error('Hub closure target mismatch')
   if(hubSyncDigest(manifest.graph)!==manifest.lockGraphDigest || hubSyncDigest(manifest.graph.nodes.map(n=>({nodeId:n.nodeId,name:n.name,version:n.version,sha256:n.sha256,sri:n.sri,bytes:n.bytes,fileManifestDigest:n.fileManifestDigest})).sort((a,b)=>a.nodeId<b.nodeId?-1:a.nodeId>b.nodeId?1:0))!==manifest.packSetDigest)throw new Error('Hub closure digest mismatch')
   if(manifest.graph.nodes.some(n=>hubPackageIsHostOwned(n.name)))throw new Error('Hub closure contains Host-owned package')
   const nodes=new Set<string>()
   for(const a of manifest.artifacts){
    const matches=locators.filter(d=>d.nodeId===a.nodeId)
    if(nodes.has(a.nodeId)||matches.length!==1)throw new Error('Hub closure locator coverage mismatch');nodes.add(a.nodeId)
    const d=matches[0]!
    if(d.artifactDigest!==a.sha256||d.bytes!==a.bytes||d.contentType!=='application/gzip'||d.role!==(a.nodeId===''?'primary':'dependency'))throw new Error('Hub closure locator mismatch')
   }
  }
  for(const d of locators){if(downloads.has(d.downloadId))throw new Error('Duplicate Hub download locator');downloads.add(d.downloadId)}
 }
 if(downloads.size!==result.descriptors.length)throw new Error('Hub downloads contains foreign locator')
 return result
}
