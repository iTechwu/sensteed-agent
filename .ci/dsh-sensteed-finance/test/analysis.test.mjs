import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const head = await readFile(new URL('src/head.js', root), 'utf8')
const view = await readFile(new URL('src/views/analyze.js', root), 'utf8')
const shell = await readFile(new URL('src/shell.js', root), 'utf8')
const entries = new Function(head.slice(head.indexOf('const ANALYSIS_ENTRIES'), head.indexOf('\nconst copy =')) + '\nreturn ANALYSIS_ENTRIES')()
const expected = ['finance-monthly-risk', 'finance-cost-structure', 'finance-cash-pressure', 'finance-budget-review', 'finance-revenue-attainment', 'finance-data-quality', 'finance-cost-cash-forecast', 'finance-budget-version-health', 'finance-alert-rules-audit']

function bridge(sessions, globals = {}, catalog = async () => ({ ok: true, value: { skills: expected.map(name => ({ name })) } })) {
  const inheritedUsing = sessions.using
  sessions.using = async (id, options, callback) => inheritedUsing
    ? inheritedUsing.call(sessions, id, options, callback)
    : callback({ ready: Promise.resolve() })
  const opened = []
  const effects = new Map()
  const apply = new Function('globalThis', 'closeOverlay', 'NS', 'REQUEST_TIMEOUT_MS', `${shell}\nreturn apply`)(globals, () => {}, 'dofe.sensteed-finance', 30000)
  apply({
    effect: (callback, label) => effects.set(label, callback),
    get: name => name === 'sessions' ? sessions : name === 'remote.skills' ? { list: catalog } : { openSession: id => opened.push(id) },
    locale: { bind: () => key => key }, slots: { inject() {} },
  })
  effects.get('dofe-sensteed-finance: scoped conversation')()
  return { globals, opened }
}

function analysis(globals, navigator = {}, context = {}) {
  const values = []
  let cursor = 0
  const useState = initial => {
    const index = cursor++
    if (!(index in values)) values[index] = initial
    return [values[index], value => { values[index] = value }]
  }
  const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(Boolean) })
  function PrimaryButton() {}
  const component = new Function('globalThis', 'navigator', 'h', 'useState', 'useRef', 'ANALYSIS_ENTRIES', 'PrimaryButton', 'Glyph', 'Notice', 'financeErrorText', `${view}\nreturn AnalyzeView`)(
    globals, navigator, h, useState, initial => {
      const [ref] = useState({ current: initial })
      return ref
    }, entries, PrimaryButton, () => {}, () => {}, message => message,
  )
  const props = { ctx: { year: '2026', orgId: 'org-a', orgs: [{ id: 'org-a', name: '主体甲' }], ...context }, t: key => key }
  const nodes = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : []
  return {
    render() { cursor = 0; return nodes(component(props)).filter(node => node.type === PrimaryButton) },
    notice: () => values[0],
  }
}

test('all nine analysis buttons invoke their bundled skill in distinct new sessions', async () => {
  const sent = []
  const { globals, opened } = bridge({
    async create() { return `new-${opened.length + 1}` },
    scope: id => ({ get: () => ({ send: async prompt => sent.push({ id, prompt }) }) }),
  })
  const ui = analysis(globals)
  assert.equal(ui.render().length, expected.length)
  for (let index = 0; index < expected.length; index++) await ui.render()[index].props.onClick()
  assert.deepEqual(opened, expected.map((_, index) => `new-${index + 1}`))
  assert.deepEqual(sent.map(({ prompt }) => prompt.split('\n')[0]), expected.map(name => `/${name}`))
  for (const { prompt } of sent) {
    assert.match(prompt, /2026/)
    assert.match(prompt, /主体甲/)
    assert.match(prompt, /org-a/)
  }
  assert.equal(ui.notice(), 'sent')
})

test('analysis waits for a newly created session to be ready before sending', async () => {
  let ready = false
  const sent = []
  const { globals, opened } = bridge({
    create: async () => 'new-session',
    scope: () => ready ? { get: () => ({ send: async prompt => sent.push(prompt) }) } : undefined,
    async using(id, options, callback) {
      assert.equal(id, 'new-session')
      assert.equal(options.source, 'controllerOperation')
      await callback({ ready: Promise.resolve().then(() => { ready = true }) })
    },
  })
  await analysis(globals).render()[0].props.onClick()
  assert.deepEqual(opened, ['new-session'])
  assert.equal(sent.length, 1)
  assert.match(sent[0], /^\/finance-monthly-risk\n/)
})

test('starting locks all buttons and guards repeated clicks before re-render', async () => {
  let finish
  let calls = 0
  const ui = analysis({
    __sensteed_finance_conversation: () => ({ send: () => {
      calls++
      return new Promise(resolve => { finish = resolve })
    } }),
  })
  const buttons = ui.render()
  const running = buttons[0].props.onClick()
  await buttons[0].props.onClick()
  await buttons[1].props.onClick()
  assert.equal(calls, 1)
  assert.ok(ui.render().every(button => button.props.disabled))
  assert.equal(ui.render()[0].props.busy, true)
  finish()
  await running
  assert.ok(ui.render().every(button => !button.props.disabled))
})

test('failed creation preserves the skill prompt, keeps the view open and permits retry', async () => {
  const copied = []
  let closed = false
  const { globals } = bridge({ create: async () => { throw new Error('conversation_unavailable') } })
  globals.__sensteed_finance_close = () => { closed = true }
  const ui = analysis(globals, { clipboard: { writeText: async prompt => copied.push(prompt) } })
  await ui.render()[0].props.onClick()
  assert.equal(closed, false)
  assert.equal(ui.notice(), 'sendFailReason')
  assert.match(copied[0], /^\/finance-monthly-risk\n/)
  assert.ok(ui.render().every(button => !button.props.disabled))
  globals.__sensteed_finance_conversation = () => ({ send: async () => {} })
  await ui.render()[0].props.onClick()
  assert.equal(closed, true)
  assert.equal(ui.notice(), 'sent')
})

test('missing conversation and clipboard report failure without claiming analysis started', async () => {
  for (const navigator of [{}, { clipboard: { writeText: async () => { throw new Error('denied') } } }]) {
    const ui = analysis({}, navigator)
    await ui.render()[0].props.onClick()
    assert.equal(ui.notice(), 'copyFailed')
    assert.ok(ui.render().every(button => !button.props.disabled))
  }
})


test('unresolved selected org keeps its identifier and never widens analysis to all orgs', async () => {
  const sent = []
  const ui = analysis({ __sensteed_finance_conversation: () => ({ send: async prompt => sent.push(prompt) }) }, {}, { orgs: [] })
  for (const button of ui.render()) await button.props.onClick()
  assert.equal(sent.length, expected.length)
  for (const prompt of sent) {
    assert.match(prompt, /2026/)
    assert.match(prompt, /所选主体 ID：org-a/)
    assert.match(prompt, /名称：待核实/)
    assert.doesNotMatch(prompt, /请(?:对|分析|复盘|为)全部主体/)
  }
})


test('missing or failed session skill catalog blocks submission and keeps the prompt for retry', async () => {
  for (const catalog of [
    async () => ({ ok: true, value: { skills: [] } }),
    async () => ({ ok: false, error: { code: 'UNAVAILABLE' } }),
    async () => { throw new Error('catalog failure') },
  ]) {
    const sent = [], copied = []
    const { globals, opened } = bridge({ create: async () => 'new-missing', scope: () => ({ get: () => ({ send: async prompt => sent.push(prompt) }) }) }, {}, catalog)
    let closed = false
    globals.__sensteed_finance_close = () => { closed = true }
    const ui = analysis(globals, { clipboard: { writeText: async prompt => copied.push(prompt) } })
    await ui.render()[0].props.onClick()
    assert.deepEqual(opened, ['new-missing'])
    assert.deepEqual(sent, [])
    assert.equal(closed, false)
    assert.equal(copied.length, 1)
    assert.match(copied[0], /^\/finance-monthly-risk\n/)
    assert.equal(ui.notice(), 'sendFailReason')
    assert.ok(ui.render().every(button => !button.props.disabled))
  }
})

test('catalog is checked for the new session after readiness and ownership lasts through send', async () => {
  const order = []
  const { globals } = bridge({
    create: async () => 'new-owned',
    scope: () => ({ get: () => ({ send: async () => { order.push('send') } }) }),
    async using(id, options, callback) {
      order.push('retain')
      try { await callback({ ready: Promise.resolve().then(() => { order.push('ready') }) }) }
      finally { order.push('release') }
    },
  }, {}, async ({ sessionId }, signal) => {
    assert.equal(sessionId, 'new-owned')
    assert.ok(signal instanceof AbortSignal)
    order.push('catalog')
    return { ok: true, value: { skills: [{ name: 'finance-monthly-risk' }] } }
  })
  await analysis(globals).render()[0].props.onClick()
  assert.deepEqual(order, ['retain', 'ready', 'catalog', 'send', 'release'])
})
