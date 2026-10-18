/** Read-only signed snapshot projection. Never compares display versions or prepares an intent. */
import { hubBlocked, hubKey, hubTerminal, type HubCheck } from './hub-setup-state.ts'
export interface HubUpdateNotice { updates:number; additions:number; restart:boolean }
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
export function createHubUpdateMonitor(request:(signal:AbortSignal)=>Promise<HubCheck>,publish:(notice:HubUpdateNotice|undefined)=>void,random:()=>number=Math.random){
 let failures=0
 let account:string|undefined,epoch=0,disposed=false,inflight=false,queued=false,controller:AbortController|undefined,timer:ReturnType<typeof setTimeout>|undefined
 const clearTimer=()=>{clearTimeout(timer);timer=undefined}
 const check=async()=>{
  if(disposed||!account)return
  if(inflight){queued=true;return}
  clearTimer();inflight=true;queued=false
  const generation=epoch,abort=new AbortController();controller=abort
  try{const result=await request(abort.signal);if(!disposed&&generation===epoch&&!abort.signal.aborted){failures=0;publish(hubUpdateNotice(result))}}
  catch{if(!disposed&&generation===epoch&&!abort.signal.aborted){failures++;publish(undefined)}}
  finally{inflight=false;if(controller===abort)controller=undefined;if(!disposed&&account){if(queued)void check();else timer=setTimeout(()=>void check(),hubUpdateDelay(failures,random))}}
 }
 return {
  account(value:string|undefined){if(account===value||disposed)return;account=value;failures=0;epoch++;queued=false;clearTimer();controller?.abort();publish(undefined);if(value)void check()},
  reconnect(){if(disposed)return;failures=0;epoch++;clearTimer();controller?.abort();publish(undefined);void check()},
  dispose(){disposed=true;epoch++;clearTimer();controller?.abort();publish(undefined)},
 }
}
