import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import vm from 'node:vm'
import { ACTIONS, COMPANY_TEMPLATES, KNOWLEDGE_PERMISSION_VERSION, MCP_URL, apply as applyKnowledge, resolveKnowledgePermission } from '../index.js'

const root = new URL('../', import.meta.url)
const readyAccess = { ready: true, enabledPlugins: ['knowledge'], entitlements: { plugins: ['knowledge'], knowledge: { plugin: 'knowledge', permissionVersion: KNOWLEDGE_PERMISSION_VERSION, accesses: ['read', 'write'] } } }
const apply = (ctx, overrides) => applyKnowledge({
  dofeAccess: readyAccess, ...ctx,
  tools: { schemas: () => Object.values(ACTIONS).map(name => ({ name: `mcp__knowledge__${name.replaceAll('.', '_')}_testhash` })), ...ctx.tools },
}, overrides)

test('normalizes partial knowledge sources to the degraded warning state', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.match(source, /"partial", "warning", "error"/u)
  assert.match(source, /value === "partial" \|\| value === "warning" \? "degraded"/u)
})

test('aligns Memory and Knowledge permissions with the shared access gate', async () => {
  assert.equal(resolveKnowledgePermission('knowledge.recall', readyAccess).allowed, true)
  assert.equal(resolveKnowledgePermission('knowledge.remember', readyAccess).allowed, true)
  assert.equal(resolveKnowledgePermission('knowledge.remember', { ...readyAccess, ready: false }).reason, 'knowledge_access_gate_required')
  assert.equal(resolveKnowledgePermission('knowledge.search', { ready: true, entitlements: { plugins: [] } }).reason, 'knowledge_plugin_not_entitled')
  assert.equal(resolveKnowledgePermission('knowledge.remember', { ready: true, entitlements: { plugins: ['knowledge'], knowledge: { permissionVersion: KNOWLEDGE_PERMISSION_VERSION, accesses: ['read'] } } }).reason, 'knowledge_capability_not_declared')
  assert.equal(resolveKnowledgePermission('knowledge.recall', { ...readyAccess, enabledPlugins: [] }).reason, 'knowledge_plugin_disabled')
})

test('exposes full Knowledge, Memory, Ontology, and graph management surfaces in the client', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  for (const token of ['knowledgeTab', 'memoryManageTab', 'consoleTab', 'yk-management-console', 'ingest_file', 'fileUrl', 'knowledge.promote', 'knowledge.remember', 'knowledge.entity_assertions', 'knowledge.relation_assertions', 'knowledge.entity_merges', 'knowledge.provenance_lineage', 'knowledge.create_space', 'knowledge.create_source', 'knowledge.create_ontology_version', 'knowledge.publish_ontology', 'knowledge.export_ontology', 'knowledge.import_ontology', 'knowledge.grant_acl', 'knowledge.grant_document_principal', 'knowledge.rebuild_graph', 'memoryCaptureTitle', 'ingestTitle', 'promoteTitle', 'entityId', 'capabilityAllowed']) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  assert.match(source, /style\.textContent = css \+ stateCss \+ themeCss \+ themeRefinementCss \+ contentLayoutCss \+ managementCss/u)
})

async function loadClientTestApi() {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  const module = { exports: {} }
  const react = { createElement() {}, useEffect() {}, useMemo(factory) { return factory() }, useState() { return [null, () => {}] }, useSyncExternalStore() {}, Fragment: Symbol('Fragment') }
  vm.runInNewContext(source, { module, exports: module.exports, require(id) { return id === 'react' ? react : { Tooltip() {} } }, Intl, Map, Set, Date, JSON, Number, Array, Object, String, Math })
  return module.exports.__test
}

test('publishes a web management plugin and knowledge MCP bundle', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.name, '@dofe/dsh-sensteed-knowledge')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
  assert.match(patch, /id:\s*sensteed-knowledge-tools/u)
  assert.match(patch, /name:\s*'@dofe\/dsh-sensteed-knowledge'/u)
  // The wrapper plugin owns the public MCP gateway contract; the direct
  // `@deepseek-ai/dsh-mcp-client` route is intentionally not registered here
  // so the model only sees one tool surface with one parameter protocol.
  assert.doesNotMatch(patch, /serverName:\s*knowledge/u)
  assert.doesNotMatch(patch, /authorizationCredential:\s*MODELS_API_KEY/u)
  assert.doesNotMatch(patch, /@deepseek-ai\/dsh-mcp-client/u)
  assert.doesNotMatch(patch, /process\.env\.MODELS_API_KEY|Authorization:\s*!!js/u)
})

test('exposes governed knowledge, Memory, and graph tools without direct endpoints', async () => {
  const source = await readFile(new URL('index.js', root), 'utf8')
  for (const token of ['knowledge_search', 'knowledge_recall', 'knowledge_remember', 'knowledge_confirm_memory', 'knowledge_forget', 'knowledge_session_checkpoint', 'knowledge_promote', 'knowledge_loadout', 'knowledge_context_pack', 'knowledge_explain_trace', 'knowledge_entity_assertions', 'knowledge_relation_assertions', 'knowledge_entity_merges', 'knowledge_provenance_lineage', 'credential-store', 'tenant.all']) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  assert.doesNotMatch(source, /127\.0\.0\.1|172\.30\.30\.11|knowledge\.local\.dofe\.ai|knowledge\.dofe\.ai/u)
  assert.match(source, /https:\/\/ai.hozonauto.com\/mcp\/knowledge/u)
  assert.equal(Object.keys(ACTIONS).length, 40)
  assert.deepEqual(new Set(Object.values(ACTIONS)), new Set([
    'knowledge.search', 'knowledge.recall', 'knowledge.remember', 'knowledge.confirm_memory',
    'knowledge.forget', 'knowledge.session_checkpoint', 'knowledge.promote', 'knowledge.capabilities',
    'knowledge.overview', 'knowledge.graph', 'knowledge.ingest_file', 'knowledge.loadout',
    'knowledge.context_pack', 'knowledge.explain_trace', 'knowledge.entity_assertions',
    'knowledge.relation_assertions', 'knowledge.entity_merges', 'knowledge.provenance_lineage',
    'knowledge.spaces', 'knowledge.sources', 'knowledge.memories', 'knowledge.recall_traces',
    'knowledge.session_handoffs', 'knowledge.memory_feedbacks', 'knowledge.memory_conflicts',
    'knowledge.capability_catalog', 'knowledge.environment_facts', 'knowledge.skills',
    'knowledge.acl_grants', 'knowledge.principals', 'knowledge.ontologies', 'knowledge.create_space',
    'knowledge.create_source', 'knowledge.create_ontology_version', 'knowledge.publish_ontology',
    'knowledge.export_ontology', 'knowledge.import_ontology', 'knowledge.grant_acl',
    'knowledge.grant_document_principal', 'knowledge.rebuild_graph',
  ]))
  assert.deepEqual(COMPANY_TEMPLATES, [{
    id: 'tenant.all', spaceKey: 'tenant.all', name: '哪吒',
    description: '哪吒默认企业知识空间；公司、项目、会员与服务资料统一归档，所有哪吒成员可读',
    entities: ['哪吒', '长沙哪吒汽车销售服务有限公司', '汽车科技文创园', '会员与5S服务'],
  }])
})

test('covers the public Knowledge console contract without bypassing the MCP gateway', async () => {
  const source = await readFile(new URL('index.js', root), 'utf8')
  for (const token of [
    'knowledge_spaces', 'knowledge_sources', 'knowledge_memories', 'knowledge_recall_traces',
    'knowledge_session_handoffs', 'knowledge_memory_feedbacks', 'knowledge_memory_conflicts',
    'knowledge_capability_catalog', 'knowledge_environment_facts', 'knowledge_skills',
    'knowledge_acl_grants', 'knowledge_principals', 'knowledge_ontologies',
    'knowledge_create_space', 'knowledge_create_source', 'knowledge_create_ontology_version',
    'knowledge_publish_ontology', 'knowledge_export_ontology', 'knowledge_import_ontology',
    'knowledge_grant_acl', 'knowledge_grant_document_principal', 'knowledge_rebuild_graph',
  ]) assert.match(source, new RegExp(token, 'u'))
  assert.match(source, /const KNOWLEDGE_CONSOLE_READ_TOOLS/u)
  assert.match(source, /const KNOWLEDGE_CONSOLE_WRITE_TOOLS/u)
  assert.match(source, /accessClass\(remoteName\)/u)
})

test('exposes console actions through the same permission contract', async () => {
  const registered = new Map()
  apply({
    credentials: { async resolve() { return { value: 'test-key' } } },
    tools: { register(tool) { registered.set(tool.name, tool); return () => {} } },
    systemPrompt: { section() { return () => {} } },
  }, { fetch: async () => new Response('{}', { status: 200 }) })
  for (const name of ['knowledge_spaces', 'knowledge_memory_feedbacks', 'knowledge_ontologies', 'knowledge_create_space', 'knowledge_publish_ontology', 'knowledge_rebuild_graph']) {
    assert.ok(registered.has(name), name)
  }
  const read = registered.get('knowledge_spaces')
  const write = registered.get('knowledge_create_space')
  assert.equal((await read.execute({ input: { page: 1, limit: 10 } }, {})).error, undefined)
  assert.equal((await write.execute({ input: { name: 'test' } }, {})).error, undefined)
  const source = registered.get('knowledge_create_source')
  assert.equal((await source.execute({ input: { name: 'docs', type: 's3', config: { bucket: 'knowledge' } } }, {})).error, undefined)
})

test('publishes an explicit Knowledge versus Web routing contract', async () => {
  let section
  apply({
    credentials: { async resolve() { return { value: 'test-key' } } },
    tools: { register() { return () => {} } },
    systemPrompt: { section(value) { section = value; return () => {} } },
  }, { fetch: async () => new Response('{}', { status: 200 }) })
  assert.match(section.text({}), /企业内部事实优先使用 knowledge_search/u)
  assert.match(section.text({}), /公开实时信息.*web_search\/web_fetch/u)
  assert.match(section.text({}), /混合问题必须先调用 Knowledge/u)
  assert.match(section.text({}), /不要调用任何 mcp__knowledge__\* 直连工具/u)
  assert.match(section.text({}), /Knowledge 不可用时明确说明企业知识不可用/u)
})

test('publishes per-tool input schemas so invalid MCP arguments fail before the gateway', async () => {
  const registered = new Map()
  apply({
    credentials: { async resolve() { return { value: 'test-key' } } },
    tools: { register(tool) { registered.set(tool.name, tool); return () => {} } },
    systemPrompt: { section() { return () => {} } },
  }, { fetch: async () => new Response('{}', { status: 200 }) })

  const recall = registered.get('knowledge_recall')
  assert.deepEqual(recall.parameters.properties.input.required, ['query'])
  assert.deepEqual(Object.keys(recall.parameters.properties.input.properties).sort(), [
    'includeDocuments', 'includeMemories', 'query', 'retrievalMode', 'spaceIds', 'spaceKeys', 'topK',
  ])
  assert.equal(recall.parameters.properties.input.properties.topK.maximum, 50)
  assert.deepEqual(recall.parameters.properties.input.not.required, ['spaceKeys', 'spaceIds'])

  const loadout = registered.get('knowledge_loadout')
  assert.deepEqual(Object.keys(loadout.parameters.properties.input.properties), ['ifNoneMatch'])
  assert.equal(loadout.parameters.properties.input.properties.ifNoneMatch.pattern, '^[a-f0-9]{64}$')
  assert.equal(loadout.parameters.properties.input.additionalProperties, false)

  const confirm = registered.get('knowledge_confirm_memory')
  assert.deepEqual(confirm.parameters.properties.input.required, ['memoryId'])
  assert.equal(confirm.parameters.properties.input.properties.memoryId.format, 'uuid')

  const checkpoint = registered.get('knowledge_session_checkpoint')
  assert.equal(checkpoint.parameters.properties.input.properties.events.items.additionalProperties, false)
  assert.deepEqual(Object.keys(checkpoint.parameters.properties.input.properties.events.items.properties).sort(), ['seq', 'text', 'time', 'type'])
  assert.equal(checkpoint.parameters.properties.input.properties.candidateContents.items.properties.content.maxLength, 20000)
  assert.equal(checkpoint.parameters.properties.input.properties.events.maxItems, 50)

  const relations = registered.get('knowledge_relation_assertions')
  assert.deepEqual(relations.parameters.properties.input.properties.status.enum, [
    'EXTRACTED', 'VALIDATED', 'CANDIDATE', 'CONFIRMED', 'CONFLICTED', 'SUPERSEDED', 'REJECTED',
  ])

  const promote = registered.get('knowledge_promote')
  assert.equal(promote.parameters.properties.input.oneOf.length, 2)
  assert.deepEqual(promote.parameters.properties.input.oneOf.map(rule => rule.required), [['targetSpaceKey'], ['targetSpaceId']])
})

test('rejects invalid tool arguments before contacting the gateway', async () => {
  const registered = new Map()
  let calls = 0
  apply({
    credentials: { async resolve() { return { value: 'test-key' } } },
    tools: { register(tool) { registered.set(tool.name, tool); return () => {} } },
    systemPrompt: { section() { return () => {} } },
  }, { fetch: async () => { calls += 1; return new Response('{}', { status: 200 }) } })

  const recall = registered.get('knowledge_recall')
  const result = await recall.execute({ input: { topK: 51 } }, {})
  assert.equal(result.ok, false)
  assert.equal(result.error, 'invalid_tool_arguments')
  assert.equal(calls, 0)
})

test('rejects invalid management actions before contacting the gateway', async () => {
  let route
  let calls = 0
  apply({
    credentials: { async resolve() { return { value: 'test-key' } } },
    tools: { register() { return () => {} } },
    systemPrompt: { section() { return () => {} } },
    webServer: { register(value) { route = value; return () => {} } },
  }, { fetch: async () => { calls += 1; return new Response('{}', { status: 200 }) } })

  const response = await invoke(route, 'POST', { action: 'recall', input: { topK: 51 } })
  assert.equal(response.status, 400)
  assert.equal(response.body.reason, 'invalid_tool_arguments')
  assert.equal(calls, 0)
})

test('blocks management actions when the shared access gate is not ready', async () => {
  let route
  applyKnowledge({
    dofeAccess: { ready: false, entitlements: readyAccess.entitlements },
    credentials: { async resolve() { return { value: 'test-key' } } },
    tools: { register() { return () => {} } },
    systemPrompt: { section() { return () => {} } },
    webServer: { register(value) { route = value; return () => {} } },
  }, { fetch: async () => new Response('{}', { status: 200 }) })
  const response = await invoke(route, 'POST', { action: 'remember', input: { content: 'blocked' } })
  assert.equal(response.status, 403)
  assert.equal(response.body.reason, 'knowledge_access_gate_required')
  assert.equal(response.body.permissionVersion, KNOWLEDGE_PERMISSION_VERSION)
})

test('exposes explicit memory confirmation through the authenticated knowledge MCP route', async () => {
  const registered = new Map()
  const requests = []
  apply({
    credentials: { async resolve() { return { value: 'test-key', source: 'memory' } } },
    tools: { register(tool) { registered.set(tool.name, tool); return () => {} } },
    systemPrompt: { section() { return () => {} } },
  }, {
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(JSON.stringify({ jsonrpc: '2.0', result: { structuredContent: { id: 'memory-1' } } }), { status: 200 })
    },
  })
  const tool = registered.get('knowledge_confirm_memory')
  assert.ok(tool)
  const result = await tool.execute({ input: { memoryId: '11111111-1111-4111-8111-111111111111', reason: 'user-confirmed', shareWithSpace: true } }, {})
  assert.equal(result.ok, true)
  assert.equal(requests[0].url, MCP_URL)
  assert.equal(requests[0].init.headers.Authorization, 'Bearer test-key')
  assert.equal(requests[0].init.redirect, 'error')
  assert.equal(JSON.parse(requests[0].init.body).params.name, 'knowledge.confirm_memory')
})

test('localizes knowledge source state and isolates its overlay', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  for (const token of ['yk-source', 'credential-store', 'stateCss', 'overviewSource', 'pendingImports', 'yk-graph-canvas', 'yk-memory-row', '"aria-label": t("recallPlaceholder")', '"aria-label": t("graphPlaceholder")', 'style.textContent = css + stateCss', '.yk-overlay{position:fixed', '.yk-shell{display:grid', '.yk-content{min-height:0']) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
})

test('maps knowledge structure and action hierarchy to desktop theme tokens', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.match(source, /const themeRefinementCss =/u)
  assert.match(source, /\.yk-metric,\.yk-record,\.yk-memory-row\{border-color:var\(--dsw-alias-border-l1\)!important\}/u)
  assert.match(source, /\.yk-row-actions \.yk-quiet,\.yk-error button\{border-color:var\(--dsw-alias-border-l1\)!important/u)
  assert.match(source, /\.yk-node\.is-selected text\{fill:var\(--dsw-alias-label-primary\)!important\}/u)
  assert.match(source, /style\.textContent = css \+ stateCss \+ themeCss \+ themeRefinementCss/u)
  assert.match(source, /stateLabel\(normalizeSourceState\(item\.status\), t\)/u)
  assert.match(source, /graphStatusLabel\(selectedNode\.status, t\)/u)
  assert.doesNotMatch(source, /h\("small", null, selectedNode\.status\)/u)
})

test('announces local empty and degraded knowledge states', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')

  assert.match(source, /className: "yk-empty-compact", role: "status"/u)
  assert.match(source, /className: "yk-empty", role: "status"/u)
  assert.match(source, /className: "yk-graph-empty", role: "status"/u)
  assert.match(source, /className: "yk-node-detail yk-node-detail-empty", role: "status"/u)
  assert.match(source, /className: "yk-inline-warning", role: "status"/u)
  assert.match(source, /const interactionBusy = loading \|\| graphBusy \|\| recallBusy \|\| actionBusy/u)
  assert.match(source, /"aria-busy": interactionBusy/u)
  assert.match(source, /const loadingRef = useRef\(false\)/u)
  assert.match(source, /loadingRef\.current \|\|[\s\S]+graphBusyRef\.current \|\|[\s\S]+recallBusyRef\.current \|\|[\s\S]+actionBusyRef\.current/u)
  assert.match(source, /disabled: interactionBusy,[\s\S]+onClick: refresh/u)
  assert.match(source, /if \(!query \|\| graphBusyRef\.current\) return/u)
  assert.match(source, /if \(!query \|\| recallBusyRef\.current\) return/u)
  assert.match(source, /if \(actionBusyRef\.current\) return/u)
  assert.match(source, /disabled: interactionBusy/u)
})

test('generated client bundle is valid JavaScript and has no unresolved style token', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.doesNotMatch(source, /\$\{css\}/u)
  const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL('lib/client.js', root))], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})

test('normalizes memory confidence for safe percentage display', async () => { const source = await readFile(new URL('src/client.js', root), 'utf8'); assert.match(source, /const confidenceLabel = \(value, t\) =>/u); assert.match(source, /const normalized = parsed > 1 \? parsed \/ 100 : parsed/u); assert.match(source, /Math\.max\(0, Math\.min\(1, normalized\)\)/u); assert.match(source, /confidenceLabel\(item\.confidence \?\? item\.score, t\)/u); const client = await loadClientTestApi(); const label = key => key; assert.equal(client.confidenceLabel(null, label), 'confidence —'); assert.equal(client.confidenceLabel(0.8, label), 'confidence · 80%'); assert.equal(client.confidenceLabel(80, label), 'confidence · 80%'); assert.equal(client.confidenceLabel(-2, label), 'confidence · 0%'); assert.equal(client.confidenceLabel(140, label), 'confidence · 100%') })
test('keeps missing and invalid knowledge counts visually consistent', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.match(source, /const finiteCount = \(value\) =>/u)
  assert.match(source, /parsed >= 0 \? parsed : null/u)
  assert.match(source, /const width = safeValue === null \? 0 : Math\.min\(100/u)
  assert.doesNotMatch(source, /overview\.status === "ready" \? count\([^\n]+\) : "-"/u)
  const client = await loadClientTestApi()
  assert.equal(client.finiteCount(null), null)
  assert.equal(client.finiteCount(Infinity), null)
  assert.equal(client.finiteCount(-1), null)
  assert.equal(client.count(null), '—')
  assert.equal(client.count(4), '4')
})
test('normalizes real MCP recall envelopes and graph layout states', async () => {
  const client = await loadClientTestApi()
  assert.equal(client.normalizeSourceState('healthy'), 'ready')
  assert.equal(client.normalizeSourceState('HEALTHY'), 'ready')
  assert.equal(client.normalizeSourceState('projected'), 'ready')
  assert.equal(client.normalizeSourceState('queued'), 'queued')
  assert.equal(client.normalizeSourceState('unconfigured'), 'unavailable')
  const memories = client.recallItems({ structuredContent: { list: [
    { kind: 'document', id: 'document-1', content: 'policy' },
    { kind: 'memory', id: 'memory-1', content: 'approved process' },
  ] } })
  assert.equal(memories.length, 1)
  assert.equal(memories[0].id, 'memory-1')
  assert.equal(memories[0].status, 'CONFIRMED')
  assert.equal(Array.isArray(client.toolData({ content: [{ type: 'text', text: '{"list":[]}' }] }).list), true)
  const t = key => ({ authRequired: 'auth', permissionDenied: 'permission', requestTimeout: 'timeout', serviceUnavailable: 'service', actionFailed: 'generic' })[key]
  assert.equal(client.actionErrorLabel({ code: 'knowledge_mcp_http_401' }, t), 'auth')
  assert.equal(client.actionErrorLabel({ code: 'knowledge_mcp_http_403' }, t), 'permission')
  assert.equal(client.actionErrorLabel({ code: 'knowledge_mcp_timeout' }, t), 'timeout')
  assert.equal(client.actionErrorLabel({ code: 'knowledge_mcp_request_failed' }, t), 'service')
  assert.equal(client.actionErrorLabel({ code: 'unexpected_backend_detail' }, t), 'generic')
  const statusText = key => key
  assert.equal(client.graphStatusLabel('CONFIRMED', statusText), 'confirmed')
  assert.equal(client.graphStatusLabel('projected', statusText), 'ready')
  assert.equal(client.graphStatusLabel('CUSTOM_STATE', statusText), 'CUSTOM_STATE')
  const nodes = Array.from({ length: 12 }, (_, index) => ({ id: `memory-${index}`, type: 'MEMORY' }))
  const layout = client.graphLayout(nodes)
  assert.ok(layout.canvasHeight > 700)
  assert.ok(layout.canvasHeight > layout.positions.get('memory-11').y)
  const types = client.graphTypeCounts({ nodes: [{ type: 'MEMORY' }, { type: 'MEMORY' }, { type: 'DOCUMENT' }], edges: [{ type: 'SUPPORTS' }] })
  assert.equal(types.nodes.MEMORY, 2)
  assert.equal(types.nodes.DOCUMENT, 1)
  assert.equal(types.edges.SUPPORTS, 1)
})

test('declares structured tool output required by DSH alpha3', async () => {
  const source = await readFile(new URL('index.js', root), 'utf8')
  assert.match(source, /output:\s*TOOL_OUTPUT/u)
  assert.match(source, /schema:\s*\{/u)
  assert.match(source, /render:\s*\(/u)
})

test('routes host actions through the public MCP gateway and credential store', async () => {
  let route
  const requests = []
  apply({
    credentials: { async resolve(name) { assert.equal(name, 'MODELS_API_KEY'); return { value: 'test-key' } } },
    tools: { register() { return () => {} } },
    systemPrompt: { section() { return () => {} } },
    webServer: { register(value) { route = value; return () => {} } },
  }, { fetch: async (url, init) => { requests.push({ url: String(url), init }); return new Response(JSON.stringify({ jsonrpc: '2.0', result: { structuredContent: { ok: true } } }), { status: 200 }) } })
  const response = await invoke(route, 'POST', { action: 'search', input: { query: '哪吒' } })
  assert.equal(response.status, 200)
  assert.equal(requests[0].url, MCP_URL)
  assert.equal(requests[0].init.headers.Authorization, 'Bearer test-key')
  assert.equal(requests[0].init.redirect, 'error')
  assert.equal(JSON.parse(requests[0].init.body).params.name, 'knowledge.search')
})

test('routes graph exploration through the public MCP gateway', async () => {
  let route
  const requests = []
  apply({
    credentials: { async resolve() { return { value: 'test-key' } } },
    tools: { register() { return () => {} } },
    systemPrompt: { section() { return () => {} } },
    webServer: { register(value) { route = value; return () => {} } },
  }, { fetch: async (url, init) => { requests.push({ url: String(url), init }); return new Response(JSON.stringify({ jsonrpc: '2.0', result: { structuredContent: { nodes: [], edges: [] } } }), { status: 200 }) } })
  const response = await invoke(route, 'POST', { action: 'graph', input: { query: '哪吒企业空间', limit: 200 } })
  assert.equal(response.status, 200)
  assert.equal(requests[0].url, MCP_URL)
  assert.equal(JSON.parse(requests[0].init.body).params.name, 'knowledge.graph')
})

test('routes memory forget with the required audit reason', async () => {
  let route
  const requests = []
  apply({
    credentials: { async resolve() { return { value: 'test-key' } } },
    tools: { register() { return () => {} } },
    systemPrompt: { section() { return () => {} } },
    webServer: { register(value) { route = value; return () => {} } },
  }, { fetch: async (url, init) => { requests.push({ url: String(url), init }); return new Response(JSON.stringify({ jsonrpc: '2.0', result: { structuredContent: { status: 'FORGOTTEN' } } }), { status: 200 }) } })
  const input = { memoryId: '40000000-0000-4000-8000-000000000001', reason: 'user-requested-forget' }
  const response = await invoke(route, 'POST', { action: 'forget', input })
  assert.equal(response.status, 200)
  const rpc = JSON.parse(requests[0].init.body)
  assert.equal(rpc.params.name, 'knowledge.forget')
  assert.deepEqual(rpc.params.arguments, input)
})

test('audits knowledge writes from Agent and UI while excluding reads and input bodies', async () => {
  let route
  const registered = new Map()
  const events = []
  const ctx = {
    credentials: { async resolve() { return { value: 'test-key' } } },
    sensteedAudit: { async record(event) { events.push(event); return { status: 'stored', clientEventId: 'event-1' } } },
    tools: { register(tool) { registered.set(tool.name, tool); return () => {} } },
    systemPrompt: { section() { return () => {} } },
    webServer: { register(value) { route = value; return () => {} } },
  }
  apply(ctx, { fetch: async (_url, init) => {
    const rpc = JSON.parse(init.body)
    const id = rpc.params.name === 'knowledge.ingest_file' ? 'document-7' : 'memory-7'
    return new Response(JSON.stringify({ jsonrpc: '2.0', result: { structuredContent: { id, status: 'candidate' } } }), { status: 200 })
  } })

  await registered.get('knowledge_search').execute({ input: { query: '不得进入审计的搜索正文' } }, {})
  await registered.get('knowledge_remember').execute({ input: { content: '不得进入审计的知识正文' } }, {})
  await invoke(route, 'POST', { action: 'forget', input: { memoryId: '40000000-0000-4000-8000-000000000007', reason: '不得进入审计的原因正文' } })

  assert.equal(events.length, 2)
  assert.deepEqual(events[0], {
    actionCode: 'knowledge.memory.remembered', category: 'create',
    source: { pluginId: '@dofe/dsh-sensteed-knowledge', pluginVersion: '0.2.0', surface: 'agent_tool' },
    target: { type: 'memory', id: 'memory-7' }, outcome: 'succeeded',
    changes: [{ field: 'status', after: 'candidate' }], effects: [],
  })
  assert.equal(events[1].actionCode, 'knowledge.memory.forgotten')
  assert.equal(events[1].source.surface, 'human_ui')
  assert.equal(events[1].target.id, 'memory-7')
  assert.doesNotMatch(JSON.stringify(events), /不得进入审计/u)
})

test('marks an MCP result envelope error as a failed knowledge write', async () => {
  const registered = new Map()
  const events = []
  const ctx = {
    credentials: { async resolve() { return { value: 'test-key' } } },
    sensteedAudit: { async record(event) { events.push(event); return { status: 'stored', clientEventId: 'event-1' } } },
    tools: { register(tool) { registered.set(tool.name, tool); return () => {} } },
    systemPrompt: { section() { return () => {} } },
    webServer: { register() { return () => {} } },
  }
  apply(ctx, { fetch: async () => new Response(JSON.stringify({
    jsonrpc: '2.0', result: { isError: true, content: [{ type: 'text', text: 'private failure detail' }] },
  }), { status: 200 }) })

  await registered.get('knowledge_remember').execute({ input: { content: '不得进入审计' } }, {})

  assert.equal(events.length, 1)
  assert.equal(events[0].outcome, 'failed')
  assert.equal(events[0].errorCode, 'knowledge_mcp_tool_failed')
  assert.doesNotMatch(JSON.stringify(events), /private failure detail|不得进入审计/u)
})

test('GET overview reads overview and capabilities through the public MCP contract', async () => {
  let route
  const requests = []
  apply({
    credentials: { async resolve() { return { value: 'test-key', source: 'memory' } } },
    tools: { register() { return () => {} } },
    systemPrompt: { section() { return () => {} } },
    webServer: { register(value) { route = value; return () => {} } },
  }, {
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      assert.equal(String(url), MCP_URL)
      const rpc = JSON.parse(init.body)
      const data = rpc.params.name === 'knowledge.overview' ? {
        spaces: { total: 4 }, document_count: 58, memories: 121, pending_imports: 2,
        recent_documents: [{ id: 'd-1', title: '会员政策', updated_at: '2026-09-01T00:00:00Z' }],
      } : { contractVersion: '2026-09-05', tools: Object.values(ACTIONS) }
      return new Response(JSON.stringify({ jsonrpc: '2.0', result: { structuredContent: data } }), { status: 200 })
    },
  })

  const response = await invoke(route, 'GET')
  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'ready')
  assert.equal(response.body.mcp.auth, 'credential-store')
  assert.equal(response.body.templates.length, 1)
  assert.equal(response.body.contract.status, 'ready')
  assert.equal(response.body.permissions.allowed, true)
  assert.equal(response.body.capabilities.tools.find(item => item.remoteName === 'knowledge.remember').allowed, true)
  assert.deepEqual(response.body.overview.data, {
    spaces: 4, documents: 58, memories: 121, pendingImports: 2,
    recentDocuments: [{ id: 'd-1', title: '会员政策', content: '', status: '', type: '', scope: '', sourceType: '', updatedAt: '2026-09-01T00:00:00Z' }],
    recentMemories: [], ingestion: { queued: null, processing: null, failed: null }, health: {},
  })
  assert.equal(requests.length, 2)
  assert.ok(requests.every(request => request.url === MCP_URL))
  assert.ok(requests.every(request => request.init.headers.Authorization === 'Bearer test-key'))
})

test('GET overview marks every capability unavailable when the shared access gate is closed', async () => {
  let route
  applyKnowledge({
    dofeAccess: { ready: false, entitlements: readyAccess.entitlements },
    credentials: { async resolve() { return { value: 'test-key', source: 'memory' } } },
    tools: { register() { return () => {} } },
    systemPrompt: { section() { return () => {} } },
    webServer: { register(value) { route = value; return () => {} } },
  })
  const response = await invoke(route, 'GET')
  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'degraded')
  assert.equal(response.body.permissions.allowed, false)
  assert.ok(response.body.capabilities.tools.every(item => item.allowed === false))
})

test('GET overview failure stays isolated from route facts and templates', async () => {
  let route
  apply({
    credentials: { async resolve() { return { value: 'test-key', source: 'memory' } } },
    tools: { register() { return () => {} } },
    systemPrompt: { section() { return () => {} } },
    webServer: { register(value) { route = value; return () => {} } },
  }, {
    fetch: async url => {
      if (String(url) === MCP_URL) return new Response('upstream failed', { status: 503 })
      throw new Error(`unexpected URL ${String(url)}`)
    },
  })

  const response = await invoke(route, 'GET')
  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'ready')
  assert.equal(response.body.mcp.route, MCP_URL)
  assert.equal(response.body.templates.length, 1)
  assert.equal(response.body.contract.status, 'error')
  assert.equal(response.body.contract.reason, 'knowledge_mcp_http_503')
  assert.equal(response.body.overview.status, 'error')
  assert.equal(response.body.overview.reason, 'knowledge_mcp_http_503')
})

async function invoke(route, method, body) {
  let status = 0
  const headers = {}
  let output = ''
  const req = { method, async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(JSON.stringify(body)) } }
  const res = { writeHead(code, values) { status = code; Object.assign(headers, values) }, end(value) { output = value || '' } }
  await route.handler(req, res)
  return { status, headers, body: output ? JSON.parse(output) : null }
}
