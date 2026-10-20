import {describe,it,expect,afterEach,vi} from 'vitest'
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {downloadDesktopV2Artifact} from '../src/desktop-update-v2-download.ts'
import type {UpdateArtifactRequest} from '../src/update-download.ts'
import type {DesktopV2Artifact} from '../src/desktop-update-v2.ts'
const roots:string[]=[]
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
async function setup(){const root=await mkdtemp(join(tmpdir(),'exact-update-'));roots.push(root);const bytes=Buffer.from([80,75,3,4,1,2,3,4]),id='00000000-0000-4000-8000-000000000002';const artifact:DesktopV2Artifact={id,os:'win32',arch:'x64',format:'zip',installationMode:'portable',sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,downloadPath:`/api/desktop/v2/artifacts/${id}/download`};return {root,bytes,artifact,destinationPath:join(root,'update.zip'),signal:new AbortController().signal}}
describe('verified exact artifact download',()=>{
 it('downloads the fixed artifact with no credential header',async()=>{const x=await setup(),request=vi.fn<UpdateArtifactRequest>(async()=>({response:new Response(x.bytes),finalUrl:'https://ai.hozonauto.com/content'}));await downloadDesktopV2Artifact({...x,request});expect(await readFile(x.destinationPath)).toEqual(x.bytes);expect(request.mock.calls[0]?.[0]).toBe(`https://ai.hozonauto.com${x.artifact.downloadPath}`);expect(new Headers(request.mock.calls[0]?.[1]?.headers).has('authorization')).toBe(false)})
 it.each(['digest','length','format'])('preserves the old destination and removes partials on %s failure',async fault=>{const x=await setup();await writeFile(x.destinationPath,'old');const bytes=fault==='format'?Buffer.from('badformat'):x.bytes;if(fault==='digest')x.artifact.sha256='a'.repeat(64);if(fault==='length')x.artifact.bytes++;if(fault==='format'){x.artifact.bytes=bytes.length;x.artifact.sha256=createHash('sha256').update(bytes).digest('hex')}await expect(downloadDesktopV2Artifact({...x,request:async()=>({response:new Response(bytes),finalUrl:'https://ai.hozonauto.com/content'})})).rejects.toThrow();expect(await readFile(x.destinationPath,'utf8')).toBe('old');expect(await readdir(x.root)).toEqual(['update.zip'])})
})
