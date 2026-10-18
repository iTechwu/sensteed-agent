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
export const HUB_UPDATE_INTERVAL_MS=5*60*1000
/** One in-flight request across account changes, reconnects and timers; late responses cannot restore old identity data. */
export function createHubUpdateMonitor(request:(signal:AbortSignal)=>Promise<HubCheck>,publish:(notice:HubUpdateNotice|undefined)=>void){
 let account:string|undefined,epoch=0,disposed=false,inflight=false,queued=false,controller:AbortController|undefined,timer:ReturnType<typeof setTimeout>|undefined
 const clearTimer=()=>{clearTimeout(timer);timer=undefined}
 const check=async()=>{
  if(disposed||!account)return
  if(inflight){queued=true;return}
  clearTimer();inflight=true;queued=false
  const generation=epoch,abort=new AbortController();controller=abort
  try{const result=await request(abort.signal);if(!disposed&&generation===epoch&&!abort.signal.aborted)publish(hubUpdateNotice(result))}
  catch{if(!disposed&&generation===epoch)publish(undefined)}
  finally{inflight=false;if(controller===abort)controller=undefined;if(!disposed&&account){if(queued)void check();else timer=setTimeout(()=>void check(),HUB_UPDATE_INTERVAL_MS)}}
 }
 return {
  account(value:string|undefined){if(account===value||disposed)return;account=value;epoch++;queued=false;clearTimer();controller?.abort();publish(undefined);if(value)void check()},
  reconnect(){if(disposed)return;epoch++;clearTimer();controller?.abort();publish(undefined);void check()},
  dispose(){disposed=true;epoch++;clearTimer();controller?.abort();publish(undefined)},
 }
}
