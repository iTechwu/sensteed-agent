/** Read-only signed snapshot projection. Never compares display versions or prepares an intent. */
import { hubBlocked, hubKey, hubTerminal, type HubCheck } from './hub-setup-state.ts'
import { HUB_UPDATES_PATH } from '../hub-update-contract.ts'
export interface HubPublishedUpdate { kind:'skill'|'plugin'; itemId:string; displayName:string; version:string }
export interface HubUpdateNotice { updates:number; additions:number; restart:boolean }
function parsePublishedUpdates(value:unknown):HubPublishedUpdate[]{
 if(!value||typeof value!=='object'||Array.isArray(value))return []
 const rows=(value as {updates?:unknown}).updates
 if(!Array.isArray(rows))return []
 return rows.filter((row):row is HubPublishedUpdate=>!!row&&typeof row==='object'&&!Array.isArray(row)
  &&((row as Record<string,unknown>).kind==='skill'||(row as Record<string,unknown>).kind==='plugin')
  &&typeof (row as Record<string,unknown>).itemId==='string'
  &&typeof (row as Record<string,unknown>).displayName==='string'
  &&typeof (row as Record<string,unknown>).version==='string')
}
export async function hubUpdateRequest(signal?:AbortSignal):Promise<HubPublishedUpdate[]>{
 const requestSignal=signal===undefined?AbortSignal.timeout(15_000):AbortSignal.any([signal,AbortSignal.timeout(15_000)])
 const response=await fetch(HUB_UPDATES_PATH,{method:'GET',credentials:'same-origin',redirect:'error',signal:requestSignal,headers:{Accept:'application/json'}})
 if(!response.ok)throw Object.assign(new Error(`Hub update request failed (${response.status})`),{status:response.status})
 return parsePublishedUpdates(await response.json())
}
export function hubUpdateNotice(check:HubCheck):HubUpdateNotice|undefined {
 const active=new Set(check.activeItems.map(hubKey))
 const updates=check.entries.filter(row=>active.has(hubKey(row))&&row.disposition==='UPDATE').length
 const additions=check.entries.filter(row=>!active.has(hubKey(row))&&(row.required||row.initialInstall)&&row.disposition!=='USER_REMOVED'&&!hubBlocked(row)).length
 const restart=!hubTerminal(check.operation)&&!!(check.operation?.restartReady||check.operation?.restartRequired)
 return updates||additions||restart?{updates,additions,restart}:undefined
}
export const HUB_UPDATE_INTERVAL_MS=15*60*1000
export const HUB_UPDATE_MAX_DELAY_MS=60*60*1000
/** Normal checks jitter ±20%; failures double the base delay, bounded at one hour. */
export function hubUpdateDelay(failures:number,random:()=>number=Math.random):number {
 const base=HUB_UPDATE_INTERVAL_MS*2**Math.min(Math.max(failures,0),2)
 return Math.min(HUB_UPDATE_MAX_DELAY_MS,Math.round(base*(0.8+Math.max(0,Math.min(1,random()))*0.4)))
}
/** One in-flight request across account changes, reconnects and timers; late responses cannot restore old identity data. */
export function createHubUpdateMonitor(request:(signal:AbortSignal)=>Promise<HubCheck|HubPublishedUpdate[]>,publish:(value:HubUpdateNotice|HubPublishedUpdate[]|undefined)=>void,random?:()=>number){
 const jitter=random ?? Math.random
 let failures=0
 let account:string|undefined,epoch=0,disposed=false,inflight=false,queued=false,controller:AbortController|undefined,timer:ReturnType<typeof setTimeout>|undefined
 const clearTimer=()=>{clearTimeout(timer);timer=undefined}
 const check=async()=>{
  if(disposed||!account)return
  if(inflight){queued=true;return}
  clearTimer();inflight=true;queued=false
  const generation=epoch,abort=new AbortController();controller=abort
  try{const result=await request(abort.signal);if(!disposed&&generation===epoch&&!abort.signal.aborted){failures=0;publish(Array.isArray(result)?result:hubUpdateNotice(result))}}
  catch{if(!disposed&&generation===epoch&&!abort.signal.aborted){failures++;publish(undefined)}}
  finally{inflight=false;if(controller===abort)controller=undefined;if(!disposed&&account){if(queued)void check();else timer=setTimeout(()=>void check(),hubUpdateDelay(failures,jitter))}}
 }
 return {
  account(value:string|undefined){if(account===value||disposed)return;account=value;failures=0;epoch++;queued=false;clearTimer();controller?.abort();publish(undefined);if(value)void check()},
  reconnect(){if(disposed)return;failures=0;epoch++;clearTimer();controller?.abort();publish(undefined);void check()},
  dispose(){disposed=true;epoch++;clearTimer();controller?.abort();publish(undefined)},
 }
}
