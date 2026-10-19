import {expect,it} from 'vitest'
import {PluginLockGraphSchema} from '../src/hub-artifact-schemas.ts'
import {hubNodeMismatch,verifyHubPluginGraph,verifyHubNodeDependencies,verifyHubNodeMetadata,type HubPluginGraph} from '../src/hub-plugin-graph.ts'
function fixture():HubPluginGraph{
 const node={nodeId:'',name:'example',version:'1.0.0',sha256:'a'.repeat(64),sri:`sha512-${Buffer.alloc(64).toString('base64')}`,bytes:100,fileManifestDigest:'b'.repeat(64),origin:'upload',registryId:'test',engines:{},os:[],cpu:[],libc:[],peerContext:{},hostProvided:false,lockedResolved:null,selection:'included',reason:null}
 return PluginLockGraphSchema.parse({schemaVersion:'plugin-lock-v2',rootNodeId:'',sourceLockDigest:'c'.repeat(64),target:{os:'linux',cpu:'x64',libc:'glibc',nodeVersion:'24.0.0',sensteedVersion:'1.0.0',cordisVersion:'4.0.5',harnessVersion:'1.0.0'},nodes:[node,{...node,nodeId:'node_modules/child',name:'child'}],edges:[{from:'',name:'child',requested:'1.0.0',kind:'optional',peerOptional:false,to:'node_modules/child',selection:'included',reason:null}],hostRequirements:[]})
}
it('accepts compatible optional platform negation and binds actual declarations',()=>{
 const graph=fixture();graph.nodes[1]!.os=['!darwin','any'];verifyHubPluginGraph(graph)
 verifyHubNodeDependencies(graph,graph.nodes[0]!,{dependencies:{child:'2.0.0'},optionalDependencies:{child:'1.0.0'}})
 expect(()=>verifyHubNodeDependencies(graph,graph.nodes[0]!,{})).toThrow('Undeclared')
 verifyHubNodeMetadata(graph.nodes[1]!,{os:['!darwin','any']})
 expect(()=>verifyHubNodeMetadata(graph.nodes[1]!,{os:['linux']})).toThrow('metadata mismatch')
})
it.each(['TARGET_OS_MISMATCH','TARGET_CPU_MISMATCH','TARGET_LIBC_MISMATCH']as const)('allows only proven target omission (%s)',reason=>{
 const graph=fixture();if(graph.schemaVersion!=='plugin-lock-v2')throw Error('fixture');const node=graph.nodes[1]!,edge=graph.edges[0]!
 node.os=reason==='TARGET_OS_MISMATCH'?['!linux']:[];node.cpu=reason==='TARGET_CPU_MISMATCH'?['arm64']:[];node.libc=reason==='TARGET_LIBC_MISMATCH'?['musl']:[]
 node.selection='omitted';node.reason=reason;edge.selection='omitted';edge.reason=reason;verifyHubPluginGraph(graph)
 edge.kind='prod';expect(()=>verifyHubPluginGraph(graph)).toThrow('target selection')
 edge.kind='optional';node.os=[];node.cpu=[];node.libc=[];expect(()=>verifyHubPluginGraph(graph)).toThrow('Unproven')
})
it('fails closed on unknown libc, priority lies and mandatory target mismatch',()=>{
 const graph=fixture();if(graph.schemaVersion!=='plugin-lock-v2')throw Error('fixture');const node=graph.nodes[1]!,edge=graph.edges[0]!
 node.libc=['musl'];graph.target.libc=null;expect(()=>verifyHubPluginGraph(graph)).toThrow('Unknown target libc')
 graph.target.libc='glibc';node.os=['darwin'];node.selection='omitted';node.reason='TARGET_LIBC_MISMATCH';edge.selection='omitted';edge.reason=node.reason;expect(()=>verifyHubPluginGraph(graph)).toThrow('Unproven')
 node.selection='included';node.reason=null;edge.selection='included';edge.reason=null;expect(()=>verifyHubPluginGraph(graph)).toThrow('target mismatch')
 expect(hubNodeMismatch({...node,os:['!any']},graph.target)).toBe('TARGET_OS_MISMATCH')
})
it('rejects disconnected cycles, duplicate edges, and omitted roots',()=>{
 const graph=fixture();if(graph.schemaVersion!=='plugin-lock-v2')throw Error('fixture');const root=graph.nodes[0]!,child=graph.nodes[1]!
 graph.nodes.push({...child,nodeId:'node_modules/other',name:'other'});graph.edges.push({...graph.edges[0]!,from:child.nodeId,name:'other',to:'node_modules/other'});graph.edges[0]!.from='node_modules/other'
 expect(()=>verifyHubPluginGraph(graph)).toThrow('Unreachable')
 graph.edges[0]!.from='';graph.edges.push({...graph.edges[0]!});expect(()=>verifyHubPluginGraph(graph)).toThrow('Invalid closure edge')
 if('selection'in root)root.selection='omitted';expect(()=>verifyHubPluginGraph(graph)).toThrow('root')
})

it('rejects a signed omitted node placed outside its npm lookup path',()=>{
 const graph=fixture();if(graph.schemaVersion!=='plugin-lock-v2')throw Error('fixture');const node=graph.nodes[1]!,edge=graph.edges[0]!
 node.os=['darwin'];node.selection='omitted';node.reason='TARGET_OS_MISMATCH';node.nodeId='node_modules/wrong';edge.to=node.nodeId;edge.selection='omitted';edge.reason=node.reason
 verifyHubPluginGraph(graph)
 expect(()=>verifyHubNodeDependencies(graph,graph.nodes[0]!,{optionalDependencies:{child:'1.0.0'}})).toThrow('topology mismatch')
})
