/** Sealed generic MCP owner. Business artifacts declare routes; only this Host owns transports and credentials. */
import type{Context}from'@deepseek-ai/cordis'
import{apply as applyMcpClient,name as mcpClientName,inject as mcpClientInject,type Config as McpConfig}from'@deepseek-ai/dsh-mcp-client'
import{credentialRef}from'@deepseek-ai/dsh-credentials'
import{DEFAULT_DOFE_PLUGIN_IDS,DOFE_ACCESS_VALIDATION_VERSION,normalizeDofeEnabledPluginIds,type DofePluginId}from'./dofe-plugins.ts'
import{BRAND_TENANT,BRAND_VARIANT}from'./generated-product-identity.ts'
import{observeLauncherRuntime,type DofeLauncherRuntime}from'./dofe-host-auth.ts'
import type{DofeAccessGate}from'./dofe-managed.ts'
import{financeMcpConfig}from'./finance-mcp.ts'
export const name='dofe-host-capabilities'
export const inject=['credentials','dofeAccessSettings',...(BRAND_VARIANT==='sensteed'?['dofeAuth']:[])]
export interface HubMcpDeclaration{readonly capability:DofePluginId;readonly serverName:string;readonly path:string;readonly timeoutMs:number}
export interface HubMcpRegistration{dispose():Promise<void>}
export interface HubMcpService{register(input:HubMcpDeclaration):HubMcpRegistration}
declare module'@deepseek-ai/cordis'{interface Context{hubMcp:HubMcpService}}
const McpClient={name:mcpClientName,inject:mcpClientInject,apply:applyMcpClient},keyRef=credentialRef('MODELS_API_KEY')
function declaration(input:HubMcpDeclaration):Readonly<HubMcpDeclaration>{
 if(!input||typeof input!=='object'||Object.keys(input).sort().join(',')!=='capability,path,serverName,timeoutMs'||!DEFAULT_DOFE_PLUGIN_IDS.includes(input.capability)||!/^[-a-z0-9]{1,80}$/u.test(input.serverName)||!(/^[a-z][a-z0-9-]{0,79}(?:\/[a-z][a-z0-9-]{0,79}){0,3}$/u.test(input.path))||!Number.isSafeInteger(input.timeoutMs)||input.timeoutMs<1000||input.timeoutMs>600000||input.capability==='finance'&&(input.path!=='finance'||input.serverName!=='finance')||input.path==='finance'&&input.capability!=='finance')throw new Error('HUB_MCP_INVALID_DECLARATION')
 return Object.freeze({...input})
}
export async function apply(ctx:Context):Promise<void>{
 let launcher:DofeLauncherRuntime|undefined;observeLauncherRuntime(ctx,value=>{launcher=value})
 const access=ctx.dofeAccessSettings,auth=BRAND_VARIANT==='sensteed'?ctx.dofeAuth:undefined
 type Entry={route:Readonly<HubMcpDeclaration>;client?:{dispose():void|Promise<void>};signature?:string;removed:boolean}
 const entries=new Map<string,Entry>();let disposed=false,revision=0,financeAllowed=false,tail=Promise.resolve()
 const ready=()=>{const value=access.get();return value.setupComplete&&value.validationVersion===DOFE_ACCESS_VALIDATION_VERSION&&value.authMode==='feishu'&&Boolean(value.identity?.ssoSub)&&(!auth||auth.getDatasourceSession()?.operator===value.identity?.ssoSub)}
 const enabled=()=>new Set(normalizeDofeEnabledPluginIds(access.get().enabledPlugins,BRAND_VARIANT,access.get().entitlements?.plugins))
 const gate=():DofeAccessGate=>{const value=access.get(),granted=value.entitlements?.plugins.includes('knowledge')===true,entitlements=value.entitlements===undefined?undefined:{...value.entitlements,knowledge:granted?{plugin:'knowledge',permissionVersion:1,accesses:['read','write']}:undefined};return{ready:ready(),financeAllowed,enabledPlugins:[...enabled()],entitlements}}
 ctx.provide('dofeAccess',gate)
 async function stop(entry:Entry){const old=entry.client;delete entry.client;delete entry.signature;if(old)await old.dispose()}
 async function reconcile(){
  const epoch=revision,resolved=await ctx.credentials.resolve(keyRef),key=resolved?.value,session=auth?.getDatasourceSession(),settings=access.get()
  const baseReady=!disposed&&ready()&&Boolean(key)&&(!auth||session!==undefined&&session.operator===settings.identity?.ssoSub)
  let finance=false
  if(baseReady&&session&&entries.has('finance')&&enabled().has('finance')){
   try{const request=launcher?.requestDofeAuth?.bind(launcher)??globalThis.fetch,response=await request('https://ds.hozonauto.com/api/finance/permissions/workspace-access',{method:'GET',headers:{Accept:'application/json',Authorization:`Bearer ${session.accessToken}`,'X-Company-Code':BRAND_TENANT},redirect:'error',signal:AbortSignal.timeout(30000)}),value=await response.json() as {data?:{allowed?:boolean}};finance=response.ok&&value?.data?.allowed===true}catch{finance=false}
  }
  if(epoch!==revision||disposed)return
  financeAllowed=baseReady&&finance;ctx.emit?.('dofe/access-changed')
  for(const entry of entries.values()){
   const allowed=baseReady&&enabled().has(entry.route.capability)&&(entry.route.capability!=='finance'||finance),signature=allowed?JSON.stringify([key,session?.accessToken,entry.route]):undefined
   if(entry.signature===signature)continue
   await stop(entry)
   if(!allowed||!key||entry.removed||epoch!==revision||disposed)continue
   const config:McpConfig=entry.route.capability==='finance'?financeMcpConfig(key,session!.accessToken):{transport:'streamable-http',serverName:entry.route.serverName,url:`https://ai.hozonauto.com/mcp/${entry.route.path}`,headers:{Authorization:`Bearer ${key}`,'X-Company-Code':BRAND_TENANT},toolCallTimeoutMs:entry.route.timeoutMs,failOnStartupError:false,reconnect:{enabled:true,initialDelayMs:500,maxDelayMs:30000,maxAttempts:10}}
   try{const client=await ctx.plugin(McpClient,config);if(epoch!==revision||disposed||entry.removed)await client.dispose();else{entry.client=client;entry.signature=signature!}}catch{ctx.logger.error('Hub MCP transport could not activate')}
  }
 }
 function schedule(){revision++;financeAllowed=false;ctx.emit?.('dofe/access-changed');const stopping=Promise.all([...entries.values()].map(stop));const next=async()=>{await stopping;await reconcile()};tail=tail.then(next,next)}
 ctx.provide('hubMcp',{register(input){if(disposed)throw new Error('HUB_MCP_DISPOSED');const route=declaration(input);if(entries.has(route.serverName))throw new Error('HUB_MCP_DUPLICATE_SERVER');const entry:Entry={route,removed:false};entries.set(route.serverName,entry);schedule();return{async dispose(){entry.removed=true;entries.delete(route.serverName);revision++;await stop(entry);schedule()}}}} satisfies HubMcpService)
 ctx.on('credentials/reference-updated',ref=>{if(ref==='MODELS_API_KEY')schedule()})
 ctx.effect(()=>access.watch(schedule),'Hub MCP settings lifetime')
 if(auth){let watching=false;ctx.effect(()=>auth.watchBinding(()=>{if(watching)schedule()}),'Hub MCP SSO lifetime');watching=true}
 // Access revocation is rechecked even when no local settings notification arrives.
 ctx.effect(()=>{const timer=setInterval(schedule,60000);timer.unref();return()=>clearInterval(timer)},'Hub MCP permission renewal')
 ctx.effect(()=>async()=>{disposed=true;revision++;financeAllowed=false;await Promise.all([...entries.values()].map(stop));entries.clear();await tail},'Hub MCP transport lifetime')
 schedule();await tail
}
