// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { HubSetupSection } from '../src/client/HubSetupSection.tsx'
import { DOFE_ACCESS_COPY } from '../src/client/dofe-access.ts'
let root:Root|undefined,container:HTMLDivElement
const item={kind:'skill',itemId:'11111111-1111-4111-8111-111111111111',displayName:'Required skill',version:'1.0.0',required:true,initialInstall:true,enabled:true,disposition:'INSTALL',reason:null,bytes:123}
const check={profileId:'profile',activeGenerationDigest:null,entries:[item],activeItems:[]}
const plan={intentId:'intent',confirmationNonce:'single-use',planDigest:'digest',expiresAt:new Date(Date.now()+300000).toISOString(),totalBytes:123,items:[{...item,action:'install',accessDeclaration:{containsScripts:false,fileAccess:'none',networkHosts:[]}}]}
async function mount(){vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root!.render(createElement(HubSetupSection,{t:key=>DOFE_ACCESS_COPY.zh[key]})))}
async function click(text:string){await act(async()=>{const button=[...container.querySelectorAll('button')].find(b=>b.textContent===text);expect(button).toBeTruthy();button!.click()})}
afterEach(async()=>{await act(async()=>root?.unmount());container?.remove();vi.unstubAllGlobals();vi.useRealTimers()})
it('shows required blocked evidence and prevents preview without claiming installation',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({...check,entries:[{...item,disposition:'UNVERIFIED_TARGET',reason:'No trusted proof'}]})))
 await mount();expect(container.textContent).toContain('No trusted proof');expect(container.textContent).toContain(DOFE_ACCESS_COPY.zh.hubRequiredBlocked)
 expect([...container.querySelectorAll('button')].find(b=>b.textContent===DOFE_ACCESS_COPY.zh.hubPreview)?.disabled).toBe(true)
})
it('sends complete selection, displays unknown permissions and consumes execute nonce once even on lost response',async()=>{
 const fetcher=vi.fn(async(path:string,options:RequestInit)=>{if(path.endsWith('/check'))return Response.json(check);if(path.endsWith('/preview'))return Response.json(plan);if(path.endsWith('/execute'))throw Error('connection lost');return Response.json({})});vi.stubGlobal('fetch',fetcher)
 await mount();await click(DOFE_ACCESS_COPY.zh.hubPreview)
 const request=fetcher.mock.calls.find(([path])=>path.endsWith('/preview'))!;expect(JSON.parse(request[1].body as string)).toEqual({channel:'stable',requested:[{kind:'skill',itemId:item.itemId,action:'install',enabled:true}]})
 expect(container.textContent).toContain(DOFE_ACCESS_COPY.zh.hubPermissions)
 await click(DOFE_ACCESS_COPY.zh.hubExecute)
 expect(fetcher.mock.calls.filter(([p])=>p.endsWith('/execute'))).toHaveLength(1)
 expect(container.textContent).toContain(DOFE_ACCESS_COPY.zh.hubConnectionRecovering)
 expect([...container.querySelectorAll('button')].some(b=>b.textContent===DOFE_ACCESS_COPY.zh.hubExecute)).toBe(false)
})
it('shows restart only after actual Host status permits it and recovers via check after disconnect',async()=>{
 vi.useFakeTimers();let restarted=false
 const fetcher=vi.fn(async(path:string)=>{if(path.endsWith('/restart')){restarted=true;throw Error('Host switch')};if(path.endsWith('/status'))return Response.json({operationId:'operation',state:'STAGED',restartReady:true,restartRequired:true});return Response.json({...check,operation:{operationId:'operation',state:restarted?'ACTIVATED':'STAGED',restartReady:!restarted,restartRequired:!restarted}})});vi.stubGlobal('fetch',fetcher)
 await mount();await click(DOFE_ACCESS_COPY.zh.hubRestart)
 await act(async()=>vi.advanceTimersByTimeAsync(3000))
 expect(fetcher.mock.calls.filter(([p])=>p.endsWith('/restart'))).toHaveLength(1)
 expect(container.textContent).toContain('ACTIVATED')
 expect([...container.querySelectorAll('button')].some(b=>b.textContent===DOFE_ACCESS_COPY.zh.hubRestart)).toBe(false)
})
it('clearly reports an unavailable base service',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>Response.json({available:false,reason:'BASE_VERSION_NOT_ENABLED'})));await mount();expect(container.textContent).toContain(DOFE_ACCESS_COPY.zh.hubUnavailable)})

it('blocks confirmation when a new install lacks signed access declarations',async()=>{vi.stubGlobal('fetch',vi.fn(async(path:string)=>Response.json(path.endsWith('/check')?check:{...plan,items:[{...item,action:'install'}]})));await mount();await click(DOFE_ACCESS_COPY.zh.hubPreview);expect(container.textContent).toContain(DOFE_ACCESS_COPY.zh.hubPermissionUnknown);expect([...container.querySelectorAll('button')].find(b=>b.textContent===DOFE_ACCESS_COPY.zh.hubExecute)?.disabled).toBe(true)})
