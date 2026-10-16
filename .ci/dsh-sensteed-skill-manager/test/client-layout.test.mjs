import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

// Exercise the shipped element tree, including state changes, without a host
// session or network. This catches valid-JS nesting mistakes that syntax checks
// cannot detect (for example, putting the entire page inside its flex header).
export function createPage(skills = [], sharedSkills = [], createSkill = async () => {}, overrides = {}) {
  const states = [skills, sharedSkills, '', false, [], [], '', false, false, 'ready']
  let cursor = 0
  let refCursor = 0
  let effectCursor = 0
  const effects = []
  const refs = []
  let component
  let dictionary
  let css = ''
  const react = {
    createElement: (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat(Infinity).filter(child => child != null && child !== false) }),
    useEffect(callback, deps) {
      const index = effectCursor++
      const previous = effects[index]
      if (!previous || deps.some((value, offset) => value !== previous[offset])) {
        effects[index] = deps
        return callback()
      }
    },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
    useRef(value) {
      const index = refCursor++
      return refs[index] ??= { current: value }
    },
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = initial
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
  }
  const module = { exports: {} }
  runInNewContext(readFileSync(new URL('../src/client.js', import.meta.url), 'utf8'), {
    module,
    fetch: overrides.fetch,
    window: { addEventListener() {}, removeEventListener() {}, open: overrides.open ?? (() => {}) },
    AbortSignal,
    URL,
    setTimeout,
    clearTimeout,
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
        getSnapshot: () => ({ activePanelId: overrides.fetch ? 'sensteed-skill-manager' : 'other-panel' }),
        subscribe: () => () => {},
      },
    },
  })
  return {
    get css() { return css },
    createSkillConversation: module.exports.__test.createSkillConversation,
    render() { cursor = 0; refCursor = 0; effectCursor = 0; return component({ t: key => dictionary[key], createSkill, panelInfo: {
      subscribe: () => () => {}, getSnapshot: () => ({ activePanelId: overrides.fetch ? 'sensteed-skill-manager' : 'other-panel' }),
    } }) },
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

test('offers a one-click desktop sign-in when the hub requires SSO', async () => {
  const calls = []
  let signedIn = false
  const fetchMock = async (path, init) => {
    calls.push([path, init?.method])
    if (path.startsWith('/api/desktop/sensteed/skills?')) {
      return { ok: true, json: async () => ({ skills: [], sharedSkills: [], hubWorkspaceError: signedIn ? null : '请先在桌面端登录企业账号。', hubErrorCode: signedIn ? null : 'HUB_SSO_REQUIRED', hubSkills: [], hubPlugins: [] }) }
    }
    if (path === '/api/desktop/auth/feishu/session') { signedIn = true; return { ok: true, json: async () => ({ status: 'pending' }) } }
    return { ok: true, json: async () => ({ status: 'bound' }) }
  }
  const page = createPage(fixture, [], async () => {}, { fetch: fetchMock })
  // 挂载即触发 refresh(异步),等微任务落地后进入 SSO 引导态
  page.render()
  await new Promise(resolve => setTimeout(resolve, 0))
  const errorRow = find(page.render(), 'sm-inline-error')
  assert.ok(errorRow, 'SSO error row renders')
  const signIn = errorRow.children.find(child => child?.props?.className === 'sm-quiet')
  assert.equal(signIn.children[0], '登录企业账号')
  // 点击登录:触发桌面端 SSO,轮询绑定成功后自动刷新目录
  await signIn.props.onClick()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(find(page.render(), 'sm-inline-error'), undefined, 'hub recovers after desktop sign-in')
  assert.ok(calls.some(([path, method]) => path === '/api/desktop/auth/feishu/session' && method === 'POST'))
  assert.ok(calls.some(([path, method]) => path === '/api/desktop/auth/feishu/status' && method === 'POST'))
})

test('keeps a retry button instead of sign-in for non-SSO hub failures', async () => {
  const fetchMock = async () => ({ ok: true, json: async () => ({ skills: [], sharedSkills: [], hubWorkspaceError: 'Hub request failed (502).', hubErrorCode: null, hubSkills: [], hubPlugins: [] }) })
  const page = createPage(fixture, [], async () => {}, { fetch: fetchMock })
  page.render()
  await new Promise(resolve => setTimeout(resolve, 0))
  const errorRow = find(page.render(), 'sm-inline-error')
  assert.ok(errorRow, 'plain hub failure renders the error row')
  assert.equal(errorRow.children.find(child => child?.props?.className === 'sm-quiet').children[0], '重试')
})

test('opens hub entries through the ticket exchange URL and falls back to the plain page', async () => {
  const hubItem = { skillId: 'c78ad665-640e-4053-9791-336cd7b1199d', slug: 'release-notes', displayName: 'Release notes', description: 'd', stableVersion: 2, kind: 'skill' }
  let viewUrlBroken = true
  const opened = []
  const fetchMock = async (path, init) => {
    if (path.startsWith('/api/desktop/sensteed/skills?')) {
      return { ok: true, json: async () => ({ skills: [], sharedSkills: [], hubError: null, hubErrorCode: null, hubSkills: [hubItem], hubPlugins: [] }) }
    }
    // view-url:先 500(回退),恢复后给换票地址
    if (viewUrlBroken) return { ok: false, json: async () => null }
    return { ok: true, json: async () => ({ url: 'https://ai.hozonauto.com/plugins/api/auth/oidc/exchange?ticket=t' }) }
  }
  const page = createPage([], [], async () => {}, {
    fetch: fetchMock,
    open: url => { opened.push(url) },
  })
  page.render()
  await new Promise(resolve => setTimeout(resolve, 0))
  // 服务端未上线:回退直开网页
  const openButton = () => find(page.render(), 'sm-row').children.find(child => child?.props?.className === 'sm-row-meta').children.find(child => child?.tag === 'button' && child.children[0] === '在 Hub 查看')
  await openButton().props.onClick()
  assert.deepEqual(opened, [`https://ai.hozonauto.com/plugins/skills/${hubItem.skillId}`])
  // 换票服务可用:打开票据交换地址
  viewUrlBroken = false
  await openButton().props.onClick()
  assert.deepEqual(opened, [`https://ai.hozonauto.com/plugins/skills/${hubItem.skillId}`, 'https://ai.hozonauto.com/plugins/api/auth/oidc/exchange?ticket=t'])
})

test('renders local skills before stalled remote sources and preserves a healthy Hub domain', async () => {
  let finishHub
  const hub = new Promise(resolve => { finishHub = resolve })
  const page = createPage([], [], async () => {}, { fetch: async path => {
    if (path.endsWith('source=local')) return { ok: true, json: async () => ({ skills: fixture }) }
    if (path.endsWith('source=hub')) return hub
    return new Promise(() => {})
  } })
  page.render()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(find(page.render(), 'sm-installed'))
  assert.equal(find(find(page.render(), 'sm-installed'), 'sm-row').children[1].children[0].children[0], 'release-notes')
  finishHub({ ok: true, json: async () => ({ hubSkills: [], hubSkillsError: 'Skills unavailable', hubPlugins: [{ pluginId: '10000000-0000-4000-8000-000000000001', displayName: 'Healthy plugin' }] }) })
  await new Promise(resolve => setTimeout(resolve, 0))
  const hubSection = find(page.render(), 'sm-hub')
  assert.ok(find(hubSection, 'sm-row'))
  assert.equal(find(hubSection, 'sm-inline-error').children[0], 'Skills unavailable')
})

test('shows a review and explicit confirm/cancel before enterprise execution; plugins remain unsupported',async () => {
  const id='c78ad665-640e-4053-9791-336cd7b1199d',calls=[]
  const fetchMock=async(path,init)=>{
    calls.push({path,body:init?.body})
    if(path.includes('?source=hub'))return {ok:true,json:async()=>({hubSkills:[{skillId:id,slug:'reviewed-skill',displayName:'Reviewed',stableVersion:'1.0.0'}],hubPlugins:[{pluginId:id,displayName:'Plugin',stableVersion:'1.0.0'}]})}
    if(path.includes('?source='))return {ok:true,json:async()=>({skills:[],sharedSkills:[]})}
    if(path.endsWith('/operations'))return {ok:true,json:async()=>({installed:[],operations:[]})}
    if(path.endsWith('/preview'))return {ok:true,json:async()=>({intentId:id,action:'install',installName:'reviewed-skill',version:'1.0.0',existingVersion:null,workspace:{ssoTeam:{name:'企业'}},compatibility:{authorDeclared:'>=0.2.0',tested:false},accessDeclaration:{containsScripts:false,networkHosts:[],fileAccess:'none'},sharedScope:true})}
    if(path.endsWith('/execute'))return {ok:true,json:async()=>({state:'WRITTEN'})}
    throw Error('unexpected route')
  }
  const page=createPage([],[],async()=>{},{fetch:fetchMock}),all=(node)=>node && typeof node==='object'?[node,...node.children.flatMap(all)]:[]
  page.render();await new Promise(resolve=>setTimeout(resolve,0))
  let nodes=all(page.render()),install=nodes.find(node=>node.tag==='button' && node.children[0]==='安装')
  assert.ok(nodes.some(node=>node.children[0]==='插件尚不支持安装'))
  await install.props.onClick()
  assert.equal(calls.filter(call=>call.path.endsWith('/execute')).length,0)
  let dialog=all(page.render()).find(node=>node.props.role==='dialog')
  assert.ok(dialog);assert.ok(all(dialog).some(node=>node.children[0]==='此操作影响本机所有 Profile 的共享技能。'))
  all(dialog).find(node=>node.tag==='button'&&node.children[0]==='取消').props.onClick()
  assert.equal(all(page.render()).some(node=>node.props.role==='dialog'),false)
  nodes=all(page.render());await nodes.find(node=>node.tag==='button'&&node.children[0]==='安装').props.onClick()
  dialog=all(page.render()).find(node=>node.props.role==='dialog')
  await all(dialog).find(node=>node.tag==='button'&&node.children[0]==='确认安装').props.onClick()
  assert.equal(calls.filter(call=>call.path.endsWith('/execute')).length,1)
  assert.deepEqual(JSON.parse(calls.find(call=>call.path.endsWith('/execute')).body),{intentId:id})
})
