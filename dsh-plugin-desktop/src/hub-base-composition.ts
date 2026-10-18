/** Enterprise bootstrap admits the base shell and dedicated auth rows, never bundled business extensions. */
import{composeEntries}from'@deepseek-ai/dsh-app-boot'
import type{PatchOptions}from'@deepseek-ai/cordis-plugin-include'
const desktop=new Set(['dsh-plugin-desktop','dsh-plugin-desktop/terminal','dsh-plugin-desktop/diagnostics','dsh-plugin-desktop/notifications','dsh-plugin-desktop/pnpm','dsh-plugin-desktop/profiles','dsh-plugin-desktop/updates','dsh-plugin-desktop/browser-tools'])
const product=new Set(['@dofe/dsh-sensteed-product','@dofe/dsh-sensteed-product/dofe-host-auth','@dofe/dsh-sensteed-product/dofe-host-capabilities','@dofe/dsh-sensteed-product/dofe-auth-routes'])
export function hubBaseComposition(patches:readonly PatchOptions[]):PatchOptions[]{
 const entries=[...composeEntries([[...patches]])].filter(row=>typeof row.name==='string'&&(row.name.startsWith('@deepseek-ai/')||desktop.has(row.name)||product.has(row.name)))
 // A base include can load an arbitrary second tree; already composed rows need no include carrier.
 for(const row of entries)if(row.name==='@deepseek-ai/cordis-plugin-include'||row.name==='cordis:include')throw new Error('Unsealed include carrier in Hub base composition')
 return[{insert:entries}]
}
