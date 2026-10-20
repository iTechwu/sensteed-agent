/** Generate UI-only views from the committed Tools source snapshot, offline. */
import { readFileSync, writeFileSync } from 'node:fs'
const root = new URL('../', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('.ci/dsh-tools-mcp/package.json', root)))
const source = JSON.parse(readFileSync(new URL('.ci/dsh-tools-mcp/capability-views.json', root)))
const snapshot = JSON.parse(readFileSync(new URL('.ci/dsh-tools-mcp/service-catalog.snapshot.json', root)))
const runtime = readFileSync(new URL('.ci/dsh-tools-mcp/index.js', root), 'utf8')
const declared = runtime.match(/export const capabilities = Object.freeze\((\[[\s\S]*?\])\)/)?.[1]
if (!declared || JSON.stringify(JSON.parse(declared)) !== JSON.stringify(manifest.dsh.capabilities)) throw new Error('Tools runtime and package capabilities differ')
const declaredIds = manifest.dsh.capabilities.map(item => item.id)
const seen = new Set()
const covered = new Set()
const views = source.views.map(view => {
  if (source.version !== 2 || !Array.isArray(source.excludedDomains) || source.excludedDomains.length !== 1 || source.excludedDomains[0] !== 'video-processing') throw new Error('Invalid Tools view model version')
  if (!/^tools-svc-[a-z0-9-]+$/.test(view.capabilityId) || view.capabilityId !== `tools-svc-${view.serviceId.replaceAll('.', '-')}` || seen.has(view.serviceId)
    || !['research', 'creation', 'collaboration', 'business'].includes(view.group)
    || typeof view.name !== 'string' || !view.name || typeof view.description !== 'string' || view.description.length < 10
    || !Array.isArray(view.servers) || !view.servers.length || view.servers.some(server => !/^tools-[a-z-]+$/.test(server))
    || !Array.isArray(view.tools) || !view.tools.length || !Array.isArray(view.legacyCapabilities) || !view.legacyCapabilities.length) throw new Error(`Invalid Tools view: ${view.serviceId}`)
  const service = snapshot.services.find(item => item.id === view.serviceId)
  if (!service || service.categoryId !== view.categoryId || JSON.stringify(service.servers) !== JSON.stringify(view.servers)
    || service.servers.some(server => server === 'tools-video-processing')
    || JSON.stringify(view.tools) !== JSON.stringify(service.tools.map(tool => tool.toolName).sort())) throw new Error(`Tools view drifts from the service snapshot: ${view.serviceId}`)
  for (const id of view.legacyCapabilities) {
    if (!declaredIds.includes(id)) throw new Error(`Unknown legacy capability: ${id}`)
    covered.add(id)
  }
  seen.add(view.serviceId)
  return { id: view.capabilityId, kind: 'business', group: view.group, name: view.name, description: view.description, servers: view.servers, categoryId: view.categoryId, serviceId: view.serviceId, tools: view.tools, legacyCapabilities: view.legacyCapabilities }
})
if (covered.size !== declaredIds.length) throw new Error('Tools views must reference every declared legacy capability')
const excluded = snapshot.services.filter(item => item.servers.includes('tools-video-processing')).map(item => item.id).sort()
if (JSON.stringify(excluded) !== JSON.stringify(['media.frames', 'media.jobs', 'media.sources', 'media.transcripts', 'media.upload'])) throw new Error('Tools snapshot video-processing boundary changed')
if (seen.size !== snapshot.services.length - excluded.length) throw new Error('Tools views must cover every non-excluded snapshot service exactly once')
const paths = runtime.match(/const registrations = (\[[^\n]*\])\.map/)?.[1]
const registered = new Set([...paths?.matchAll(/'([^']+)'/g) ?? []].map(match => `tools-${match[1]}`))
const presented = new Set(views.flatMap(view => view.servers))
if (!registered.size || registered.size !== presented.size || [...registered].some(server => !presented.has(server))) throw new Error('Tools views must cover exactly the registered connections')
const output = '/** Generated from the committed Tools plugin snapshot. Run node scripts/generate-tool-views.mjs. */\nexport const TOOL_CAPABILITY_VIEWS = '+JSON.stringify(views,null,2)+' as const\n'
const target = new URL('dsh-sensteed-product/src/generated-tool-views.ts', root)
if (process.argv.includes('--check')) {
  if (readFileSync(target,'utf8') !== output) throw new Error('Tools views drifted from plugin source')
} else writeFileSync(target,output)
console.log(`tools-views: ${views.length} service-group views from catalog ${snapshot.catalogVersion.slice(0, 12)}`)
