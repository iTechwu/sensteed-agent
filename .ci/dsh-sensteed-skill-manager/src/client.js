const React = require('react')
const { createElement: h, useEffect, useRef, useState, useSyncExternalStore } = React
const { Menu, MenuItemButton, IconDataOutlineRegular, IconSkillOutlineRegular, IconCloseOutlineRegular,
  IconRefreshOutlineRegular, IconPlusOutlineRegular, IconChevronDownOutlineRegular,
  IconDownloadOutlineRegular, IconAgentPresetOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')
const PANEL_ID = 'sensteed-skill-manager'
const NS = 'sensteed.skill-manager'
// 安装对话框的触发元素;关闭后焦点回到它(与 knowledge 插件同一契约)。
let lastTrigger = null
const ROUTE = '/api/desktop/sensteed/skills'
const COPY = {
  zh: {
    title: '技能', description: '安装、创建和管理 Agent 技能', refresh: '刷新', add: '添加技能', chooseAddMethod: '选择添加技能方式',
    create: '让 Agent 创建', install: '安装第三方技能', empty: '还没有可用的技能', installedTitle: '已安装技能',
    loading: '正在读取技能…', refreshing: '正在刷新技能…', refreshFailed: '技能列表刷新失败。', serviceUnavailable: '技能服务暂时不可用，请稍后重试。', retry: '重试', repository: 'GitHub 仓库或技能目录链接',
    installAction: '安装', cancel: '取消', installing: '正在安装…', installed: '已安装',
    publish: '上传到公司', publishing: '正在上传…', publishSuccess: '已发布到公司技能库', publishError: '发布失败，请稍后重试。',
    shared: '公司共享', sharedEmpty: '公司技能库还没有技能', sharedUnavailable: '暂时无法读取公司技能库', sharedInstall: '安装', sharedUpdate: '更新', sharedInstalled: '已安装', sharedLoading: '正在读取公司技能库…',
    hub: '企业 Hub', hubEmpty: '企业 Hub 目录还没有内容', hubUnavailable: '暂时无法读取企业 Hub（需桌面端登录企业账号）', hubOpen: '在 Hub 查看', hubSkillsTitle: 'Hub 技能', hubPluginsTitle: 'Hub 插件', hubHint: '发布、审核与安装计划在 Hub 工作台完成。', hubSignIn: '登录企业账号', hubSigningIn: '正在打开登录…',
    withdraw: '撤回', withdrawing: '正在撤回…', withdrawSuccess: '已从公司技能库撤回',
    installHint: '可粘贴单技能仓库，或合集仓库中某个技能的 /tree/ 分支目录链接。来源可信后再安装。Skill 会在本机加载。',
    installError: '安装失败，请检查仓库地址和技能结构。', installSuccess: '已安装 {name}', bundled: '内置', local: '本机',
    search: '搜索技能名称或说明', all: '全部', filterBySource: '按来源筛选', noMatches: '没有匹配的技能',
    createHint: '进入会话，由 Agent 引导你创建技能。',
    createFailed: '无法开始创建技能，请重试。', close: '关闭', creating: '正在打开会话…',
    installMenuHint: '从 GitHub 仓库或技能目录安装到本机。',
  },
  en: {
    title: 'Skills', description: 'Install, create, and manage Agent skills', refresh: 'Refresh', add: 'Add skill', chooseAddMethod: 'Choose how to add a skill',
    create: 'Create with Agent', install: 'Install third-party skill', empty: 'No skills available yet', installedTitle: 'Installed skills',
    loading: 'Loading skills…', refreshing: 'Refreshing skills…', refreshFailed: 'Could not refresh the skill list.', serviceUnavailable: 'The skill service is temporarily unavailable. Try again later.', retry: 'Retry', repository: 'GitHub repository or skill directory URL',
    installAction: 'Install', cancel: 'Cancel', installing: 'Installing…', installed: 'Installed',
    publish: 'Share with company', publishing: 'Publishing…', publishSuccess: 'Published to company skills', publishError: 'Could not publish this skill. Try again.',
    shared: 'Company shared', sharedEmpty: 'No company skills yet', sharedUnavailable: 'Company skills are temporarily unavailable', sharedInstall: 'Install', sharedUpdate: 'Update', sharedInstalled: 'Installed', sharedLoading: 'Loading company skills…',
    hub: 'Company hub', hubEmpty: 'The company hub catalog is empty', hubUnavailable: 'The company hub is temporarily unavailable (desktop enterprise sign-in required)', hubOpen: 'Open in hub', hubSkillsTitle: 'Hub skills', hubPluginsTitle: 'Hub plugins', hubHint: 'Publishing, review, and install plans happen in the hub workspace.', hubSignIn: 'Sign in to company', hubSigningIn: 'Opening sign-in…',
    withdraw: 'Withdraw', withdrawing: 'Withdrawing…', withdrawSuccess: 'Removed from company skills',
    installHint: 'Paste a single-skill repository or a /tree/ link to one skill in a collection. Install trusted sources only.',
    installError: 'Installation failed. Check the repository URL and skill structure.', installSuccess: 'Installed {name}', bundled: 'Built in', local: 'Local',
    search: 'Search skill names and descriptions', all: 'All', filterBySource: 'Filter by source', noMatches: 'No matching skills',
    createHint: 'Open a conversation and let Agent guide you through skill creation.',
    createFailed: 'Could not start skill creation. Try again.', close: 'Close', creating: 'Opening conversation…',
    installMenuHint: 'Install a GitHub repository or skill directory locally.',
  },
}

const REQUEST_TIMEOUT_MS = 30000
// Repository installs stream remote archives through the host route; they keep
// the same bounded policy with a longer ceiling.
const REQUEST_TIMEOUT_MS2 = 120000

async function request(path = '', options = {}) {
  const response = await fetch(`${ROUTE}${path}`, {
    ...options,
    credentials: 'same-origin',
    redirect: 'error',
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const failure = new Error(body?.error || `HTTP ${response.status}`)
    failure.statusCode = response.status
    throw failure
  }
  return body
}

async function requestLong(path = '', options = {}) {
  const response = await fetch(`${ROUTE}${path}`, {
    ...options,
    credentials: 'same-origin',
    redirect: 'error',
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS2),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const failure = new Error(body?.error || `HTTP ${response.status}`)
    failure.statusCode = response.status
    throw failure
  }
  return body
}

const HUB_WEB_BASE = 'https://ai.hozonauto.com/plugins'

// 打开 Hub 网页优先走宿主换票(一次性短票换免登录会话);宿主不可用或
// 返回非 https 地址时回退直开,行为与此前一致。
async function openHubItem(kind) {
  const fallback = `${HUB_WEB_BASE}/${kind === 'plugin' ? 'plugins' : 'skills'}`
  try {
    const body = await request('/hub/view-url', { method: 'POST', body: JSON.stringify({ kind }) })
    if (typeof body?.url === 'string' && body.url.startsWith('https://')) {
      window.open(body.url, '_blank', 'noopener')
      return
    }
  }
  catch { /* 回退直开 */ }
  window.open(fallback, '_blank', 'noopener')
}

function hubRow(item, t) {
  return h('article', { className: 'sm-row', key: `hub:${item.kind}:${item.name}` },
    h('div', { className: 'sm-glyph', 'aria-hidden': true }, h(IconSkillOutlineRegular, { size: 24 })),
    h('div', { className: 'sm-copy' }, h('strong', null, item.displayName || item.name), h('p', { title: item.description }, item.description)),
    h('div', { className: 'sm-row-meta' },
      item.version ? h('span', { className: 'sm-version' }, `v${item.version}`) : null,
      h('button', { type: 'button', className: 'sm-row-action', onClick: () => openHubItem(item.kind) }, t('hubOpen'))))
}

function SkillManagerPage({ view, t, createSkill, panelInfo }) {
  const [skills, setSkills] = useState([])
  const [sharedSkills, setSharedSkills] = useState([])
  const [sharedError, setSharedError] = useState('')
  const [sharedLoading, setSharedLoading] = useState(true)
  const [hubSkills, setHubSkills] = useState([])
  const [hubPlugins, setHubPlugins] = useState([])
  const [hubError, setHubError] = useState('')
  const [hubSsoRequired, setHubSsoRequired] = useState(false)
  const [hubSigningIn, setHubSigningIn] = useState(false)
  const [state, setState] = useState('loading')
  const [formOpen, setFormOpen] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [repository, setRepository] = useState('')
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const [notice, setNotice] = useState('')
  const operation = useRef(false)
  // The main slot stays mounted while the user moves between global panels.
  // Refresh on activation so the list reflects installs made elsewhere without
  // issuing a request while the page is hidden.
  const isActive = panelInfo?.subscribe && panelInfo?.getSnapshot
    ? useSyncExternalStore(panelInfo.subscribe, () => panelInfo.getSnapshot().activePanelId === PANEL_ID, () => true)
    : true
  const restoreTriggerFocus = () => {
    requestAnimationFrame(() => lastTrigger?.focus())
  }
  const closeInstall = () => {
    if (operation.current) return
    setFormOpen(false)
    restoreTriggerFocus()
  }
  // 自持对话框键盘契约:Escape 关闭,关闭后焦点回到触发按钮。
  useEffect(() => {
    if (!formOpen) return undefined
    const key = event => { if (event.key === 'Escape') closeInstall() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [formOpen])
  const repositoryInput = useRef(null)
  useEffect(() => {
    if (formOpen) repositoryInput.current?.focus()
  }, [formOpen])

  const refresh = async () => {
    setState(state === 'ready' || skills.length > 0 || sharedSkills.length > 0 ? 'refreshing' : 'loading')
    setError('')
    setRefreshError('')
    setNotice('')
    try {
      const body = await request()
      setSkills(body.skills || [])
      setSharedSkills(body.sharedSkills || [])
      setSharedError(body.sharedError || '')
      setSharedLoading(false)
      setHubSkills((body.hubSkills || []).map(item => ({ name: item.slug, displayName: item.displayName, description: item.description, version: item.stableVersion, kind: 'skill' })))
      setHubPlugins((body.hubPlugins || []).map(item => ({ name: item.npmPackageName || item.pluginId, displayName: item.displayName, description: item.description, version: item.stableVersion, kind: 'plugin' })))
      setHubError(body.hubError || '')
      setHubSsoRequired(body.hubErrorCode === 'HUB_SSO_REQUIRED')
      setState('ready')
    } catch (cause) {
      setSharedLoading(false)
      setState(state === 'ready' || skills.length > 0 || sharedSkills.length > 0 ? 'ready' : 'error')
      setRefreshError(cause?.statusCode >= 500 ? t('serviceUnavailable') : t('refreshFailed'))
    }
  }
  // 一次桌面登录,全部企业服务无感:Hub 目录 401/未绑定时直接触发桌面端
  // SSO(产品层 /api/desktop/auth/feishu 路由),绑定成功后自动刷新目录,
  // 不需要用户去 Hub 网页单独登录。
  const postDesktopAuth = async path => {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(30_000),
    })
    return response.json().catch(() => null)
  }
  const signInToHub = async () => {
    if (hubSigningIn) return
    setHubSigningIn(true)
    try {
      await postDesktopAuth('/api/desktop/auth/feishu/session')
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 3000))
        const status = await postDesktopAuth('/api/desktop/auth/feishu/status')
        if (status?.status === 'bound') { await refresh(); return }
        if (status?.status === 'idle' || status?.status === 'cancelled' || status?.status === 'error') break
      }
    } catch { /* 保持错误态,登录按钮保持可重试 */ }
    finally { setHubSigningIn(false) }
  }
  useEffect(() => { if (isActive) void refresh() }, [isActive])
  if (view === 'summary') return t('description')

  const install = async event => {
    event.preventDefault()
    if (operation.current || !repository.trim()) return
    operation.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const body = await requestLong('/install', { method: 'POST', body: JSON.stringify({ repository: repository.trim() }) })
      setRepository('')
      setFormOpen(false)
      restoreTriggerFocus()
      await refresh()
      setNotice(t('installSuccess', { name: body.skill?.name || '' }))
    } catch (cause) { setError(cause?.message || t('installError')) }
    finally { operation.current = false; setBusy(false) }
  }

  const openInstall = event => {
    lastTrigger = event?.currentTarget ?? document.activeElement
    setAddMenuOpen(false)
    setFormOpen(true)
    setError('')
  }

  const openCreate = async () => {
    if (operation.current) return
    operation.current = 'create'
    setAddMenuOpen(false)
    setFormOpen(false)
    setError('')
    setBusy(true)
    try { await createSkill() } catch { setError(t('createFailed')) } finally { operation.current = false; setBusy(false) }
  }

  const publish = async name => {
    if (operation.current) return
    operation.current = true
    setBusy(true); setError(''); setNotice('')
    try {
      await requestLong('/publish', { method: 'POST', body: JSON.stringify({ name }) })
      await refresh()
      setNotice(t('publishSuccess'))
    } catch (cause) { setError(cause?.message || t('publishError')) }
    finally { operation.current = false; setBusy(false) }
  }

  const installShared = async name => {
    if (operation.current) return
    operation.current = true
    setBusy(true); setError(''); setNotice('')
    try {
      await requestLong(`/shared/${encodeURIComponent(name)}`, { method: 'POST', body: '{}' })
      await refresh()
      setNotice(t('installSuccess', { name }))
    } catch (cause) { setError(cause?.message || t('installError')) }
    finally { operation.current = false; setBusy(false) }
  }

  const withdraw = async name => {
    if (operation.current) return
    operation.current = true
    setBusy(true); setError(''); setNotice('')
    try {
      await requestLong(`/shared/${encodeURIComponent(name)}`, { method: 'DELETE' })
      await refresh()
      setNotice(t('withdrawSuccess'))
    } catch (cause) { setError(cause?.message || t('publishError')) }
    finally { operation.current = false; setBusy(false) }
  }

  const matchesQuery = skill => !query.trim() || `${skill.name} ${skill.displayName || ''} ${skill.description || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  const visibleShared = sharedSkills.filter(matchesQuery)
  const visibleHubSkills = hubSkills.filter(matchesQuery)
  const visibleHubPlugins = hubPlugins.filter(matchesQuery)
  const visibleSkills = skills.filter(skill => {
    const isBundled = skill.source === 'bundled'
    const matchesSource = sourceFilter === 'all' || (sourceFilter === 'bundled' ? isBundled : !isBundled)
    return matchesSource && matchesQuery(skill)
  })
  const bundledCount = skills.filter(skill => skill.source === 'bundled').length

  return h('section', { className: 'sm-page', 'aria-labelledby': 'sm-title' },
    h('div', { className: 'sm-content' },
    h('header', { className: 'sm-header' },
      h('div', { className: 'sm-heading-copy' }, h('h2', { id: 'sm-title' }, t('title')), h('p', null, t('description'))),
      h('div', { className: 'sm-actions' },
        h('button', { type: 'button', className: 'sm-icon', 'aria-label': t('refresh'), title: t('refresh'), disabled: busy || state === 'loading' || state === 'refreshing', onClick: () => void refresh() }, h(IconRefreshOutlineRegular, { size: 18 })),
        h(Menu, { open: addMenuOpen, onClose: () => setAddMenuOpen(false), align: 'end', portal: true, autoFocus: true, selection: 'fill', listClassName: 'sm-add-menu',
          anchor: h('span', { className: 'sm-add-group', role: 'group', 'aria-label': t('chooseAddMethod') },
            h('button', { type: 'button', className: 'sm-primary sm-add-primary', disabled: busy, onClick: openInstall }, h(IconPlusOutlineRegular, { size: 16 }), t('add')),
            h('button', { type: 'button', className: 'sm-primary sm-add-more', disabled: busy, 'aria-label': t('chooseAddMethod'), 'aria-haspopup': 'menu', 'aria-expanded': addMenuOpen, onClick: () => setAddMenuOpen(value => !value) }, h(IconChevronDownOutlineRegular, { size: 14 }))) },
          h(MenuItemButton, { icon: h(IconDownloadOutlineRegular, { size: 18 }), onSelect: openInstall },
            h('span', { className: 'sm-menu-copy' }, h('strong', null, t('install')), h('small', null, t('installMenuHint')))),
          h(MenuItemButton, { icon: h(IconAgentPresetOutlineRegular, { size: 18 }), onSelect: openCreate },
            h('span', { className: 'sm-menu-copy' }, h('strong', null, t('create')), h('small', null, t('createHint'))))))),
    notice ? h('p', { className: 'sm-notice', role: 'status' }, notice) : null,
    refreshError && state === 'ready' ? h('div', { className: 'sm-inline-error', role: 'alert' }, refreshError, h('button', { type: 'button', className: 'sm-quiet', onClick: () => void refresh() }, t('retry'))) : null,
    busy && operation.current === 'create' ? h('p', { className: 'sm-refreshing', role: 'status' }, t('creating')) : null,
    h('div', { className: 'sm-toolbar' },
      h('div', { className: 'sm-filters', role: 'group', 'aria-label': t('filterBySource') },
        [['all', t('all'), skills.length + sharedSkills.length + hubSkills.length + hubPlugins.length], ['bundled', t('bundled'), bundledCount], ['local', t('local'), skills.length - bundledCount], ['shared', t('shared'), sharedSkills.length], ['hub', t('hub'), hubSkills.length + hubPlugins.length]].map(([id, label, count]) => h('button', {
          type: 'button', key: id, className: `sm-filter${sourceFilter === id ? ' is-active' : ''}`, 'aria-pressed': sourceFilter === id,
          onClick: () => setSourceFilter(id),
        }, label, h('span', { className: 'sm-filter-count' }, String(count))))),
      h('input', { type: 'search', className: 'sm-search', value: query, placeholder: t('search'), 'aria-label': t('search'), onInput: event => setQuery(event.currentTarget.value) })),
    state === 'refreshing' ? h('p', { className: 'sm-refreshing', role: 'status' }, t('refreshing')) : null,
    sourceFilter !== 'shared' && sourceFilter !== 'hub' ? h('section', { className: 'sm-installed', 'aria-labelledby': 'sm-installed-title' },
      h('div', { className: 'sm-section-heading' }, h('h3', { id: 'sm-installed-title' }, t('installedTitle')), h('span', null, String(visibleSkills.length))),
      h('div', { className: 'sm-list', 'aria-busy': state === 'loading' || state === 'refreshing' },
      state === 'loading' ? h('p', { className: 'sm-state', role: 'status' }, t('loading'))
        : state === 'error' ? h('div', { className: 'sm-state sm-error', role: 'alert' }, refreshError || t('refreshFailed'), h('button', { type: 'button', className: 'sm-quiet', onClick: () => void refresh() }, t('retry')))
          : skills.length === 0 ? h('div', { className: 'sm-state' }, h('p', null, t('empty')), h('button', { type: 'button', className: 'sm-primary', disabled: busy, onClick: openCreate }, t('create')))
            : visibleSkills.length === 0 ? h('p', { className: 'sm-state' }, t('noMatches'))
            : visibleSkills.map(skill => h('article', { className: 'sm-row', key: `${skill.provider}:${skill.name}` },
              h('div', { className: 'sm-glyph', 'aria-hidden': true }, h(IconSkillOutlineRegular, { size: 24 })),
              h('div', { className: 'sm-copy' }, h('strong', null, skill.name), h('p', { title: skill.description }, skill.description)),
              h('div', { className: 'sm-row-meta' },
                h('span', { className: `sm-source${skill.source === 'bundled' ? ' is-bundled' : ''}` }, skill.source === 'bundled' ? t('bundled') : t('local')),
                skill.source !== 'bundled' ? h('button', { type: 'button', className: 'sm-row-action', disabled: busy, onClick: () => void publish(skill.name) }, t('publish')) : null)))),
      ) : null,
    sourceFilter === 'all' || sourceFilter === 'shared' ? h('section', { className: 'sm-shared', 'aria-labelledby': 'sm-shared-title' },
      h('div', { className: 'sm-section-heading' }, h('h3', { id: 'sm-shared-title' }, t('shared')), h('span', null, String(visibleShared.length))),
      sharedLoading ? h('p', { className: 'sm-state', role: 'status' }, t('sharedLoading'))
        : sharedError ? h('div', { className: 'sm-inline-error', role: 'status' }, t('sharedUnavailable'), h('button', { type: 'button', className: 'sm-quiet', disabled: state === 'loading' || state === 'refreshing', onClick: () => void refresh() }, t('retry')))
          : sharedSkills.length === 0 ? h('p', { className: 'sm-state' }, t('sharedEmpty'))
          : visibleShared.length === 0 ? h('p', { className: 'sm-state' }, t('noMatches'))
          : h('div', { className: 'sm-list' }, visibleShared.map(skill => {
            const localSkill = skills.find(local => local.name === skill.name)
            const isInstalled = Boolean(localSkill)
            const canUpdate = Boolean(localSkill?.shared && localSkill.shared.sha256 !== skill.sha256)
            return h('article', { className: 'sm-row', key: `shared:${skill.name}` },
              h('div', { className: 'sm-glyph sm-shared-glyph', 'aria-hidden': true }, h(IconSkillOutlineRegular, { size: 24 })),
              h('div', { className: 'sm-copy' }, h('strong', null, skill.name), h('p', { title: skill.description }, skill.description)),
              h('div', { className: 'sm-row-meta' },
                h('span', { className: 'sm-version' }, `v${skill.version}`),
                skill.canManage ? h('button', { type: 'button', className: 'sm-row-action is-danger', disabled: busy, onClick: () => void withdraw(skill.name) }, t('withdraw')) : null,
                h('button', { type: 'button', className: 'sm-row-action', disabled: busy || (isInstalled && !canUpdate), onClick: () => void installShared(skill.name) }, canUpdate ? t('sharedUpdate') : isInstalled ? t('sharedInstalled') : t('sharedInstall')))
            )
          }))) : null,
    sourceFilter === 'all' || sourceFilter === 'hub' ? h('section', { className: 'sm-hub', 'aria-labelledby': 'sm-hub-title' },
      h('div', { className: 'sm-section-heading' }, h('h3', { id: 'sm-hub-title' }, t('hub')), h('span', null, String(visibleHubSkills.length + visibleHubPlugins.length))),
      h('p', { className: 'sm-hub-hint' }, t('hubHint')),
      hubError ? h('div', { className: 'sm-inline-error', role: 'status' }, t('hubUnavailable'),
        hubSsoRequired
          ? h('button', { type: 'button', className: 'sm-quiet', disabled: hubSigningIn, onClick: signInToHub }, hubSigningIn ? t('hubSigningIn') : t('hubSignIn'))
          : h('button', { type: 'button', className: 'sm-quiet', disabled: state === 'loading' || state === 'refreshing', onClick: () => void refresh() }, t('retry')))
        : (hubSkills.length === 0 && hubPlugins.length === 0) ? h('p', { className: 'sm-state' }, t('hubEmpty'))
        : h('div', { className: 'sm-list' },
            visibleHubSkills.length > 0 ? h('h4', { className: 'sm-hub-group' }, t('hubSkillsTitle')) : null,
            visibleHubSkills.map(item => hubRow(item, t)),
            visibleHubPlugins.length > 0 ? h('h4', { className: 'sm-hub-group' }, t('hubPluginsTitle')) : null,
            visibleHubPlugins.map(item => hubRow(item, t)))) : null,
    error && !formOpen ? h('div', { className: 'sm-error', role: 'alert' }, error) : null),
    formOpen ? h('div', { className: 'sm-overlay', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'sm-install-title',
      onClick: event => { if (event.target === event.currentTarget) closeInstall() } },
      h('div', { className: 'sm-install-dialog', role: 'document' },
        h('header', { className: 'sm-install-head' },
          h('h3', { id: 'sm-install-title' }, t('install')),
          h('button', { type: 'button', className: 'sm-icon', 'aria-label': t('close'), disabled: busy, onClick: closeInstall }, h(IconCloseOutlineRegular, { size: 18 }))),
        h('p', { className: 'sm-install-hint' }, t('installHint')),
        h('form', { className: 'sm-install-form', onSubmit: install, 'aria-busy': busy },
          h('label', null, t('repository'), h('input', { type: 'url', required: true, value: repository, disabled: busy, placeholder: 'https://github.com/owner/skills', ref: repositoryInput, onInput: event => setRepository(event.currentTarget.value) })),
          error ? h('div', { className: 'sm-error', role: 'alert' }, error) : null,
          h('div', { className: 'sm-form-actions' },
            h('button', { type: 'button', className: 'sm-quiet', disabled: busy, onClick: closeInstall }, t('cancel')),
            h('button', { type: 'submit', className: 'sm-primary', disabled: busy || !repository.trim() }, busy ? t('installing') : t('installAction')))))) : null)
}

async function createSkillConversation(ctx) {
  const sessions = ctx.get?.('sessions')
  const navigation = ctx.get?.('uiWorkspace')
  if (!sessions || !navigation) throw new Error('conversation_unavailable')
  const workspaceId = ctx.get?.('workspaces')?.list.getSnapshot().items[0]?.workspaceId
  const id = await sessions.create({ ...(workspaceId === undefined ? {} : { workspaceId }), agentPreset: 'cordis' })
  navigation.openSession(id)
  const reference = sessions.retain(id, { source: 'controllerOperation' })
  try {
    const binding = await reference.ready
    const result = await binding.session.prompt([{ type: 'text', text: '/skill-creator\n\n请先询问我需要创建的技能目标、使用场景、输入和期望结果，然后引导我完成技能创建。' }], 'queue')
    if (!result.ok) throw new Error(result.error.message)
    return id
  } finally {
    reference.release()
  }
}

function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh: COPY.zh, en: COPY.en }), 'sensteed-skill-manager: dictionaries')
  const t = ctx.locale.bind(NS)
  const createSkill = () => createSkillConversation(ctx)
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ t, createSkill, panelInfo: ctx.layout.panelInfo }),
  }, SkillManagerPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: PANEL_ID, order: 1, label: () => t('title'), locale: NS,
  }, ({ size }) => h(IconDataOutlineRegular, { size })))
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@dofe/dsh-sensteed-skill-manager'
    style.textContent = `
      .sm-page{box-sizing:border-box;flex:1;width:100%;height:100%;min-height:0;min-width:0;overflow:auto;padding:calc(32px + var(--dsh-frame-top-clearance,0px)) 48px 48px;container:skill-manager / inline-size;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
      .sm-content{box-sizing:border-box;width:100%;max-width:1040px;min-width:0;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr);gap:28px}
      .sm-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;min-height:72px}.sm-heading-copy{flex:1 1 240px;min-width:0}
      .sm-header h2{margin:0;font-size:22px;font-weight:650;line-height:1.4}.sm-header p{margin:6px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5}
      .sm-actions,.sm-form-actions{display:flex;align-items:center;gap:10px;flex:none}
      .sm-page button,.sm-install-dialog button{font:inherit;cursor:pointer}.sm-page button:disabled,.sm-install-dialog button:disabled{opacity:.5;cursor:default}
      .sm-icon{display:grid;place-items:center;flex:none;width:36px;height:36px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary)}
      .sm-icon:hover:not(:disabled),.sm-quiet:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
      .sm-page .sm-primary,.sm-install-dialog .sm-primary,.sm-quiet{display:inline-flex;justify-content:center;align-items:center;gap:6px;min-height:36px;padding:0 13px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;white-space:nowrap;font-size:13px}
      .sm-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}.sm-quiet{background:transparent;color:var(--dsw-alias-label-primary)}
      .sm-add-group{display:flex;flex:none}.sm-page .sm-add-primary{border-radius:8px 0 0 8px}.sm-page .sm-add-more{width:32px;padding:0;border-radius:0 8px 8px 0;border-left-color:var(--dsw-alias-label-secondary)}
      .sm-add-menu{width:min(360px,calc(100vw - 32px));max-width:calc(100vw - 32px)}.sm-menu-copy{display:block;white-space:normal;text-align:left;padding:4px 0}.sm-menu-copy strong{display:block;font-size:13px;font-weight:550}.sm-menu-copy small{display:block;margin-top:4px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
      .sm-toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}.sm-filters{display:flex;flex-wrap:wrap;gap:4px;min-width:0}
      .sm-page .sm-filter{display:flex;align-items:center;gap:6px;min-height:36px;padding:0 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;white-space:nowrap}
      .sm-filter-count{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}.sm-page .sm-filter.is-active,.sm-filter:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
      .sm-search,.sm-install-form input{box-sizing:border-box;min-width:0;width:min(100%,300px);height:36px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
      .sm-page :is(button,input):focus-visible,.sm-install-dialog :is(button,input):focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
      .sm-installed,.sm-shared,.sm-list{display:grid;min-width:0;gap:0}.sm-section-heading{display:flex;align-items:center;gap:8px;padding-bottom:12px}.sm-section-heading h3{margin:0;font-size:14px;font-weight:600;white-space:nowrap}.sm-section-heading>span,.sm-version{color:var(--dsw-alias-label-secondary);font-size:12px}
      .sm-row{display:grid;grid-template-columns:48px minmax(0,1fr) auto;align-items:center;gap:16px;min-width:0;padding:16px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);border-radius:8px}.sm-row:hover{background:var(--dsw-alias-bg-layer-2)}
      .sm-glyph{display:grid;place-items:center;width:48px;height:48px;align-self:start;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1)}
      .sm-copy{min-width:0}.sm-copy strong{display:block;font-size:14px;font-weight:550;line-height:1.5;overflow-wrap:anywhere}.sm-copy p{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;margin:5px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.55;overflow-wrap:anywhere}
      .sm-row-meta{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:10px;max-width:260px}.sm-source{padding:3px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}.sm-source.is-bundled{color:var(--dsw-alias-label-primary)}
      .sm-page .sm-row-action{min-height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;white-space:nowrap}.sm-row-action:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}.sm-page .is-danger{color:var(--dsw-alias-state-error-primary)}
      .sm-state{display:grid;justify-items:center;gap:16px;margin:0;padding:40px 16px;color:var(--dsw-alias-label-secondary);font-size:13px;text-align:center}.sm-state p{margin:0}
      .sm-hub-hint{margin:0 0 12px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}.sm-hub-group{margin:10px 0 0;padding:8px 8px 0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
      .sm-error,.sm-inline-error{color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:1.6;overflow-wrap:anywhere}.sm-error button,.sm-inline-error button{margin-left:8px}.sm-notice,.sm-refreshing{margin:0;font-size:13px;color:var(--dsw-alias-state-success-primary)}.sm-refreshing{color:var(--dsw-alias-label-secondary)}
      .sm-overlay{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:24px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 55%,transparent);backdrop-filter:blur(6px)}
      .sm-install-dialog{box-sizing:border-box;width:min(520px,100%);max-height:100%;overflow:auto;padding:20px 22px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 18px 48px rgba(0,0,0,.28)}
      .sm-install-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 4px}.sm-install-head h3{margin:0;font-size:16px;font-weight:650;color:var(--dsw-alias-label-primary)}
      .sm-install-hint{margin:0 0 14px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
      .sm-install-form{display:grid;gap:20px}.sm-install-form label{display:grid;gap:8px;font-size:13px;font-weight:550}.sm-install-form input{width:100%;font-weight:400}.sm-form-actions{justify-content:flex-end;flex-wrap:wrap}
      @container skill-manager (max-width:680px){.sm-toolbar{align-items:stretch}.sm-search{width:100%}.sm-row{grid-template-columns:40px minmax(0,1fr);gap:8px 12px}.sm-row-meta{grid-column:2;justify-content:flex-start;max-width:none}.sm-glyph{width:40px;height:40px;grid-row:1 / span 2}.sm-heading-copy{flex-basis:100%}.sm-actions{margin-left:auto}}
      @media(max-width:760px){.sm-page{padding-inline:24px}}@media(max-width:420px){.sm-page{padding-inline:16px}.sm-content{gap:24px}.sm-page .sm-filter{padding-inline:8px}}
    `
    document.head.appendChild(style)
    return () => style.remove()
  }, 'sensteed-skill-manager: styles')
}

module.exports = { apply, inject: ['slots', 'locale', 'sessions', 'uiWorkspace', 'workspaces', 'layout'], __test: { request, createSkillConversation } }
