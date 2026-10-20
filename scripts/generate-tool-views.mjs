/** Generate UI-only views from the committed Tools source snapshot, offline. */
import { readFileSync, writeFileSync } from 'node:fs'
const root = new URL('../', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('.ci/dsh-tools-mcp/package.json', root)))
const source = JSON.parse(readFileSync(new URL('.ci/dsh-tools-mcp/capability-views.json', root)))
const runtime = readFileSync(new URL('.ci/dsh-tools-mcp/index.js', root), 'utf8')
const declared = runtime.match(/export const capabilities = Object.freeze\((\[[\s\S]*?\])\)/)?.[1]
if (!declared || JSON.stringify(JSON.parse(declared)) !== JSON.stringify(manifest.dsh.capabilities)) throw new Error('Tools runtime and package capabilities differ')
const seen = new Set()
const views = source.views.map(view => {
  const capability = manifest.dsh.capabilities.find(item => item.id === view.capabilityId)
  if (!capability || seen.has(view.capabilityId) || !['research','creation','collaboration','business'].includes(capability.group)
    || !Array.isArray(view.servers) || !view.servers.length || view.servers.some(server => !/^tools-[a-z-]+$/.test(server))) throw new Error(`Invalid Tools view: ${view.capabilityId}`)
  seen.add(view.capabilityId)
  return { ...capability, servers: view.servers }
})
if (seen.size !== manifest.dsh.capabilities.length) throw new Error('Tools views must cover all declared capabilities')
const paths = runtime.match(/const registrations = (\[[^\n]*\])\.map/)?.[1]
const registered = new Set([...paths?.matchAll(/'([^']+)'/g) ?? []].map(match => `tools-${match[1]}`))
const presented = new Set(views.flatMap(view => view.servers))
if (!registered.size || registered.size !== presented.size || [...registered].some(server => !presented.has(server))) throw new Error('Tools views must cover exactly the registered connections')
const output = '/** Generated from the committed Tools plugin snapshot. Run node scripts/generate-tool-views.mjs. */\nexport const TOOL_CAPABILITY_VIEWS = '+JSON.stringify(views,null,2)+' as const\n'
const target = new URL('dsh-sensteed-product/src/generated-tool-views.ts', root)
if (process.argv.includes('--check')) {
  if (readFileSync(target,'utf8') !== output) throw new Error('Tools views drifted from plugin source')
} else writeFileSync(target,output)
console.log(`tools-views: ${views.length} source-defined views`)
