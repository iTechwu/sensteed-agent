// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DofeAccessSettings } from '../src/dofe-plugins.ts'
import { HubSetupSection } from '../src/client/HubSetupSection.tsx'
import { DOFE_ACCESS_COPY } from '../src/client/dofe-access.ts'
let root:Root|undefined,container:HTMLDivElement
const item={kind:'skill',itemId:'11111111-1111-4111-8111-111111111111',displayName:'Required skill',version:'1.0.0',required:true,initialInstall:true,enabled:true,disposition:'INSTALL',reason:null,bytes:123}
const check={channel:'stable',profileId:'profile',activeGenerationDigest:null,entries:[item],activeItems:[]}
const plan={intentId:'intent',confirmationNonce:'single-use',planDigest:'digest',expiresAt:new Date(Date.now()+300000).toISOString(),totalBytes:123,items:[{...item,action:'install',accessDeclaration:{containsScripts:false,fileAccess:'none',networkHosts:[]}}]}
async function mount(settingsScope?:ConfigForm<DofeAccessSettings>,subscribeReconnect?:(fn:()=>void)=>()=>void){vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root!.render(createElement(HubSetupSection,{t:key=>DOFE_ACCESS_COPY.zh[key],...(settingsScope?{settingsScope}:{}),...(subscribeReconnect?{subscribeReconnect}:{})})))}
async function click(text:string){await act(async()=>{const button=[...container.querySelectorAll('button')].find(b=>b.textContent===text);expect(button).toBeTruthy();button!.click()})}
afterEach(async()=>{await act(async()=>root?.unmount());container?.remove();vi.unstubAllGlobals();vi.useRealTimers()})
it('shows required blocked evidence and prevents preview without claiming installation',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({...check,entries:[{...item,disposition:'UNVERIFIED_TARGET',reason:'No trusted proof'}]})))
 await mount();expect(container.textContent).toContain('No trusted proof');expect(container.textContent).toContain(DOFE_ACCESS_COPY.zh.hubRequiredBlocked)
 expect([...container.querySelectorAll('button')].find(b=>b.textContent===DOFE_ACCESS_COPY.zh.hubPreview)?.disabled).toBe(true)
})
it('sends complete selection, displays unknown permissions and consumes execute nonce once even on lost response',async()=>{
 const fetcher=vi.fn(async(path:string,_options:RequestInit)=>{if(path.endsWith('/check'))return Response.json(check);if(path.endsWith('/preview'))return Response.json(plan);if(path.endsWith('/execute'))throw Error('connection lost');return Response.json({})});vi.stubGlobal('fetch',fetcher)
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

it('uses the verified Profile beta channel without guessing from version or channelRevision',async()=>{
 const fetcher=vi.fn(async(path:string,_options:RequestInit)=>Response.json(path.endsWith('/check')?{...check,channel:'beta'}:plan));vi.stubGlobal('fetch',fetcher)
 await mount();await click(DOFE_ACCESS_COPY.zh.hubPreview)
 expect(JSON.parse(fetcher.mock.calls.find(([path])=>path.endsWith('/check'))![1].body as string)).toEqual({})
 expect(JSON.parse(fetcher.mock.calls.find(([path])=>path.endsWith('/preview'))![1].body as string).channel).toBe('beta')
})
it('fails closed when an older Host omits the actual channel',async()=>{
 const {channel:_,...oldCheck}=check;vi.stubGlobal('fetch',vi.fn(async()=>Response.json(oldCheck)));await mount()
 expect(container.textContent).toContain(DOFE_ACCESS_COPY.zh.hubRequestFailed)
 expect([...container.querySelectorAll('button')].some(b=>b.textContent===DOFE_ACCESS_COPY.zh.hubPreview)).toBe(false)
})
it('never overlaps slow status polls',async()=>{
 vi.useFakeTimers();let resolveStatus:((response:Response)=>void)|undefined
 const fetcher=vi.fn(async(path:string)=>{if(path.endsWith('/status'))return new Promise<Response>(resolve=>{resolveStatus=resolve});return Response.json({...check,operation:{operationId:'operation',state:'STAGED',restartRequired:true}})});vi.stubGlobal('fetch',fetcher)
 // Initial refresh requests one status before the periodic poll can begin.
 await mount();expect(fetcher.mock.calls.filter(([p])=>p.endsWith('/status'))).toHaveLength(1)
 await act(async()=>resolveStatus!(Response.json({operationId:'operation',state:'STAGED',restartRequired:true})))
 await act(async()=>vi.advanceTimersByTimeAsync(9000));expect(fetcher.mock.calls.filter(([p])=>p.endsWith('/status'))).toHaveLength(2)
 await act(async()=>resolveStatus!(Response.json({operationId:'operation',state:'ACTIVATED'})))
})

it('clears the actual Settings editor and its nonce on account changes, without requiring the banner',async()=>{
 let account:string|undefined='alice';const listeners=new Set<()=>void>()
 const settingsScope={getSnapshot:()=>({value:{authMode:'feishu',identity:account?{ssoSub:account}:undefined}}),subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>listeners.delete(fn)}} as unknown as ConfigForm<DofeAccessSettings>
 const fetcher=vi.fn(async(path:string)=>Response.json(path.endsWith('/check')?{...check,entries:[{...item,displayName:account}]}:plan));vi.stubGlobal('fetch',fetcher)
 await mount(settingsScope);await click(DOFE_ACCESS_COPY.zh.hubPreview);expect(container.textContent).toContain(plan.planDigest)
 await act(async()=>{account='bob';for(const listener of listeners)listener()})
 expect(container.textContent).toContain('bob');expect(container.textContent).not.toContain(plan.planDigest)
 expect(fetcher.mock.calls.filter(([p])=>p.endsWith('/check'))).toHaveLength(2)
 await act(async()=>{account=undefined;for(const listener of listeners)listener()})
 expect(container.textContent).toContain(DOFE_ACCESS_COPY.zh.settingsLoginRequired)
 expect(fetcher.mock.calls.filter(([p])=>p.endsWith('/check'))).toHaveLength(2)
})
it('does not let an older refresh status overwrite a newer explicit check',async()=>{
 let checks=0,resolveStatus:((value:Response)=>void)|undefined
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{if(path.endsWith('/status'))return new Promise<Response>(resolve=>{resolveStatus=resolve});return Response.json({...check,operation:{operationId:'operation',state:++checks===1?'STAGED':'ACTIVATED'}})}))
 await mount();await click(DOFE_ACCESS_COPY.zh.hubCheck);expect(container.textContent).toContain('ACTIVATED')
 await act(async()=>resolveStatus!(Response.json({operationId:'operation',state:'STAGED',restartReady:true})))
 expect(container.textContent).toContain('ACTIVATED');expect([...container.querySelectorAll('button')].some(b=>b.textContent===DOFE_ACCESS_COPY.zh.hubRestart)).toBe(false)
})

it('drops stale Profile/channel previews and checks again after a Host reconnect',async()=>{
 let reconnect=()=>{},checks=0
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>Response.json(path.endsWith('/check')?{...check,channel:++checks===1?'stable':'beta'}:plan)))
 await mount(undefined,listener=>{reconnect=listener;return()=>{reconnect=()=>{}}});await click(DOFE_ACCESS_COPY.zh.hubPreview)
 expect(container.textContent).toContain(plan.planDigest)
 await act(async()=>reconnect());expect(checks).toBe(2);expect(container.textContent).toContain('beta');expect(container.textContent).not.toContain(plan.planDigest)
})
