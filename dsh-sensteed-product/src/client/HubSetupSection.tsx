import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DofeAccessLocaleKey } from './dofe-access.ts'
import { hubBlocked, hubInitialSelections, hubKey, hubSetupRequest, hubTerminal, type HubCheck, type HubOperation, type HubPreview, type HubSelection } from './hub-setup-state.ts'
type Props={t:(key:DofeAccessLocaleKey)=>string}
export function HubSetupSection({t}:Props){
 const [check,setCheck]=useState<HubCheck>(),[selection,setSelection]=useState<HubSelection[]>([]),[preview,setPreview]=useState<HubPreview>(),[operation,setOperation]=useState<HubOperation>(),[busy,setBusy]=useState(false),[error,setError]=useState<string>(),[recovering,setRecovering]=useState(false),[clock,setClock]=useState(Date.now())
 const lock=useRef(false),intent=useRef<HubPreview>(),mounted=useRef(true),sequence=useRef(0)
 const message=(e:unknown)=>e instanceof Error&&e.message==='BASE_VERSION_NOT_ENABLED'?t('hubUnavailable'):t('hubRequestFailed')
 const refresh=useCallback(async(signal?:AbortSignal)=>{
  const epoch=++sequence.current
  const value=await hubSetupRequest<HubCheck>('check',{channel:'stable'},signal)
  if(!mounted.current||epoch!==sequence.current)return
  setCheck(value);setSelection(hubInitialSelections(value));intent.current=undefined;setPreview(undefined)
  let next=value.operation
  if(next&&!hubTerminal(next)){try{next=await hubSetupRequest<HubOperation>('status',{operationId:next.operationId},signal)}catch{/* The next explicit check/poll recovers the actual Host operation. */}}
  if(mounted.current){setOperation(next);setRecovering(false);setError(undefined)}
 },[])
 useEffect(()=>{mounted.current=true;const controller=new AbortController();void refresh(controller.signal).catch(e=>{if(!controller.signal.aborted)setError(message(e))});return()=>{mounted.current=false;controller.abort();intent.current=undefined}},[refresh])
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer)},[])
 useEffect(()=>{
  if(hubTerminal(operation)&&!recovering)return
  const controller=new AbortController();const timer=setInterval(()=>{if(lock.current)return
   if(recovering){void refresh(controller.signal).catch(()=>{});return}
   void hubSetupRequest<HubOperation>('status',{operationId:operation?.operationId},controller.signal).then(value=>{if(mounted.current){setOperation(value);setError(undefined)}}).catch(()=>{if(!controller.signal.aborted){setRecovering(true);setError(t('hubConnectionRecovering'))}})
  },3000)
  return()=>{clearInterval(timer);controller.abort()}
 },[operation?.operationId,operation?.state,operation?.phase,recovering,refresh])
 const run=async(action:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);try{await action()}catch(e){if(mounted.current)setError(message(e))}finally{lock.current=false;if(mounted.current)setBusy(false)}}
 const change=(item:HubSelection|{kind:'skill'|'plugin';itemId:string},action:string)=>{intent.current=undefined;setPreview(undefined);setSelection(current=>[...current.filter(i=>hubKey(i)!==hubKey(item)),...(action==='skip'?[]:[{kind:item.kind,itemId:item.itemId,action:action as HubSelection['action'],enabled:check?.activeItems.find(i=>hubKey(i)===hubKey(item))?.enabled??true}])])}
 const blocked=check?.entries.some(e=>e.required&&hubBlocked(e))??false,pending=!hubTerminal(operation),expired=preview?Date.parse(preview.expiresAt)<=clock:true,missingAccess=preview?.items.some(i=>(i.action==='install'||i.action==='update')&&!i.accessDeclaration)??false
 return <section className="dshDofeAccess" aria-labelledby="hub-setup-title">
  <h2 id="hub-setup-title">{t('hubTitle')}</h2><p>{t('hubIntro')}</p>
  {error&&<p role="alert">{error}</p>}
  <div><Button disabled={busy||recovering} onClick={()=>void run(()=>refresh())}>{busy?t('hubWorking'):t('hubCheck')}</Button></div>
  {check&&<><p>{t('hubProfile')}: <code>{check.profileId}</code> · {check.activeGenerationDigest?t('hubActive'):t('hubInitial')}</p>
   <ul style={{listStyle:'none',padding:0,display:'grid',gap:12}}>{check.entries.map(entry=>{const active=check.activeItems.some(i=>hubKey(i)===hubKey(entry)),chosen=selection.find(i=>hubKey(i)===hubKey(entry)),unavailable=hubBlocked(entry)
    return <li key={hubKey(entry)} style={{border:'1px solid var(--dsw-alias-border-l1, #ddd)',borderRadius:8,padding:12}}>
     <strong>{entry.displayName}</strong> <small>{entry.kind} · {entry.version??t('hubUnpublished')} {entry.required?`· ${t('hubRequired')}`:''}</small>
     <p>{entry.disposition}{entry.reason?` · ${entry.reason}`:''}</p>
     <label>{t('hubAction')} <select aria-label={`${entry.displayName} ${t('hubAction')}`} disabled={busy||recovering||pending||unavailable&&!active} value={chosen?.action??'skip'} onChange={event=>change(entry,event.target.value)}>
      {!entry.required&&!active&&<option value="skip">{t('hubSkip')}</option>}
      {active&&<option value="retain">{t('hubRetain')}</option>}
      {!unavailable&&<option value={active?'update':'install'}>{active?t('hubUpdate'):t('hubInstall')}</option>}
      {unavailable&&!active&&entry.required&&<option value="install">{t('hubBlocked')}</option>}
      {active&&!entry.required&&<option value="uninstall">{t('hubRemove')}</option>}
     </select></label>
    </li>})}</ul>
   {blocked&&<p role="status">{t('hubRequiredBlocked')}</p>}
   <Button disabled={busy||recovering||pending||blocked||selection.length===0} onClick={()=>void run(async()=>{intent.current=undefined;setPreview(undefined);const value=await hubSetupRequest<HubPreview>('preview',{channel:'stable',requested:selection});if(!value.intentId||!value.confirmationNonce||!value.items?.length||!Number.isFinite(Date.parse(value.expiresAt)))throw Error('INVALID_PREVIEW');intent.current=value;setPreview(value)})}>{t('hubPreview')}</Button>
  </>}
  {preview&&<div aria-label={t('hubPlan')}><h3>{t('hubPlan')}</h3><p>{t('hubBytes')}: {preview.totalBytes.toLocaleString()} bytes · {t('hubExpires')}: {new Date(preview.expiresAt).toLocaleString()}</p>
   <code>{preview.planDigest}</code><ul>{preview.items.map(item=><li key={hubKey(item)}><strong>{item.displayName??item.itemId}</strong> · {item.kind} · {item.action} · {item.version??t('hubUnknown')} · {item.enabled?t('hubEnabled'):t('hubDisabled')}
    {item.releaseId&&<div>{t('hubRelease')}: <code>{item.releaseId}</code></div>}
    {item.compatibility&&<p>{item.compatibility}{item.evidence?` · ${item.evidence}`:''}</p>}
    <p>{t('hubPermissions')}: {item.accessDeclaration?`${t('hubScripts')}: ${String(item.accessDeclaration.containsScripts)}; ${t('hubFiles')}: ${item.accessDeclaration.fileAccess}; ${t('hubNetwork')}: ${item.accessDeclaration.networkHosts.join(', ')||t('hubNone')}`:t('hubPermissionUnknown')}</p>
   </li>)}</ul><p>{t('hubConfirmHint')}</p>
   {missingAccess&&<p role="alert">{t('hubAccessRequired')}</p>}
   <Button disabled={busy||recovering||pending||expired||missingAccess||!intent.current} onClick={()=>{const value=intent.current;if(!value||Date.parse(value.expiresAt)<=Date.now()||value.items.some(i=>(i.action==='install'||i.action==='update')&&!i.accessDeclaration))return;intent.current=undefined;setPreview(undefined);void run(async()=>{try{setOperation(await hubSetupRequest<HubOperation>('execute',{intentId:value.intentId,confirmationNonce:value.confirmationNonce}))}catch(e){setRecovering(true);throw e}})}}>{expired?t('hubExpired'):t('hubExecute')}</Button>
  </div>}
  {operation&&<div role="status"><h3>{t('hubOperation')}</h3><p>{operation.state}{operation.phase&&operation.phase!==operation.state?` · ${operation.phase}`:''}{operation.errorCode?` · ${operation.errorCode}`:''}</p>
   <p><code>{operation.operationId}</code></p>{operation.restartRequired&&<p>{t('hubRestartRequired')}</p>}
   {operation.restartReady&&<Button disabled={busy||recovering} onClick={()=>void run(async()=>{setRecovering(true);try{setOperation(await hubSetupRequest<HubOperation>('restart',{operationId:operation.operationId}))}catch{setError(t('hubConnectionRecovering'))}})}>{t('hubRestart')}</Button>}
  </div>}
  {recovering&&<p role="status">{t('hubConnectionRecovering')}</p>}
 </section>
}
