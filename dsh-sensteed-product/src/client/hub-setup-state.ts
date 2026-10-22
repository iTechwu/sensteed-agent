/** Renderer projection only. Host owns identities, targets, grants and single-use intents. */
export type HubKind='skill'|'plugin'
export type HubAction='retain'|'install'|'update'|'uninstall'
export interface HubEntry {kind:HubKind;itemId:string;displayName:string;version:string|null;required:boolean;initialInstall:boolean;enabled:boolean;disposition:string;reason:string|null;bytes:number}
export interface HubOperationReceipt {phase:string;seq:number;errorCode:string|null}
export interface HubOperation {operationId:string;state:string;phase?:string;retryAllowed?:boolean;restartRequired?:boolean;restartReady?:boolean;errorCode?:string;receiptSeq?:number;outboxState?:'clear'|'pending';pendingReceipt?:HubOperationReceipt}
export interface HubCheck {channel:'stable'|'beta';profileId:string;activeGenerationDigest:string|null;entries:HubEntry[];activeItems:{kind:HubKind;itemId:string;enabled:boolean}[];operation?:HubOperation}
export interface HubSelection {kind:HubKind;itemId:string;action:HubAction;enabled:boolean}
export interface HubPlanItem extends HubSelection {displayName?:string;releaseId?:string;version?:string|null;compatibility?:string;evidence?:string|null;accessDeclaration?:null|{containsScripts:boolean;networkHosts:string[];fileAccess:string;localPreview?:{scope:'loopback'|'private-lan';protocols:('http'|'https')[]}}}
export interface HubPreview {intentId:string;confirmationNonce:string;planDigest:string;expiresAt:string;totalBytes:number;items:HubPlanItem[]}
export const hubKey=(row:{kind:HubKind;itemId:string})=>`${row.kind}:${row.itemId}`
export const hubBlocked=(row:HubEntry)=>!['CURRENT','INSTALL','UPDATE','AVAILABLE','USER_REMOVED'].includes(row.disposition)
export const hubTerminal=(op:HubOperation|undefined)=>!op||!op.pendingReceipt&&op.outboxState!=='pending'&&(
 ['ACTIVATED','ROLLED_BACK'].includes(op.phase??op.state)||
 (op.phase??op.state)==='NEEDS_ATTENTION'&&op.retryAllowed===true&&op.outboxState==='clear')
export function hubInitialSelections(check:HubCheck):HubSelection[]{
 const result=check.activeItems.map(i=>({...i,action:'retain' as HubAction}))
 for(const entry of check.entries){if(result.some(i=>hubKey(i)===hubKey(entry)))continue
  if(entry.disposition==='USER_REMOVED')continue
  if(entry.required||entry.initialInstall&&!hubBlocked(entry))result.push({kind:entry.kind,itemId:entry.itemId,action:'install',enabled:true})
 }return result
}
/** docs/1022 模板期望集视图（itemId 目录身份；mcp 为符号引用）。 */
export interface HubTemplatePublic {id:string;key:string;revision:number;displayName:string;description:string;useCases:string[];iconKey:string;counts:{skills:number;plugins:number;mcpEndpoints:number};updatedAt:string}
export interface HubInstantiateResult {profileId:string;contentProfileId:string;templateId:string;revision:number;profileName:string;items:{kind:Exclude<HubKind,'mcp.endpoint'>;itemId:string;enabled:boolean}[];mcpEndpoints:{service:string;domain:string;version:string;enabled:boolean}[];skippedItems:{item:unknown;reason:string}[];entries:HubEntry[];operation?:HubOperation}
export async function hubSetupRequest<T>(action:'check'|'profiles'|'telemetry'|'templates'|'instantiate'|'preview'|'execute'|'status'|'restart',body:unknown,signal?:AbortSignal):Promise<T>{
 const response=await fetch(`/api/desktop/hub/generations/${action}`,{method:'POST',credentials:'same-origin',redirect:'error',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(action==='execute'?120000:30000)]):AbortSignal.timeout(action==='execute'?120000:30000)})
 if(!response.ok){
  if(response.status===503)throw Error('BASE_VERSION_NOT_ENABLED')
  // The Host answers stable intent failures with {error:'HUB_*'}; keep that code
  // so the page can name an unreachable service instead of a lost confirmation.
  let code='';try{const text=await response.text();if(text.length<=256)code=JSON.parse(text)?.error??''}catch{}
  throw Error(typeof code==='string'&&/^HUB_[A-Z0-9_]{1,80}$/.test(code)?code:`HUB_REQUEST_${response.status}`)
 }
 const value=await response.json() as T|{available:boolean;result?:T;reason?:string}
 if(value&&typeof value==='object'&&'available'in value){if(!value.available||!('result'in value))throw Error(value.reason??'BASE_VERSION_NOT_ENABLED');return value.result as T}
 return value as T
}

/** 公开模板列表（仅 published；L0 固定源，Host 校验响应）。 */
export async function hubTemplatesRequest(signal?:AbortSignal):Promise<{list:HubTemplatePublic[];total:number}>{
 const result=await hubSetupRequest<{list:HubTemplatePublic[];total:number}>('templates',{},signal)
 return Array.isArray(result?.list)?result:Promise.reject(Error('HUB_INVALID_RESPONSE'))
}
/** 注册期望集：profileId 由 Host 绑定到当前 Profile 目录身份，物化走既有管线。 */
export async function hubInstantiateRequest(input:{templateId:string;profileName:string},signal?:AbortSignal):Promise<HubInstantiateResult>{
 return hubSetupRequest<HubInstantiateResult>('instantiate',{templateId:input.templateId,profileName:input.profileName.trim()},signal)
}

/** docs/1022 §6.4 内容 Profile 意图（Host 所有存储；双壳同通道）。 */
export interface HubContentProfileView { id:string; name:string; summary:{skills:number;plugins:number;mcpEndpoints:number;skipped:number} }
export async function hubProfilesRequest<T>(input:unknown,signal?:AbortSignal):Promise<T>{
 return hubSetupRequest<T>('profiles',input,signal)
}

/** Host selects this Profile's verified channel; an older/malformed reply cannot silently mean stable. */
export async function hubCheckRequest(signal?:AbortSignal):Promise<HubCheck>{
 const result=await hubSetupRequest<HubCheck>('check',{},signal)
 if(result.channel!=='stable'&&result.channel!=='beta')throw Error('HUB_CHECK_CHANNEL_REQUIRED')
 return result
}
