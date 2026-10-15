import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

// Exercise the shipped element tree, including state changes, without a host
// session or network. This catches valid-JS nesting mistakes that syntax checks
// cannot detect (for example, putting the entire page inside its flex header).
export function createPage(skills = [], sharedSkills = [], createSkill = async () => {}) {
  const states = [skills, sharedSkills, '', false, [], [], '', 'ready']
  let cursor = 0
  let reference
  let component
  let dictionary
  let css = ''
  const react = {
    createElement: (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat(Infinity).filter(child => child != null && child !== false) }),
    useEffect() {},
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
    useRef(value) { return reference ??= { current: value } },
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = initial
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
  }
  const module = { exports: {} }
  runInNewContext(readFileSync(new URL('../src/client.js', import.meta.url), 'utf8'), {
    module,
    require: name => name === 'react' ? react : {},
    document: {
      createElement: () => ({ dataset: {}, remove() {} }),
      head: { appendChild: style => { css = style.textContent } },
    },
    requestAnimationFrame() {},
  })
  module.exports.apply({
    effect: callback => callback(),
    locale: { register: (_namespace, copy) => { dictionary = copy.zh }, bind: () => key => dictionary[key] },
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, value) => { if (options.name === 'main') component = value },
    },
    layout: {
      panelInfo: {
        getSnapshot: () => ({ activePanelId: 'sensteed-skill-manager' }),
        subscribe: () => () => {},
      },
    },
  })
  return {
    get css() { return css },
    createSkillConversation: module.exports.__test.createSkillConversation,
    render() { cursor = 0; return component({ t: key => dictionary[key], createSkill }) },
  }
}

export function find(node, className) {
  if (!node || typeof node !== 'object') return undefined
  if ((node.props.className || node.props.listClassName)?.split(' ').includes(className)) return node
  return [...node.children, node.props.anchor].map(child => find(child, className)).find(Boolean)
}

const fixture = [{ name: 'release-notes', description: 'Prepare release notes', source: 'user-dsh', provider: 'filesystem' }]

test('keeps the header, toolbar, installed list and shared section as separate page blocks', () => {
  const page = createPage(fixture)
  const root = page.render()
  assert.deepEqual(Array.from(find(root, 'sm-content').children, node => node.props.className), ['sm-header', 'sm-toolbar', 'sm-installed', 'sm-shared', 'sm-hub'])
  assert.deepEqual(Array.from(find(root, 'sm-header').children, node => node.props.className), ['sm-heading-copy', 'sm-actions'])
  assert.equal(find(find(root, 'sm-row'), 'sm-row-meta').children.length, 2)
})

test('starts skill creation from the menu instead of showing an inline form', async () => {
  let started = 0
  const page = createPage(fixture, [], async () => { started += 1 })
  find(page.render(), 'sm-add-more').props.onClick()
  const menu = find(page.render(), 'sm-add-menu')
  assert.equal(menu.children.length, 2)
  await menu.children[1].props.onSelect()
  const root = page.render()
  assert.equal(started, 1)
  assert.equal(find(root, 'sm-create-form'), undefined)
  assert.ok(find(root, 'sm-toolbar'))
})

test('opens the conversation before its runtime is ready, then sends the skill invocation', async () => {
  const { createSkillConversation } = createPage()
  const events = []
  let resolveReady
  const ready = new Promise(resolve => { resolveReady = resolve })
  let resolveOpened
  const opened = new Promise(resolve => { resolveOpened = resolve })
  const services = {
    sessions: {
      create: async options => { assert.deepEqual(JSON.parse(JSON.stringify(options)), { workspaceId: 'workspace-1', agentPreset: 'cordis' }); events.push('create'); return 'new-session' },
      retain: id => {
        assert.equal(id, 'new-session')
        return { ready, release: () => events.push('release') }
      },
    },
    uiWorkspace: { openSession: id => { assert.equal(id, 'new-session'); events.push('open'); resolveOpened() } },
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'workspace-1' }] }) } },
  }
  const pending = createSkillConversation({ get: name => services[name] })
  await opened
  assert.deepEqual(events, ['create', 'open'])
  resolveReady({ session: { prompt: async (messages, mode) => {
    assert.equal(mode, 'queue')
    assert.equal(messages.length, 1)
    assert.match(messages[0].text, /^\/skill-creator\n\n/)
    assert.match(messages[0].text, /请先询问/)
    events.push('prompt')
    return { ok: true }
  } } })
  assert.equal(await pending, 'new-session')
  assert.deepEqual(events, ['create', 'open', 'prompt', 'release'])
})

test('releases the conversation reference when the initial prompt fails', async () => {
  const { createSkillConversation } = createPage()
  let released = false
  const services = {
    sessions: {
      create: async () => 'new-session',
      retain: () => ({
        ready: Promise.resolve({ session: { prompt: async () => ({ ok: false, error: { message: 'send failed' } }) } }),
        release: () => { released = true },
      }),
    },
    uiWorkspace: { openSession() {} },
  }
  await assert.rejects(createSkillConversation({ get: name => services[name] }), /send failed/)
  assert.equal(released, true)
})

test('shows a retryable creation error without leaving an inline form open', async () => {
  const page = createPage(fixture, [], async () => { throw new Error('unavailable') })
  find(page.render(), 'sm-add-primary').props.onClick()
  assert.ok(find(page.render(), 'sm-install-form'))
  find(page.render(), 'sm-add-more').props.onClick()
  await find(page.render(), 'sm-add-menu').children[1].props.onSelect()
  const root = page.render()
  assert.equal(find(root, 'sm-install-form'), undefined)
  assert.equal(find(root, 'sm-error').children[0], '无法开始创建技能，请重试。')
  assert.equal(find(root, 'sm-add-more').props.disabled, false)
})

test('ignores repeated create clicks while the first session is being created', async () => {
  let started = 0
  let finish
  const page = createPage(fixture, [], () => { started++; return new Promise(resolve => { finish = resolve }) })
  const action = find(page.render(), 'sm-add-menu').children[1].props.onSelect
  const pending = action()
  await action()
  assert.equal(started, 1)
  finish()
  await pending
  assert.equal(find(page.render(), 'sm-add-primary').props.disabled, false)
})

test('lets company skills be browsed directly and searches their descriptions', () => {
  const page = createPage(fixture, [{ name: 'weekly-report', description: '公司销售周报', version: 1 }])
  find(page.render(), 'sm-filters').children[3].props.onClick()
  let root = page.render()
  assert.equal(find(root, 'sm-installed'), undefined)
  assert.ok(find(root, 'sm-shared'))
  find(root, 'sm-search').props.onInput({ currentTarget: { value: '销售' } })
  assert.ok(find(page.render(), 'sm-row'))
  find(page.render(), 'sm-search').props.onInput({ currentTarget: { value: 'missing' } })
  assert.equal(find(page.render(), 'sm-row'), undefined)
})

test('refreshes when the skill panel becomes active again', () => {
  const page = createPage(fixture)
  const root = page.render()
  assert.equal(root.children[0].children[0].children[0].children[0].children[0], '技能')
})
