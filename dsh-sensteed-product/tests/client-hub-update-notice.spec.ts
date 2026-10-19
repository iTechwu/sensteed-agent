// @vitest-environment jsdom
import { act,createElement } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { afterEach,expect,it,vi } from 'vitest'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DofeAccessSettings } from '../src/dofe-plugins.ts'
import { HubUpdateNotice } from '../src/client/HubUpdateNotice.tsx'
import { DOFE_ACCESS_COPY } from '../src/client/dofe-access.ts'
let root:Root|undefined,node:HTMLDivElement
const row={kind:'skill',itemId:'one',displayName:'One',version:'1',required:true,initialInstall:true,enabled:true,disposition:'INSTALL',reason:null,bytes:1}
const snapshot={channel:'stable',profileId:'p',activeGenerationDigest:null,entries:[row],activeItems:[]}
afterEach(async()=>{await act(async()=>root?.unmount());node?.remove();vi.unstubAllGlobals()})
function harness(){
 let account:string|undefined='alice';const listeners=new Set<()=>void>();let reconnect=()=>{}
 const settingsScope={getSnapshot:()=>({value:{authMode:'feishu',identity:account?{ssoSub:account}:undefined}}),subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>listeners.delete(fn)}} as unknown as ConfigForm<DofeAccessSettings>
 return{settingsScope,subscribeReconnect:(fn:()=>void)=>{reconnect=fn;return()=>{reconnect=()=>{}}},account(value:string|undefined){account=value;for(const fn of listeners)fn()},reconnect(){reconnect()}}
}
async function mount(h:ReturnType<typeof harness>){vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);node=document.createElement('div');document.body.append(node);root=createRoot(node);await act(async()=>root!.render(createElement(HubUpdateNotice,{...h,t:key=>DOFE_ACCESS_COPY.zh[key]})))}
it('checks without opening Settings, opens the actual setup editor, and clears it on logout',async()=>{
 const fetcher=vi.fn(async(_path:string)=>Response.json(snapshot));vi.stubGlobal('fetch',fetcher);const h=harness();await mount(h)
 expect(fetcher).toHaveBeenCalledTimes(1);expect(node.querySelector('[role="status"]')).not.toBeNull();expect(node.querySelector('dialog')).toBeNull()
 await act(async()=>node.querySelector('button')!.click());expect(node.querySelector('dialog')).not.toBeNull();expect(node.textContent).toContain(DOFE_ACCESS_COPY.zh.catalogTab)
 expect(fetcher.mock.calls.every(call=>String(call[0]).endsWith('/check'))).toBe(true)
 await act(async()=>h.account(undefined));expect(node.textContent).toBe('')
})
it('aborts account-bound requests on reconnect and unmount, without displaying a stale update',async()=>{
 const requests:{signal:AbortSignal;resolve:(response:Response)=>void}[]=[]
 vi.stubGlobal('fetch',vi.fn((_url:string,options:RequestInit)=>new Promise<Response>(resolve=>requests.push({signal:options.signal as AbortSignal,resolve}))))
 const h=harness();await mount(h);await act(async()=>h.account('bob'));expect(requests[0]!.signal.aborted).toBe(true)
 await act(async()=>requests[0]!.resolve(Response.json(snapshot)));expect(node.textContent).toBe('');expect(requests).toHaveLength(2)
 await act(async()=>h.reconnect());expect(requests[1]!.signal.aborted).toBe(true)
 await act(async()=>root!.unmount());root=undefined
 await act(async()=>requests[1]!.resolve(Response.json(snapshot)));expect(requests).toHaveLength(2)
})
