import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const head = await readFile(new URL('src/head.js', root), 'utf8')
const view = await readFile(new URL('src/views/analyze.js', root), 'utf8')
const shell = await readFile(new URL('src/shell.js', root), 'utf8')
const entries = new Function(head.slice(head.indexOf('const ANALYSIS_ENTRIES'), head.indexOf('\nconst copy =')) + '\nreturn ANALYSIS_ENTRIES')()
const expected = ['finance-monthly-risk', 'finance-cost-structure', 'finance-cash-pressure', 'finance-budget-review', 'finance-revenue-attainment', 'finance-data-quality', 'finance-cost-cash-forecast', 'finance-budget-version-health', 'finance-alert-rules-audit']

function bridge(sessions, globals = {}, catalog = async () => ({ ok: true, value: { skills: expected.map(name => ({ name })) } }), access = async () => ({ ok: true, allowed: true }), openSession) {
  const inheritedUsing = sessions.using
  sessions.using = async (id, options, callback) => inheritedUsing
    ? inheritedUsing.call(sessions, id, options, callback)
    : callback({ ready: Promise.resolve() })
  const opened = []
  const effects = new Map()
  const apply = new Function('globalThis', 'closeOverlay', 'NS', 'REQUEST_TIMEOUT_MS', 'ANALYSIS_ENTRIES', 'api', `${shell}\nreturn apply`)(globals, () => {}, 'dofe.sensteed-finance', 30000, entries, access)
  apply({
    effect: (callback, label) => effects.set(label, callback),
    get: name => name === 'sessions' ? sessions : name === 'remote.skills' ? { list: catalog } : { openSession: id => openSession ? openSession(id) : opened.push(id) },
    locale: { bind: () => key => key }, slots: { inject() {} },
  })
  effects.get('dofe-sensteed-finance: scoped conversation')()
  return { globals, opened }
}

function analysis(globals, navigator = {}, context = {}, translate = key => key) {
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
  const props = { ctx: { year: '2026', orgId: 'org-a', orgs: [{ id: 'org-a', name: '主体甲' }], ...context }, t: translate }
  const nodes = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : []
  return {
    render() { cursor = 0; return nodes(component(props)).filter(node => node.type === PrimaryButton) },
    notice: () => values[0],
    tree() { cursor = 0; return nodes(component(props)) },
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
    assert.equal(ui.notice(), 'sendFailCopyFailed')
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
    assert.deepEqual(opened, [])
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

const dictionaries = new Function(head.slice(head.indexOf('const copy ='), head.indexOf('\nlet opened')) + '\nreturn copy')()
const translate = language => (key, values = {}) => (dictionaries[language][key] || key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '')

test('each start rechecks assistant access before creating a session and rejects expired or unavailable access', async () => {
  const cases = [
    [async () => ({ ok: true, allowed: false }), 'analysisAccessDenied'],
    [async () => { throw Object.assign(new Error('expired'), { status: 401 }) }, 'analysisLoginRequired'],
    [async () => { throw Object.assign(new Error('forbidden'), { status: 403 }) }, 'analysisAccessDenied'],
    [async () => { throw Object.assign(new Error('upstream failure'), { status: 503 }) }, 'analysisAccessUnavailable'],
    [async () => ({ ok: true }), 'analysisAccessUnavailable'],
    [async () => ({ ok: false, allowed: true }), 'analysisAccessUnavailable'],
  ]
  for (const [access, reason] of cases) {
    let created = 0, catalogCalls = 0
    const { globals, opened } = bridge({ create: async () => { created++; return 'unauthorized' } }, {}, async () => { catalogCalls++ }, async path => {
      assert.equal(path, '/access?permission=finance.assistant.read')
      return access()
    })
    const t = translate('zh')
    const ui = analysis(globals, {}, {}, t)
    await ui.render()[0].props.onClick()
    assert.equal(created, 0)
    assert.equal(catalogCalls, 0)
    assert.deepEqual(opened, [])
    assert.ok(ui.notice().includes(t(reason)))
    assert.ok(ui.tree().some(node => node.type === 'textarea' && node.props.value.startsWith('/finance-monthly-risk\n')))
    assert.ok(ui.render().every(button => !button.props.disabled))
  }
})

test('permission revocation between clicks cannot reuse a prior successful access check', async () => {
  let allowed = true, calls = 0, created = 0
  const { globals } = bridge({ create: async () => `session-${++created}`, scope: () => ({ get: () => ({ send: async () => {} }) }) }, {}, undefined, async () => {
    calls++; return { ok: true, allowed }
  })
  const ui = analysis(globals)
  await ui.render()[0].props.onClick()
  allowed = false
  await ui.render()[1].props.onClick()
  assert.equal(calls, 2)
  assert.equal(created, 1)
  assert.equal(ui.notice(), 'sendFailCopyFailed')
})

test('clipboard failure keeps the original reason and an exact manually copyable prompt in both locales', async () => {
  for (const language of ['zh', 'en']) {
    let attempts = 0
    const { globals } = bridge({ create: async () => `session-${++attempts}`, scope: () => ({ get: () => ({ send: async () => { if (attempts === 1) throw new Error('rejected private diagnostic') } }) }) })
    let closed = 0
    globals.__sensteed_finance_close = () => { closed++ }
    const t = translate(language)
    const ui = analysis(globals, { clipboard: { writeText: async () => { throw new Error('denied') } } }, {}, t)
    await ui.render()[0].props.onClick()
    const recovery = ui.tree().find(node => node.type === 'textarea')
    assert.equal(recovery.props.readOnly, true)
    assert.equal(recovery.props['aria-label'], t('analysisPromptLabel'))
    assert.match(recovery.props.value, /^\/finance-monthly-risk\n/)
    assert.match(recovery.props.value, /org-a/)
    assert.ok(ui.notice().includes(t('analysisStartFailed')))
    assert.ok(!ui.notice().includes('private diagnostic'))
    assert.equal(closed, 0)
    await ui.render()[0].props.onClick()
    assert.equal(closed, 1)
    assert.equal(ui.notice(), t('sent'))
    assert.equal(ui.tree().some(node => node.type === 'textarea'), false)
  }
})

test('visible scope matches the selected year and stable entity id including unresolved and all-authorized scopes', () => {
  for (const context of [{ year: '2027' }, { orgs: [] }, { orgId: '' }]) {
    const ui = analysis({}, {}, context, translate('en'))
    const scope = ui.tree().find(node => node.props.role === 'status').children.join('')
    assert.ok(scope.includes(context.year || '2026'))
    if (context.orgId === '') assert.ok(scope.includes('All authorized entities'))
    else assert.ok(scope.includes('org-a'))
    if (context.orgs) assert.ok(scope.includes('Name pending verification'))
  }
})

test('accepted analysis survives navigation failure and reopening never creates or sends a second request', async () => {
  for (const language of ['zh', 'en']) {
    let created = 0, sends = 0, copies = 0, navigationFails = true
    const destinations = []
    const { globals } = bridge({
      create: async () => `accepted-${++created}`,
      scope: () => ({ get: () => ({ send: async () => { sends++ } }) }),
    }, {}, undefined, undefined, async id => {
      destinations.push(id)
      if (navigationFails) throw new Error('private navigation diagnostic')
    })
    const t = translate(language)
    const ui = analysis(globals, { clipboard: { writeText: async () => { copies++ } } }, {}, t)
    await ui.render()[0].props.onClick()
    assert.equal(ui.notice(), t('analysisSentNotOpened'))
    assert.equal(ui.tree().some(node => node.type === 'textarea'), false)
    const starts = ui.render().filter(button => button.props['aria-label'] !== t('analysisOpenSession'))
    assert.ok(starts.every(button => button.props.disabled))
    await starts[0].props.onClick()
    const reopen = () => ui.render().find(button => button.props['aria-label'] === t('analysisOpenSession'))
    await reopen().props.onClick()
    assert.equal(ui.notice(), t('analysisSentNotOpened'))
    navigationFails = false
    await reopen().props.onClick()
    assert.equal(ui.notice(), t('sent'))
    assert.equal(created, 1)
    assert.equal(sends, 1)
    assert.equal(copies, 0)
    assert.deepEqual(destinations, ['accepted-1', 'accepted-1', 'accepted-1'])
  }
})

test('post-submission reference cleanup failure cannot turn accepted work into an unsent prompt', async () => {
  let sends = 0, copies = 0
  const { globals, opened } = bridge({
    create: async () => 'accepted-cleanup',
    scope: () => ({ get: () => ({ send: async () => { sends++ } }) }),
    async using(_id, _options, run) { await run({ ready: Promise.resolve() }); throw new Error('reference cleanup failed') },
  })
  const ui = analysis(globals, { clipboard: { writeText: async () => { copies++ } } })
  await ui.render()[0].props.onClick()
  assert.equal(ui.notice(), 'sent')
  assert.deepEqual(opened, ['accepted-cleanup'])
  assert.equal(sends, 1)
  assert.equal(copies, 0)
})

test('closing the finance panel after accepted submission cannot report a send failure', async () => {
  for (const close of [() => { throw new Error('panel cleanup failed') }, async () => { throw new Error('panel cleanup rejected') }]) {
    let copies = 0
    const { globals, opened } = bridge({ create: async () => 'accepted-close', scope: () => ({ get: () => ({ send: async () => {} }) }) })
    globals.__sensteed_finance_close = close
    const ui = analysis(globals, { clipboard: { writeText: async () => { copies++ } } })
    await ui.render()[0].props.onClick()
    assert.equal(ui.notice(), 'sent')
    assert.deepEqual(opened, ['accepted-close'])
    assert.equal(copies, 0)
  }
})

test('the operation keeps session ownership until asynchronous navigation has completed', async () => {
  let retained = false
  const order = []
  const { globals } = bridge({
    create: async () => 'accepted-retained',
    scope: () => ({ get: () => ({ send: async () => { order.push('send') } }) }),
    async using(_id, _options, run) {
      retained = true
      try { await run({ ready: Promise.resolve() }) }
      finally { retained = false; order.push('release') }
    },
  }, {}, undefined, undefined, async () => {
    await Promise.resolve()
    assert.equal(retained, true)
    order.push('open')
  })
  await analysis(globals).render()[0].props.onClick()
  assert.deepEqual(order, ['send', 'open', 'release'])
})
