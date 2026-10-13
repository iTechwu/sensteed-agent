import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../index.js'

test('finance tools and guidance follow authorization, connections, and scoped visibility', () => {
  const tools = new Map()
  const listeners = new Map()
  const sections = []
  let allowed = false
  let connected = true
  const emit = name => listeners.get(name)?.()
  const dispose = apply({
    dofeAccess: () => ({ ready: true, financeAllowed: allowed }),
    webServer: { port: 1, register: () => () => {} },
    on(name, callback) { listeners.set(name, callback); return () => listeners.delete(name) },
    tools: {
      schemas: scope => connected && scope !== 'restricted' ? [{ name: 'mcp__finance__query' }] : [],
      register(tool) {
        tools.set(tool.name, tool)
        emit('tools/change')
        return () => { tools.delete(tool.name); emit('tools/change') }
      },
    },
    systemPrompt: { section(section) { sections.push(section); return () => {} } },
  })
  const prompt = scope => sections[0].text({ scope })
  assert.equal(tools.size, 0)
  assert.equal(prompt(), '')
  allowed = true
  emit('dofe/access-changed')
  assert.ok(tools.has('sensteed_finance_bootstrap'))
  assert.match(prompt(), /finance_analysis_brief/)
  assert.equal(prompt('restricted'), '')
  connected = false
  emit('tools/change')
  assert.equal(tools.size, 0)
  assert.equal(prompt(), '')
  connected = true
  emit('tools/change')
  assert.equal(tools.size, 1)
  allowed = false
  emit('dofe/access-changed')
  assert.equal(tools.size, 0)
  assert.equal(prompt(), '')
  dispose()
  assert.equal(listeners.size, 0)
})
