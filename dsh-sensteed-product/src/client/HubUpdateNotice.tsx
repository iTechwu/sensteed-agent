import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DofeAccessSettings } from '../dofe-plugins.ts'
import type { DofeAccessLocaleKey } from './dofe-access.ts'
import { HubSetupSection } from './HubSetupSection.tsx'
import { hubCheckRequest } from './hub-setup-state.ts'
import { createHubUpdateMonitor, type HubUpdateNotice as Notice } from './hub-update-monitor.ts'
type Props={settingsScope:ConfigForm<DofeAccessSettings>;t:(key:DofeAccessLocaleKey)=>string;subscribeReconnect:(listener:()=>void)=>()=>void}
/** Mounted by the base Product, independently of whether Settings has ever been opened. */
export function HubUpdateNotice({settingsScope,t,subscribeReconnect}:Props){
 const dialog=useRef<HTMLDialogElement>(null)
 const [notice,setNotice]=useState<Notice>(),[open,setOpen]=useState(false)
 useEffect(()=>{
  const monitor=createHubUpdateMonitor(signal=>hubCheckRequest(signal),value=>setNotice(value as Notice|undefined))
  let lastAccount:string|undefined
  const sync=()=>{const value=settingsScope.getSnapshot().value;const account=value?.authMode==='feishu'?value.identity?.ssoSub:undefined;monitor.account(account);if(account!==lastAccount){setOpen(false);lastAccount=account}}
  const stopSettings=settingsScope.subscribe(sync),stopConnection=subscribeReconnect(()=>{setOpen(false);monitor.reconnect()});sync()
  return()=>{stopSettings();stopConnection();monitor.dispose()}
 },[settingsScope,subscribeReconnect])
 useEffect(()=>{if(open){if(dialog.current?.showModal)dialog.current.showModal();else dialog.current?.setAttribute('open','')}},[open])
 // Account invalidation hides both the previous notice and its settings editor.
 return <>{notice&&<aside role="status" aria-label={t('hubUpdateNotice')} style={{position:'fixed',bottom:16,right:16,zIndex:1000,padding:16,borderRadius:8,border:'1px solid var(--dsw-alias-border-l1, #ddd)',background:'var(--dsw-alias-bg-layer-1, white)',maxWidth:360,boxShadow:'0 4px 16px #0002'}}>
  <strong>{notice.restart?t('hubRestartRequired'):t('hubUpdateNotice')}</strong>
  {!notice.restart&&<p>{t('hubUpdateAvailable')}: {notice.updates} · {t('hubInitialAdded')}: {notice.additions}</p>}
  <Button onClick={()=>setOpen(true)}>{t('hubOpenSetup')}</Button>
 </aside>}
 {open&&<dialog ref={dialog} aria-label={t('hubNav')} onCancel={()=>setOpen(false)} style={{background:'var(--dsw-alias-bg-layer-1, white)',color:'inherit',padding:24,borderRadius:8,width:'min(720px, 95vw)',maxHeight:'90vh',overflow:'auto'}}><Button onClick={()=>setOpen(false)}>{t('hubCloseSetup')}</Button><HubSetupSection t={t} settingsScope={settingsScope}/></dialog>}
 </>
}
export function installHubUpdateNotice(props:Props):()=>void {
 const node=document.createElement('div');node.id='dsh-hub-update-notice';document.body.append(node)
 const root=createRoot(node);root.render(<HubUpdateNotice {...props}/>);return()=>{root.unmount();node.remove()}
}
