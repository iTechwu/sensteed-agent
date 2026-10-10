import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../index.js'

test('knowledge advertises only granted tools and every registered schema is lossless JSON', async () => {
  const tools = new Map()
  const listeners = new Map()
  const sections = []
  const access = { ready: false, enabledPlugins: ['knowledge'], entitlements: {
    plugins: ['knowledge'], knowledge: { permissionVersion: 1, accesses: ['read', 'write'] },
  } }
  let requests = 0
  let advertised = ['search', 'remember', 'spaces', 'create_space']
  const dispose = apply({
    dofeAccess: () => access,
    credentials: { resolve: async () => ({ value: 'test-key' }) },
    tools: {
      schemas: scope => scope ? [] : advertised.map(name => ({ name: `mcp__knowledge__knowledge_${name}_testhash` })),
      register(tool) {
        assert.deepEqual(JSON.parse(JSON.stringify(tool.parameters)), tool.parameters, tool.name)
        assert.equal(tool.parameters.properties.input.type, 'object', tool.name)
        tools.set(tool.name, tool)
        return () => tools.delete(tool.name)
      },
    },
    on(name, callback) { listeners.set(name, callback); return () => listeners.delete(name) },
    systemPrompt: { section(section) { sections.push(section); return () => {} } },
  }, { fetch: async () => { requests++; throw new Error('unexpected request') } })
  const prompt = scope => sections[0].text({ scope })
  assert.equal(tools.size, 0)
  assert.equal(prompt(), '')
  access.ready = true
  listeners.get('dofe/access-changed')()
  assert.ok(tools.has('knowledge_spaces'))
  assert.ok(tools.has('knowledge_create_space'))
  assert.ok(tools.has('knowledge_remember'))
  assert.match(prompt(), /knowledge_search/)
  assert.doesNotMatch(prompt(), /财务/)
  assert.equal(prompt('restricted'), '')
  const remember = tools.get('knowledge_remember')
  access.entitlements.knowledge.accesses = ['read']
  listeners.get('dofe/access-changed')()
  assert.ok(tools.has('knowledge_search'))
  assert.equal(tools.has('knowledge_remember'), false)
  assert.equal(tools.has('knowledge_create_space'), false)
  const result = await remember.execute({ input: { content: 'test' } }, {})
  assert.equal(result.ok, false)
  assert.equal(requests, 0)
  advertised = ['search']
  listeners.get('tools/change')()
  assert.equal(tools.has('knowledge_spaces'), false)
  access.enabledPlugins = []
  listeners.get('dofe/access-changed')()
  assert.equal(tools.size, 0)
  assert.equal(prompt(), '')
  dispose()
  assert.equal(listeners.size, 0)
})
