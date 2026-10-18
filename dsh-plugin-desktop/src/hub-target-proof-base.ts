/** Real sealed L0 services for the offline proof Host; no business MCP/model transport. */
import type { Context } from '@deepseek-ai/cordis'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
export async function prepareTargetProofBase(ctx:Context,root:string):Promise<void>{
 const home=join(root,'host-home'),profile=join(home,'profiles','proof');mkdirSync(profile,{recursive:true,mode:0o700})
 const patchPath=join(profile,'cordis.patch.yml');writeFileSync(patchPath,'[]\n',{flag:'wx',mode:0o600})
 // These are actual private launcher paths, consumed by the production config editor/settings.
 ctx.provide('profileContext',{name:'proof',dir:profile,patchPath,installAnchor:fileURLToPath(new URL('../package.json',import.meta.url)),cwd:root,home,startedBundles:[],overlays:[],telemetryDisabledEnv:'1',readPatches:()=>[]})
 const credentials=await import('@deepseek-ai/dsh-credentials-local');await ctx.plugin(credentials.default,{path:join(home,'.credentials.yaml'),watch:false})
 const editor=await import('@deepseek-ai/dsh-config-editor');await ctx.plugin(editor.default)
 const settings=await import('@deepseek-ai/dsh-settings');await ctx.plugin(settings.default)
 const systemPrompt=await import('@deepseek-ai/dsh-system-prompt');await ctx.plugin(systemPrompt.default,{personaPrefix:''})
 const tools=await import('@deepseek-ai/dsh-tools');await ctx.plugin(tools.default)
 const attachments=await import('@deepseek-ai/dsh-attachment-local');await ctx.plugin(attachments.default,{dshHome:home})
 const webServer=await import('@deepseek-ai/dsh-host-webserver');await ctx.plugin(webServer.default,{host:'127.0.0.1',port:0})
 const connection=await import('@deepseek-ai/dsh-client-connection');await ctx.plugin(connection,{trustedHosts:[]})
 const auth=await import('@dofe/dsh-sensteed-product/dofe-host-auth');await ctx.plugin(auth)
 const capabilities=await import('@dofe/dsh-sensteed-product/dofe-host-capabilities');await ctx.plugin(capabilities)
 const authRoutes=await import('@dofe/dsh-sensteed-product/dofe-auth-routes');await ctx.plugin(authRoutes)
}
