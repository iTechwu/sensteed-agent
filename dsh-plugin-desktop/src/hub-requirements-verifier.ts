/** Required dependencies are checked against the complete enabled collection at stage and boot. */
import { satisfies, validRange } from 'semver'
import { HubRequirementsSchema, type HubRequirements } from './hub-requirements.ts'
import type { HubSyncTarget } from './hub-sync-verifier.ts'
export interface HubRequirementContent {kind:'skill'|'plugin';identity:string;version:string;enabled:boolean;requirements?:HubRequirements}
export function verifyHubRequirements(items:readonly HubRequirementContent[],target:Pick<HubSyncTarget,'hostCapabilities'>):void {
 const enabled=new Map<string,HubRequirementContent>()
 for(const item of items){if(!item.enabled)continue;const key=`${item.kind}:${item.identity}`;if(enabled.has(key))throw Error('Duplicate Hub content identity');enabled.set(key,item)}
 const capabilities=new Map<string,string>()
 for(const token of target.hostCapabilities){const at=token.lastIndexOf('@');if(at>0){const id=token.slice(0,at);if(capabilities.has(id))throw Error('Duplicate Host capability');capabilities.set(id,token.slice(at+1))}}
 const graph=new Map<string,string[]>()
 for(const [key,item]of enabled){
  const edges:string[]=[];graph.set(key,edges)
  if(!item.requirements)continue
  const requirements=HubRequirementsSchema.parse(item.requirements)
  if(!target.hostCapabilities.includes('hub.requirements.v1'))throw Error('Host requirements contract unavailable')
  for(const dep of requirements.host){if(!validRange(dep.versionRange))throw Error('Invalid Host requirement range');if(dep.required&&(!capabilities.has(dep.capabilityId)||!satisfies(capabilities.get(dep.capabilityId)!,dep.versionRange)))throw Error('Required Host capability unavailable')}
  for(const dep of requirements.mcp){if(dep.required&&!capabilities.has(`mcp.endpoint:${dep.endpointRef.service}/${dep.endpointRef.domain}`))throw Error('Required MCP endpoint unavailable')}
  for(const dep of requirements.content){
   if(!validRange(dep.versionRange))throw Error('Invalid content requirement range')
   const dependency=`${dep.kind}:${dep.identity}`,selected=enabled.get(dependency)
   if(dep.required&&(!selected||!satisfies(selected.version,dep.versionRange)))throw Error('Required enabled content unavailable')
   if(selected&&satisfies(selected.version,dep.versionRange))edges.push(dependency)
  }
 }
 const visiting=new Set<string>(),done=new Set<string>()
 function visit(key:string){if(visiting.has(key))throw Error('Cyclic Hub content dependency');if(done.has(key))return;visiting.add(key);for(const dep of graph.get(key)??[])visit(dep);visiting.delete(key);done.add(key)}
 for(const key of graph.keys())visit(key)
}
