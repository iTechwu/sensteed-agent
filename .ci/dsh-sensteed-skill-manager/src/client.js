const React = require('react')
const { createElement: h, useEffect, useState } = React
const NS = 'sensteed.skill-manager'
const ROUTE = '/api/desktop/sensteed/skills'
const COPY = {
  zh: {
    title: '技能管理', description: '查看和添加 Agent 技能', refresh: '刷新', add: '添加 Skill',
    create: '让 Agent 创建', install: '安装第三方 Skill', empty: '还没有可用的技能',
    loading: '正在读取技能…', refreshing: '正在刷新技能…', refreshFailed: '技能列表刷新失败。', retry: '重试', repository: 'GitHub 仓库或技能目录链接',
    installAction: '安装', cancel: '取消', installing: '正在安装…', installed: '已安装',
    installHint: '可粘贴单技能仓库，或合集仓库中某个技能的 /tree/ 分支目录链接。来源可信后再安装。Skill 会在本机加载。',
    installError: '安装失败，请检查仓库地址和技能结构。', installSuccess: '已安装 {name}', bundled: '内置', local: '本机',
    search: '搜索技能名称或说明', all: '全部', filterBySource: '按来源筛选', noMatches: '没有匹配的技能',
    createHint: '描述技能要完成的任务，Agent 会使用内置 skill-creator 创建。', createPlaceholder: '例如：读取销售周报，提取关键指标并生成管理层摘要',
    creating: '正在打开 Agent…', createFailed: '无法打开 Agent 会话，请重试。',
    prompt: '请根据以下需求创建一个新的 Agent skill：',
  },
  en: {
    title: 'Skill management', description: 'Browse and add Agent skills', refresh: 'Refresh', add: 'Add skill',
    create: 'Create with Agent', install: 'Install third-party skill', empty: 'No skills available yet',
    loading: 'Loading skills…', refreshing: 'Refreshing skills…', refreshFailed: 'Could not refresh the skill list.', retry: 'Retry', repository: 'GitHub repository or skill directory URL',
    installAction: 'Install', cancel: 'Cancel', installing: 'Installing…', installed: 'Installed',
    installHint: 'Paste a single-skill repository or a /tree/ link to one skill in a collection. Install trusted sources only.',
    installError: 'Installation failed. Check the repository URL and skill structure.', installSuccess: 'Installed {name}', bundled: 'Built in', local: 'Local',
    search: 'Search skill names and descriptions', all: 'All', filterBySource: 'Filter by source', noMatches: 'No matching skills',
    createHint: 'Describe the task for the skill. Agent will use the built-in skill-creator.', createPlaceholder: 'For example: read weekly sales reports and summarize key metrics for leadership',
    creating: 'Opening Agent…', createFailed: 'Could not open an Agent conversation. Try again.',
    prompt: 'Create a new Agent skill for this request:',
  },
}

async function request(path = '', options = {}) {
  const response = await fetch(`${ROUTE}${path}`, {
    ...options,
    credentials: 'same-origin',
    redirect: 'error',
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    signal: AbortSignal.timeout(120000),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
  return body
}

function SkillManagerPage({ view, t, createSkill }) {
  const [skills, setSkills] = useState([])
  const [state, setState] = useState('loading')
  const [formOpen, setFormOpen] = useState(false)
  const [repository, setRepository] = useState('')
  const [createRequest, setCreateRequest] = useState('')
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = async () => {
    setState(skills.length > 0 ? 'refreshing' : 'loading')
    setError('')
    setRefreshError('')
    setNotice('')
    try {
      const body = await request()
      setSkills(body.skills || [])
      setState('ready')
    } catch { setState(skills.length > 0 ? 'ready' : 'error'); setRefreshError(t('refreshFailed')) }
  }
  useEffect(() => { void refresh() }, [])
  if (view === 'summary') return t('description')

  const install = async event => {
    event.preventDefault()
    if (busy || !repository.trim()) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const body = await request('/install', { method: 'POST', body: JSON.stringify({ repository: repository.trim() }) })
      setRepository('')
      setFormOpen(false)
      await refresh()
      setNotice(t('installSuccess', { name: body.skill?.name || '' }))
    } catch (cause) { setError(cause?.message || t('installError')) }
    finally { setBusy(false) }
  }

  const visibleSkills = skills.filter(skill => {
    const isBundled = skill.source === 'bundled'
    const matchesSource = sourceFilter === 'all' || (sourceFilter === 'bundled' ? isBundled : !isBundled)
    const needle = query.trim().toLocaleLowerCase()
    return matchesSource && (!needle || `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(needle))
  })
  const bundledCount = skills.filter(skill => skill.source === 'bundled').length

  return h('section', { className: 'sm-page', 'aria-labelledby': 'sm-title' },
    h('header', { className: 'sm-header' },
      h('div', null, h('h2', { id: 'sm-title' }, t('title')), h('p', null, t('description'))),
      h('div', { className: 'sm-actions' },
        h('button', { type: 'button', className: 'sm-icon', 'aria-label': t('refresh'), title: t('refresh'), disabled: busy || state === 'loading' || state === 'refreshing', onClick: () => void refresh() }, '↻'),
        h('button', { type: 'button', className: 'sm-primary', onClick: () => { setFormOpen(value => !value); setError('') } }, t('add')))),
    notice ? h('p', { className: 'sm-notice', role: 'status' }, notice) : null,
    refreshError && state === 'ready' ? h('div', { className: 'sm-inline-error', role: 'alert' }, refreshError, h('button', { type: 'button', className: 'sm-quiet', onClick: () => void refresh() }, t('retry'))) : null,
    formOpen ? h('form', { className: 'sm-install-form', onSubmit: install },
      h('label', null, t('repository'), h('input', { type: 'url', required: true, value: repository, placeholder: 'https://github.com/owner/skills/tree/main/my-skill', onInput: event => setRepository(event.currentTarget.value), autoFocus: true })),
      h('p', null, t('installHint')),
      error ? h('div', { className: 'sm-error', role: 'alert' }, error) : null,
      h('div', { className: 'sm-form-actions' },
        h('button', { type: 'button', className: 'sm-quiet', disabled: busy, onClick: () => setFormOpen(false) }, t('cancel')),
        h('button', { type: 'submit', className: 'sm-primary', disabled: busy || !repository.trim() }, busy ? t('installing') : t('install')))) : null,
    skills.length > 0 ? h('div', { className: 'sm-toolbar' },
      h('input', { type: 'search', className: 'sm-search', value: query, placeholder: t('search'), 'aria-label': t('search'), onInput: event => setQuery(event.currentTarget.value) }),
      h('div', { className: 'sm-filters', role: 'group', 'aria-label': t('filterBySource') },
        [['all', t('all'), skills.length], ['bundled', t('bundled'), bundledCount], ['local', t('local'), skills.length - bundledCount]].map(([id, label, count]) => h('button', {
          type: 'button', key: id, className: `sm-filter${sourceFilter === id ? ' is-active' : ''}`, 'aria-pressed': sourceFilter === id,
          onClick: () => setSourceFilter(id),
        }, `${label} ${count}`)))
    ) : null,
    state === 'refreshing' ? h('p', { className: 'sm-refreshing', role: 'status' }, t('refreshing')) : null,
    h('div', { className: 'sm-list', 'aria-busy': state === 'loading' || state === 'refreshing' },
      state === 'loading' ? h('p', { className: 'sm-state', role: 'status' }, t('loading'))
        : state === 'error' ? h('div', { className: 'sm-state sm-error', role: 'alert' }, error || t('refreshFailed'), h('button', { type: 'button', className: 'sm-quiet', onClick: () => void refresh() }, t('retry')))
          : skills.length === 0 ? h('p', { className: 'sm-state' }, t('empty'))
            : visibleSkills.length === 0 ? h('p', { className: 'sm-state' }, t('noMatches'))
            : visibleSkills.map(skill => h('article', { className: 'sm-row', key: `${skill.provider}:${skill.name}` },
              h('div', { className: 'sm-glyph', 'aria-hidden': true }, '✳'),
              h('div', { className: 'sm-copy' }, h('strong', null, skill.name), h('p', null, skill.description)),
              h('span', { className: `sm-source${skill.source === 'bundled' ? ' is-bundled' : ''}` }, skill.source === 'bundled' ? t('bundled') : t('local'))))),
    h('section', { className: 'sm-create' },
      h('div', { className: 'sm-create-copy' }, h('strong', null, t('create')), h('p', null, t('createHint')),
        h('textarea', { className: 'sm-create-input', rows: 2, value: createRequest, placeholder: t('createPlaceholder'), onInput: event => setCreateRequest(event.currentTarget.value), 'aria-label': t('createPlaceholder') })),
        h('button', { type: 'button', className: 'sm-secondary', disabled: busy || !createRequest.trim(), onClick: async () => {
        setBusy(true); setError(''); setNotice('')
        try { await createSkill(`${t('prompt')}\n${createRequest.trim()}`); setCreateRequest('') } catch { setError(t('createFailed')) } finally { setBusy(false) }
      } }, busy ? t('creating') : t('create')),
      error && !formOpen ? h('div', { className: 'sm-error', role: 'alert' }, error) : null))
}

function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh: COPY.zh, en: COPY.en }), 'sensteed-skill-manager: dictionaries')
  const t = ctx.locale.bind(NS)
  const createSkill = async prompt => {
    const sessions = ctx.get?.('sessions')
    const navigation = ctx.get?.('uiWorkspace')
    if (!sessions || !navigation) throw new Error('conversation_unavailable')
    const id = await sessions.create()
    navigation.openSession(id)
    const scoped = sessions.scope(id)
    if (scoped) {
      const conversation = scoped.get('conversation')
      if (!conversation) throw new Error('conversation_service_unavailable')
      await conversation.send(`/skill-creator\n${prompt}`)
      return
    }
    await sessions.using(id, { source: 'controllerOperation' }, async reference => {
      await reference.ready
      const conversation = sessions.scope(id)?.get('conversation')
      if (!conversation) throw new Error('conversation_service_unavailable')
      await conversation.send(`/skill-creator\n${prompt}`)
    })
  }
  ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item', id: 'sensteed-skill-manager', order: 30,
    label: () => t('title'), locale: NS, inject: () => ({ t, createSkill }),
  }, SkillManagerPage))
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@dofe/dsh-sensteed-skill-manager'
    style.textContent = `
      .sm-page{display:grid;gap:20px;color:var(--dsw-alias-label-primary);min-width:0}
      .sm-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:8px 0 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}
      .sm-header h2{margin:0;font-size:20px;font-weight:650;line-height:1.3}.sm-header p,.sm-create p{margin:5px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5}
      .sm-actions,.sm-form-actions{display:flex;align-items:center;gap:8px}.sm-icon{width:36px;height:36px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:21px;cursor:pointer}.sm-icon:hover,.sm-quiet:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
      .sm-primary,.sm-secondary,.sm-quiet{min-height:36px;padding:0 13px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;font:inherit;font-size:13px;cursor:pointer}.sm-primary{border-color:var(--dsw-alias-button-primary-fill);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}.sm-secondary{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.sm-quiet{background:transparent;color:var(--dsw-alias-label-secondary)}.sm-primary:disabled,.sm-secondary:disabled,.sm-quiet:disabled{cursor:wait;opacity:.55}
      .sm-list{display:grid;min-width:0}.sm-row{display:flex;align-items:center;gap:14px;min-height:74px;padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}.sm-row:hover{background:var(--dsw-alias-bg-layer-2)}.sm-glyph{display:grid;place-items:center;flex:0 0 48px;width:48px;height:48px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;color:var(--dsw-alias-brand-primary);font-size:22px}.sm-copy{flex:1;min-width:0}.sm-copy strong{font-size:14px;font-weight:600}.sm-copy p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.45;overflow-wrap:anywhere}.sm-source{flex:0 0 auto;color:var(--dsw-alias-label-secondary);font-size:12px}.sm-source.is-bundled{color:var(--dsw-alias-state-success-primary)}
      .sm-state{padding:28px 12px;color:var(--dsw-alias-label-secondary);font-size:13px}.sm-error,.sm-inline-error{color:var(--dsw-alias-state-error-primary)}.sm-error button,.sm-inline-error button{margin-left:8px}.sm-inline-error{font-size:13px}.sm-notice,.sm-refreshing{margin:0;color:var(--dsw-alias-state-success-primary);font-size:13px}.sm-refreshing{color:var(--dsw-alias-label-secondary)}
      .sm-toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}.sm-search{box-sizing:border-box;width:min(100%,360px);height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}.sm-search:focus-visible,.sm-create-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.sm-filters{display:flex;gap:4px}.sm-filter{min-height:32px;padding:0 9px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}.sm-filter:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.sm-filter.is-active{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
      .sm-install-form{display:grid;gap:10px;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}.sm-install-form label{display:grid;gap:7px;font-size:13px;font-weight:550}.sm-install-form input{box-sizing:border-box;width:100%;height:38px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit}.sm-install-form input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.sm-install-form p{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px}.sm-form-actions{justify-content:flex-end}
      .sm-create{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:16px;padding:16px 0;border-top:1px solid var(--dsw-alias-border-l1)}.sm-create-copy{min-width:0}.sm-create strong{font-size:14px}.sm-create p{max-width:620px}.sm-create-input{box-sizing:border-box;width:100%;min-height:58px;margin-top:12px;padding:9px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.45;resize:vertical}.sm-create>.sm-secondary{align-self:end}
      @media(max-width:620px){.sm-header{align-items:flex-start}.sm-row{gap:10px;padding-inline:4px}.sm-glyph{flex-basis:40px;width:40px;height:40px}.sm-source{font-size:11px}.sm-toolbar{align-items:stretch}.sm-search{width:100%}.sm-create{grid-template-columns:minmax(0,1fr)}.sm-create>.sm-secondary{justify-self:start}}
    `
    document.head.appendChild(style)
    return () => style.remove()
  }, 'sensteed-skill-manager: styles')
}

module.exports = { apply, inject: ['slots', 'locale', 'sessions', 'uiWorkspace'], __test: { request } }
