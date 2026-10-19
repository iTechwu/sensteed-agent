import { afterEach,expect,it,vi } from 'vitest'
import { createHubUpdateMonitor,HUB_UPDATE_INTERVAL_MS,HUB_UPDATE_MAX_DELAY_MS,hubUpdateDelay,hubUpdateNotice } from '../src/client/hub-update-monitor.ts'
import type { HubCheck } from '../src/client/hub-setup-state.ts'
const row={kind:'skill' as const,itemId:'one',displayName:'One',version:'1',required:true,initialInstall:true,enabled:true,disposition:'INSTALL',reason:null,bytes:1}
const snapshot:HubCheck={channel:'stable',profileId:'p',activeGenerationDigest:null,entries:[row],activeItems:[]}
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
it('checks after login then waits fifteen minutes after settlement; cancels timer and in-flight request on disposal',async()=>{
 vi.useFakeTimers();const request=vi.fn(async()=>snapshot),publish=vi.fn();const monitor=createHubUpdateMonitor(request,publish,()=>0.5)
 monitor.account(undefined);expect(request).not.toHaveBeenCalled();monitor.account('alice');await Promise.resolve();expect(request).toHaveBeenCalledTimes(1)
 await vi.advanceTimersByTimeAsync(HUB_UPDATE_INTERVAL_MS-1);expect(request).toHaveBeenCalledTimes(1)
 await vi.advanceTimersByTimeAsync(1);expect(request).toHaveBeenCalledTimes(2);monitor.dispose();expect(publish).toHaveBeenLastCalledWith(undefined)
 await vi.advanceTimersByTimeAsync(HUB_UPDATE_INTERVAL_MS*2);expect(request).toHaveBeenCalledTimes(2)
})
it('folds reconnects, prevents overlap, aborts old identity and discards late responses',async()=>{
 vi.useFakeTimers();const pending:{signal:AbortSignal;resolve:(value:HubCheck)=>void}[]=[]
 const request=vi.fn((signal:AbortSignal)=>new Promise<HubCheck>(resolve=>pending.push({signal,resolve}))),publish=vi.fn();const monitor=createHubUpdateMonitor(request,publish,()=>0.5)
 monitor.account('alice');monitor.reconnect();monitor.reconnect();monitor.account('bob');expect(request).toHaveBeenCalledTimes(1);expect(pending[0]!.signal.aborted).toBe(true)
 pending[0]!.resolve(snapshot);await Promise.resolve();await Promise.resolve();expect(request).toHaveBeenCalledTimes(2);expect(publish).not.toHaveBeenCalledWith({updates:0,additions:1,restart:false})
 pending[1]!.resolve({...snapshot,entries:[]});await Promise.resolve();monitor.account(undefined);expect(publish).toHaveBeenLastCalledWith(undefined)
 await vi.advanceTimersByTimeAsync(HUB_UPDATE_INTERVAL_MS);expect(request).toHaveBeenCalledTimes(2);monitor.dispose()
})
it('clears stale availability on offline or revoked checks; never initiates a write',async()=>{
 const publish=vi.fn(),request=vi.fn().mockResolvedValueOnce(snapshot).mockRejectedValueOnce(Error('revoked'));const monitor=createHubUpdateMonitor(request,publish,()=>0.5)
 monitor.account('alice');await Promise.resolve();monitor.reconnect();await Promise.resolve();expect(publish).toHaveBeenLastCalledWith(undefined);monitor.dispose()
})

it('jitter and exponential error backoff obey 12–18 minute normal and one-hour maximum bounds',()=>{
 const minute=60000
 expect(hubUpdateDelay(0,()=>0)).toBe(12*minute);expect(hubUpdateDelay(0,()=>1)).toBe(18*minute)
 expect(hubUpdateDelay(1,()=>0)).toBe(24*minute);expect(hubUpdateDelay(1,()=>1)).toBe(36*minute)
 expect(hubUpdateDelay(2,()=>0)).toBe(48*minute);expect(hubUpdateDelay(2,()=>1)).toBe(HUB_UPDATE_MAX_DELAY_MS)
 expect(hubUpdateDelay(1000,()=>1)).toBe(HUB_UPDATE_MAX_DELAY_MS)
})
it('backs off consecutive failures, clears old notices and resets after success',async()=>{
 vi.useFakeTimers();const request=vi.fn().mockRejectedValueOnce(Error('offline')).mockRejectedValueOnce(Error('offline')).mockResolvedValue(snapshot),publish=vi.fn()
 const monitor=createHubUpdateMonitor(request,publish,()=>0.5);monitor.account('alice');await Promise.resolve();await Promise.resolve()
 expect(publish).toHaveBeenLastCalledWith(undefined)
 await vi.advanceTimersByTimeAsync(30*60000-1);expect(request).toHaveBeenCalledTimes(1)
 await vi.advanceTimersByTimeAsync(1);expect(request).toHaveBeenCalledTimes(2)
 await vi.advanceTimersByTimeAsync(60*60000);expect(request).toHaveBeenCalledTimes(3)
 await vi.advanceTimersByTimeAsync(15*60000);expect(request).toHaveBeenCalledTimes(4);monitor.dispose()
})
