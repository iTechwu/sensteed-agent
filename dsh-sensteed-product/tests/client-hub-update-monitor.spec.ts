import { afterEach,expect,it,vi } from 'vitest'
import { createHubUpdateMonitor,HUB_UPDATE_INTERVAL_MS,hubUpdateNotice } from '../src/client/hub-update-monitor.ts'
import type { HubCheck } from '../src/client/hub-setup-state.ts'
const row={kind:'skill' as const,itemId:'one',displayName:'One',version:'1',required:true,initialInstall:true,enabled:true,disposition:'INSTALL',reason:null,bytes:1}
const snapshot:HubCheck={profileId:'p',activeGenerationDigest:null,entries:[row],activeItems:[]}
afterEach(()=>vi.useRealTimers())
it('derives eligible additions/updates/restart from authoritative dispositions, never display versions',()=>{
 expect(hubUpdateNotice(snapshot)).toEqual({updates:0,additions:1,restart:false})
 for(const disposition of ['SOURCE','UNVERIFIED_TARGET','NO_RELEASE','USER_REMOVED'])expect(hubUpdateNotice({...snapshot,entries:[{...row,disposition}]})).toBeUndefined()
 expect(hubUpdateNotice({...snapshot,entries:[{...row,required:false,initialInstall:false}]})).toBeUndefined()
 expect(hubUpdateNotice({...snapshot,activeItems:[row],entries:[{...row,version:'999',disposition:'CURRENT'}]})).toBeUndefined()
 expect(hubUpdateNotice({...snapshot,activeItems:[row],entries:[{...row,disposition:'UPDATE'}]})).toEqual({updates:1,additions:0,restart:false})
 expect(hubUpdateNotice({...snapshot,entries:[],operation:{operationId:'o',state:'STAGED',restartReady:true}})?.restart).toBe(true)
 expect(hubUpdateNotice({...snapshot,entries:[],operation:{operationId:'o',state:'ACTIVATED',restartRequired:true}})).toBeUndefined()
})
it('checks after login then waits five minutes after settlement; cancels timer and in-flight request on disposal',async()=>{
 vi.useFakeTimers();const request=vi.fn(async()=>snapshot),publish=vi.fn();const monitor=createHubUpdateMonitor(request,publish)
 monitor.account(undefined);expect(request).not.toHaveBeenCalled();monitor.account('alice');await Promise.resolve();expect(request).toHaveBeenCalledTimes(1)
 await vi.advanceTimersByTimeAsync(HUB_UPDATE_INTERVAL_MS-1);expect(request).toHaveBeenCalledTimes(1)
 await vi.advanceTimersByTimeAsync(1);expect(request).toHaveBeenCalledTimes(2);monitor.dispose();expect(publish).toHaveBeenLastCalledWith(undefined)
 await vi.advanceTimersByTimeAsync(HUB_UPDATE_INTERVAL_MS*2);expect(request).toHaveBeenCalledTimes(2)
})
it('folds reconnects, prevents overlap, aborts old identity and discards late responses',async()=>{
 vi.useFakeTimers();const pending:{signal:AbortSignal;resolve:(value:HubCheck)=>void}[]=[]
 const request=vi.fn((signal:AbortSignal)=>new Promise<HubCheck>(resolve=>pending.push({signal,resolve}))),publish=vi.fn();const monitor=createHubUpdateMonitor(request,publish)
 monitor.account('alice');monitor.reconnect();monitor.reconnect();monitor.account('bob');expect(request).toHaveBeenCalledTimes(1);expect(pending[0]!.signal.aborted).toBe(true)
 pending[0]!.resolve(snapshot);await Promise.resolve();await Promise.resolve();expect(request).toHaveBeenCalledTimes(2);expect(publish).not.toHaveBeenCalledWith({updates:0,additions:1,restart:false})
 pending[1]!.resolve({...snapshot,entries:[]});await Promise.resolve();monitor.account(undefined);expect(publish).toHaveBeenLastCalledWith(undefined)
 await vi.advanceTimersByTimeAsync(HUB_UPDATE_INTERVAL_MS);expect(request).toHaveBeenCalledTimes(2);monitor.dispose()
})
it('clears stale availability on offline or revoked checks; never initiates a write',async()=>{
 const publish=vi.fn(),request=vi.fn().mockResolvedValueOnce(snapshot).mockRejectedValueOnce(Error('revoked'));const monitor=createHubUpdateMonitor(request,publish)
 monitor.account('alice');await Promise.resolve();monitor.reconnect();await Promise.resolve();expect(publish).toHaveBeenLastCalledWith(undefined);monitor.dispose()
})
