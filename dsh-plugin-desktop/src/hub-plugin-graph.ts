/** Independently verify signed target selection and actual package metadata before layout. */
import type{z}from'zod'
import type{PluginLockGraphSchema}from'./hub-artifact-schemas.ts'
export type HubPluginGraph=z.infer<typeof PluginLockGraphSchema>
export type HubPluginNode=HubPluginGraph['nodes'][number]
export function hubNodeIncluded(node:HubPluginNode):boolean{return !('selection'in node)||node.selection==='included'}
function platformList(value:unknown):string[]{if(value===undefined)return[];if(!Array.isArray(value)||value.some(x=>typeof x!=='string'))throw new Error('Invalid package platform metadata');return value as string[]}
function matches(terms:readonly string[],target:string):boolean{if(terms.includes(`!${target}`)||terms.includes('!any'))return false;const positive=terms.filter(x=>!x.startsWith('!'));return positive.length===0||positive.includes('any')||positive.includes(target)}
export function hubNodeMismatch(node:HubPluginNode,target:HubPluginGraph['target']):string|null{
 if(!matches(node.os,target.os))return'TARGET_OS_MISMATCH'
 if(!matches(node.cpu,target.cpu))return'TARGET_CPU_MISMATCH'
 if(target.os==='linux'&&node.libc.length){if(target.libc===null)throw new Error('Unknown target libc');if(!matches(node.libc,target.libc))return'TARGET_LIBC_MISMATCH'}
 return null
}
export function verifyHubPluginGraph(graph:HubPluginGraph):void{
 const nodes=new Map(graph.nodes.map(n=>[n.nodeId,n]));if(nodes.size!==graph.nodes.length||!nodes.has('')||!hubNodeIncluded(nodes.get('')!))throw new Error('Invalid closure root or duplicate node')
 const edges=new Set<string>()
 const reachable=new Set(['']);let changed=true;while(changed){changed=false;for(const edge of graph.edges)if(reachable.has(edge.from)&&!reachable.has(edge.to)){reachable.add(edge.to);changed=true}}
 for(const edge of graph.edges){const from=nodes.get(edge.from),to=nodes.get(edge.to),key=JSON.stringify([edge.from,edge.name,edge.kind]);if(!from||!to||!hubNodeIncluded(from)||edges.has(key)||to.name!==edge.name)throw new Error('Invalid closure edge');edges.add(key)
  if(edge.selection!==(hubNodeIncluded(to)?'included':'omitted')||edge.reason!==('reason'in to?to.reason:null)||edge.selection==='omitted'&&edge.kind!=='optional')throw new Error('Invalid closure target selection')
 }
 for(const node of graph.nodes){const mismatch=hubNodeMismatch(node,graph.target)
  if(hubNodeIncluded(node)){if(mismatch||'reason'in node&&node.reason!==null)throw new Error('Included closure node target mismatch')}
  else if(!mismatch||!('reason'in node)||node.reason!==mismatch||!graph.edges.some(e=>e.to===node.nodeId&&e.kind==='optional'))throw new Error('Unproven optional target omission')
  if(!reachable.has(node.nodeId))throw new Error('Unreachable closure node')
 }
}
export function verifyHubNodeMetadata(node:HubPluginNode,pkg:Record<string,unknown>):void{for(const field of ['os','cpu','libc']as const){if(JSON.stringify(platformList(pkg[field]))!==JSON.stringify(node[field]))throw new Error('Closure platform metadata mismatch')}}

function parentInstance(value:string):string {const index=value.lastIndexOf('/node_modules/');return index<0?'':value.slice(0,index)}
/** Match signed edges to actual declarations and npm nested dependency/peer lookup. */
export function verifyHubNodeDependencies(graph:HubPluginGraph,node:HubPluginNode,pkg:Record<string,unknown>):void{
 const declarations=new Map<string,Record<string,unknown>>()
 for(const field of ['dependencies','peerDependencies','optionalDependencies']as const){const value=pkg[field]??{};if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid closure dependency declarations');declarations.set(field,value as Record<string,unknown>)}
 const expected=new Set<string>()
 for(const field of ['dependencies','peerDependencies','optionalDependencies']as const){for(const [name,requested]of Object.entries(declarations.get(field)!)){
  if(field==='dependencies'&&Object.hasOwn(declarations.get('optionalDependencies')!,name))continue
  const kind=field==='dependencies'?'prod':field==='peerDependencies'?'peer':'optional';expected.add(JSON.stringify([name,kind]))
  const edge=graph.edges.find(e=>e.from===node.nodeId&&e.name===name&&e.kind===kind)
  if(typeof requested!=='string'||!edge||edge.requested!==requested)throw new Error('Closure dependency edge missing')
  let from=kind==='peer'&&node.nodeId?parentInstance(node.nodeId):node.nodeId,resolved:string|undefined
  while(true){const candidate=from?`${from}/node_modules/${name}`:`node_modules/${name}`;if(graph.nodes.some(n=>n.nodeId===candidate&&(hubNodeIncluded(n)||edge.selection==='omitted'))){resolved=candidate;break}if(!from)break;from=parentInstance(from)}
  if(resolved!==edge.to)throw new Error('Closure dependency topology mismatch')
 }}
 if(graph.edges.some(e=>e.from===node.nodeId&&!expected.has(JSON.stringify([e.name,e.kind]))))throw new Error('Undeclared closure dependency edge')
}
