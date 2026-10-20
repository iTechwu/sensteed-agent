import { randomUUID } from 'node:crypto'
import { SkillManifestSchema } from '../src/hub-artifact-schemas.ts'
import {describe,it,expect} from 'vitest'
import {HubRequirementsSchema,type HubRequirements} from '../src/hub-requirements.ts'
import {verifyHubRequirements,type HubRequirementContent} from '../src/hub-requirements-verifier.ts'
const target={hostCapabilities:['hub.requirements.v1','hub.mcp@1.0.0','mcp.endpoint:knowledge/knowledge@1.0.0']}
const empty:HubRequirements={schemaVersion:'sensteed-requirements-v1',host:[],content:[],mcp:[]}
const consumer:HubRequirementContent={kind:'skill',identity:'consumer',version:'1.0.0',enabled:true,requirements:{...empty,host:[{capabilityId:'hub.mcp',versionRange:'^1.0.0',required:true}],mcp:[{endpointRef:{service:'knowledge',domain:'knowledge'},required:true}],content:[{kind:'skill',identity:'provider',versionRange:'^1.0.0',required:true}]}}
const provider:HubRequirementContent={kind:'skill',identity:'provider',version:'1.1.0',enabled:true}
describe('complete enabled Hub requirements',()=>{
 it('accepts a satisfiable collection',()=>expect(()=>verifyHubRequirements([consumer,provider],target)).not.toThrow())
 it.each([[],[{...provider,enabled:false}],[{...provider,version:'2.0.0'}]].map(deps=>({deps})))('blocks removal, disabling and incompatible dependency versions',({deps})=>expect(()=>verifyHubRequirements([consumer,...deps],target)).toThrow('Required enabled content'))
 it('rejects missing endpoint and Host version capabilities',()=>{expect(()=>verifyHubRequirements([consumer,provider],{hostCapabilities:target.hostCapabilities.slice(0,2)})).toThrow('MCP endpoint');expect(()=>verifyHubRequirements([consumer,provider],{hostCapabilities:['hub.requirements.v1','hub.mcp@2.0.0']})).toThrow('Host capability')})
 it('detects cycles and accepts missing optional dependencies',()=>{expect(()=>verifyHubRequirements([consumer,{...provider,requirements:{...empty,content:[{kind:'skill',identity:'consumer',versionRange:'*',required:true}]}}],target)).toThrow('Cyclic');expect(()=>verifyHubRequirements([{...consumer,requirements:{...empty,content:[{kind:'skill',identity:'missing',versionRange:'*',required:false}]}}],target)).not.toThrow()})
 it('rejects inline routes, credentials and duplicate identity declarations',()=>{expect(()=>HubRequirementsSchema.parse({...empty,mcp:[{endpointRef:{service:'knowledge',domain:'knowledge',url:'https://example.org'},required:true}]})).toThrow();expect(()=>HubRequirementsSchema.parse({...empty,token:'secret'})).toThrow();expect(()=>HubRequirementsSchema.parse({...empty,content:[...consumer.requirements!.content,...consumer.requirements!.content]})).toThrow()})
})

it('preserves Knowledge provenance only in skill 1.2 and rejects unsigned extra source fields',()=>{
 const source={kind:'knowledge-shared-skill',origin:'https://knowledge.hozonauto.com/api',sourceId:randomUUID(),knowledgeTenantId:randomUUID(),publisherSsoSub:randomUUID(),name:'shared-note',version:1,sha256:'a'.repeat(64),byteSize:120,readerScope:{kind:'tenant',ssoTenantId:randomUUID()},exportedAt:'2026-10-21T00:00:00Z',authorization:'publisher-snapshot-v1'}
 const manifest={schemaVersion:'1.2',tenantId:randomUUID(),skillId:randomUUID(),releaseId:randomUUID(),kind:'skill',fileManifestDigest:'b'.repeat(64),installName:'shared-note',version:'1.0.0',artifact:{sha256:'c'.repeat(64),bytes:120,format:'zip'},compatibility:{sensteed:'*',testedTargets:[]},accessDeclaration:{containsScripts:false,networkHosts:[],fileAccess:'none'},issuedAt:'2026-10-21T00:00:00Z',requirements:empty,source}
 expect(SkillManifestSchema.parse(manifest).source).toEqual(source)
 expect(()=>SkillManifestSchema.parse({...manifest,schemaVersion:'1.1'})).toThrow()
 expect(()=>SkillManifestSchema.parse({...manifest,source:{...source,token:'not-permitted'}})).toThrow()
})
