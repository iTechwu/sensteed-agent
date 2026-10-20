import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { apply, capabilities } from '../index.js'

const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const pkg = readJson('../package.json')
const views = readJson('../capability-views.json')
const snapshot = readJson('../service-catalog.snapshot.json')
const registry = readJson('../../../runtime/mcp-gateway/public-mcp-routes.json')

function host() {
  const registrations = [], sections = [], disposed = []
  const context = {
    hubMcp: { register(value) { registrations.push(value); return { dispose() { disposed.push(value.serverName) } } } },
    systemPrompt: { section(value) { sections.push(value); return () => disposed.push(value.name) } },
  }
  return { context, registrations, sections, disposed }
}

test('legacy capability IDs stay intact and remain declared vocabulary', () => {
  assert.deepEqual(capabilities, pkg.dsh.capabilities)
  const expected = ['tools-market-research', 'tools-public-social-research', 'tools-hotspot-discovery', 'tools-talent-discovery', 'tools-lead-discovery', 'tools-custom-car-monitoring', 'tools-viral-video', 'tools-social-operation', 'tools-tos-upload', 'tools-supply-chain']
  assert.deepEqual(capabilities.filter(item => item.id !== 'tools-business-discovery').map(item => item.id), expected)
})

test('snapshot is a faithful compact service catalog', () => {
  assert.equal(snapshot.schemaVersion, 1)
  assert.match(snapshot.catalogVersion, /^[0-9a-f]{64}$/u)
  assert.equal(snapshot.categories.length, 8)
  assert.equal(snapshot.services.length, 43)
  const tools = snapshot.services.flatMap(item => item.tools.map(tool => tool.toolName))
  assert.equal(new Set(tools).size, 235)
  for (const service of snapshot.services) {
    assert.equal(service.servers.length, 1)
    assert.equal(service.servers[0], `tools-${service.domain.replaceAll('_', '-')}`)
    for (const tool of service.tools) {
      assert.equal(typeof tool.toolName, 'string')
      assert.ok(['read', 'write'].includes(tool.declaredEffect))
      assert.ok(['never', 'cache_miss', 'explicit', 'unknown'].includes(tool.externalCallPolicy))
      assert.ok(['none', 'possible', 'unknown'].includes(tool.costPolicy))
    }
  }
})

test('views cover every service group except the video-notes plugin domains', () => {
  assert.equal(views.version, 2)
  assert.deepEqual(views.excludedDomains, ['video-processing'])
  const services = new Map(snapshot.services.map(item => [item.id, item]))
  const excluded = new Set(
    snapshot.services.filter(item => item.servers.some(server => server === 'tools-video-processing')).map(item => item.id)
  )
  assert.deepEqual([...excluded].sort(), ['media.frames', 'media.jobs', 'media.sources', 'media.transcripts', 'media.upload'])
  assert.equal(views.views.length, services.size - excluded.size)
  const seen = new Set()
  for (const view of views.views) {
    const service = services.get(view.serviceId)
    assert.ok(service, `unknown serviceId: ${view.serviceId}`)
    assert.ok(!seen.has(view.serviceId), `duplicate view for ${view.serviceId}`)
    seen.add(view.serviceId)
    assert.equal(view.capabilityId, `tools-svc-${view.serviceId.replaceAll('.', '-')}`)
    assert.equal(view.categoryId, service.categoryId)
    assert.equal(view.name, service.name)
    assert.deepEqual(view.servers, service.servers)
    assert.deepEqual(
      view.tools,
      service.tools.map(tool => tool.toolName).sort()
    )
    assert.ok(['research', 'creation', 'collaboration', 'business'].includes(view.group))
    assert.ok(view.description.length >= 10)
  }
  assert.deepEqual(new Set(seen), new Set([...services.keys()].filter(id => !excluded.has(id))))
})

test('legacy capabilities stay reachable through view back-references', () => {
  const declared = new Set(pkg.dsh.capabilities.map(item => item.id))
  const covered = new Set(views.views.flatMap(item => item.legacyCapabilities))
  assert.deepEqual(covered, declared)
  for (const view of views.views) {
    assert.ok(view.legacyCapabilities.length >= 1)
    for (const id of view.legacyCapabilities) assert.ok(declared.has(id))
  }
})

test('all registered connections use the public allowlist and are covered by views', async () => {
  const env = host()
  const dispose = apply(env.context)
  assert.equal(env.registrations.length, 12)
  const paths = new Set(registry.endpoints.map(item => item.route.replace('/mcp/', '')))
  for (const registration of env.registrations) {
    assert(paths.has(registration.path))
    assert.equal(registration.capability, 'tools')
    assert.equal(registration.serverName, `tools-${registration.path.replace('tools/', '')}`)
    assert(!('url' in registration) && !('headers' in registration))
  }
  assert(!env.registrations.some(item => item.path.endsWith('video-processing')))
  const registered = new Set(env.registrations.map(item => item.serverName))
  assert.deepEqual(new Set(views.views.flatMap(item => item.servers)), registered)
  await dispose()
  assert.equal(env.disposed.length, 13)
})

test('guidance uses live discovery without claiming broad free reads or universal write arguments', () => {
  const env = host()
  apply(env.context)
  const guidance = env.sections[0].text
  for (const tool of Object.values(registry.discovery).filter(value => typeof value === 'string')) assert(guidance.includes(tool))
  assert.match(guidance, /externalCallsAllowed=false、chargeAllowed=false/u)
  assert.match(guidance, /unknown/u)
  assert.match(guidance, /只在 schema 支持时/u)
  assert.match(guidance, /collectionRef/u)
  assert.doesNotMatch(guidance, /任何 Tools 写操作必须带/u)
})

test('no unauthenticated fallback if the sealed Host service is absent', () => {
  assert.throws(() => apply({ systemPrompt: {} }), /HUB_MCP_SERVICE_REQUIRED/u)
})
