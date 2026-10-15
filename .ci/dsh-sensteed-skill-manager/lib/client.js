window.__ModuleLoader__.load({
  id: "@dofe/dsh-sensteed-skill-manager",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require('react')
    const { createElement: h, useEffect, useState } = React
    const { IconDataOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')
    const PANEL_ID = 'sensteed-skill-manager'
    const NS = 'sensteed.skill-manager'
    const ROUTE = '/api/desktop/sensteed/skills'
    const COPY = {
      zh: {
        title: '技能管理', description: '安装、创建和管理 Agent 技能', refresh: '刷新', add: '添加技能', chooseAddMethod: '选择添加技能方式',
        create: '让 Agent 创建', install: '安装第三方技能', empty: '还没有可用的技能', installedTitle: '已安装技能',
        loading: '正在读取技能…', refreshing: '正在刷新技能…', refreshFailed: '技能列表刷新失败。', serviceUnavailable: '技能服务暂时不可用，请稍后重试。', retry: '重试', repository: 'GitHub 仓库或技能目录链接',
        installAction: '安装', cancel: '取消', installing: '正在安装…', installed: '已安装',
        publish: '上传到公司', publishing: '正在上传…', publishSuccess: '已发布到公司技能库', publishError: '发布失败，请稍后重试。',
        shared: '公司共享', sharedEmpty: '公司技能库还没有技能', sharedUnavailable: '暂时无法读取公司技能库', sharedInstall: '安装', sharedUpdate: '更新', sharedInstalled: '已安装', sharedLoading: '正在读取公司技能库…',
        withdraw: '撤回', withdrawing: '正在撤回…', withdrawSuccess: '已从公司技能库撤回',
        installHint: '可粘贴单技能仓库，或合集仓库中某个技能的 /tree/ 分支目录链接。来源可信后再安装。Skill 会在本机加载。',
        installError: '安装失败，请检查仓库地址和技能结构。', installSuccess: '已安装 {name}', bundled: '内置', local: '本机',
        search: '搜索技能名称或说明', all: '全部', filterBySource: '按来源筛选', noMatches: '没有匹配的技能',
        createHint: '描述技能要完成的任务，Agent 会使用内置 skill-creator 创建。', createPlaceholder: '例如：读取销售周报，提取关键指标并生成管理层摘要',
        creating: '正在打开 Agent…', createFailed: '无法打开 Agent 会话，请重试。',
        prompt: '请根据以下需求创建一个新的 Agent skill：',
      },
      en: {
        title: 'Skill management', description: 'Install, create, and manage Agent skills', refresh: 'Refresh', add: 'Add skill', chooseAddMethod: 'Choose how to add a skill',
        create: 'Create with Agent', install: 'Install third-party skill', empty: 'No skills available yet', installedTitle: 'Installed skills',
        loading: 'Loading skills…', refreshing: 'Refreshing skills…', refreshFailed: 'Could not refresh the skill list.', serviceUnavailable: 'The skill service is temporarily unavailable. Try again later.', retry: 'Retry', repository: 'GitHub repository or skill directory URL',
        installAction: 'Install', cancel: 'Cancel', installing: 'Installing…', installed: 'Installed',
        publish: 'Share with company', publishing: 'Publishing…', publishSuccess: 'Published to company skills', publishError: 'Could not publish this skill. Try again.',
        shared: 'Company shared', sharedEmpty: 'No company skills yet', sharedUnavailable: 'Company skills are temporarily unavailable', sharedInstall: 'Install', sharedUpdate: 'Update', sharedInstalled: 'Installed', sharedLoading: 'Loading company skills…',
        withdraw: 'Withdraw', withdrawing: 'Withdrawing…', withdrawSuccess: 'Removed from company skills',
        installHint: 'Paste a single-skill repository or a /tree/ link to one skill in a collection. Install trusted sources only.',
        installError: 'Installation failed. Check the repository URL and skill structure.', installSuccess: 'Installed {name}', bundled: 'Built in', local: 'Local',
        search: 'Search skill names and descriptions', all: 'All', filterBySource: 'Filter by source', noMatches: 'No matching skills',
        createHint: 'Describe the task for the skill. Agent will use the built-in skill-creator.', createPlaceholder: 'For example: read weekly sales reports and summarize key metrics for leadership',
        creating: 'Opening Agent…', createFailed: 'Could not open an Agent conversation. Try again.',
        prompt: 'Create a new Agent skill for this request:',
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

    function SkillManagerPage({ view, t, createSkill }) {
      const [skills, setSkills] = useState([])
      const [sharedSkills, setSharedSkills] = useState([])
      const [sharedError, setSharedError] = useState('')
      const [sharedLoading, setSharedLoading] = useState(true)
      const [state, setState] = useState('loading')
      const [formOpen, setFormOpen] = useState(false)
      const [createOpen, setCreateOpen] = useState(false)
      const [addMenuOpen, setAddMenuOpen] = useState(false)
      const [repository, setRepository] = useState('')
      const [createRequest, setCreateRequest] = useState('')
      const [query, setQuery] = useState('')
      const [sourceFilter, setSourceFilter] = useState('all')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [refreshError, setRefreshError] = useState('')
      const [notice, setNotice] = useState('')
      let lastTrigger = null
      const closeInstall = () => {
        setFormOpen(false)
        requestAnimationFrame(() => lastTrigger?.focus?.())
      }
      const closeCreate = () => {
        setCreateOpen(false)
        requestAnimationFrame(() => lastTrigger?.focus?.())
      }

      const refresh = async () => {
        setState(skills.length > 0 ? 'refreshing' : 'loading')
        setError('')
        setRefreshError('')
        setNotice('')
        try {
          const body = await request()
          setSkills(body.skills || [])
          setSharedSkills(body.sharedSkills || [])
          setSharedError(body.sharedError || '')
          setSharedLoading(false)
          setState('ready')
        } catch (cause) {
          setSharedLoading(false)
          setState(skills.length > 0 ? 'ready' : 'error')
          setRefreshError(cause?.statusCode >= 500 ? t('serviceUnavailable') : t('refreshFailed'))
        }
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
          const body = await requestLong('/install', { method: 'POST', body: JSON.stringify({ repository: repository.trim() }) })
          setRepository('')
          closeInstall()
          await refresh()
          setNotice(t('installSuccess', { name: body.skill?.name || '' }))
        } catch (cause) { setError(cause?.message || t('installError')) }
        finally { setBusy(false) }
      }

      const openInstall = () => {
        setAddMenuOpen(false)
        setCreateOpen(false)
        setFormOpen(true)
        setError('')
      }

      const openCreate = () => {
        setAddMenuOpen(false)
        setFormOpen(false)
        setCreateOpen(true)
        setError('')
      }

      const publish = async name => {
        setBusy(true); setError(''); setNotice('')
        try {
          await requestLong('/publish', { method: 'POST', body: JSON.stringify({ name }) })
          await refresh()
          setNotice(t('publishSuccess'))
        } catch (cause) { setError(cause?.message || t('publishError')) }
        finally { setBusy(false) }
      }

      const installShared = async name => {
        setBusy(true); setError(''); setNotice('')
        try {
          await requestLong(`/shared/${encodeURIComponent(name)}`, { method: 'POST', body: '{}' })
          await refresh()
          setNotice(t('installSuccess', { name }))
        } catch (cause) { setError(cause?.message || t('installError')) }
        finally { setBusy(false) }
      }

      const withdraw = async name => {
        setBusy(true); setError(''); setNotice('')
        try {
          await requestLong(`/shared/${encodeURIComponent(name)}`, { method: 'DELETE' })
          await refresh()
          setNotice(t('withdrawSuccess'))
        } catch (cause) { setError(cause?.message || t('publishError')) }
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
          h('div', { className: 'sm-heading-copy' }, h('h2', { id: 'sm-title' }, t('title')), h('p', null, t('description'))),
          h('div', { className: 'sm-actions' },
            h('button', { type: 'button', className: 'sm-icon', 'aria-label': t('refresh'), title: t('refresh'), disabled: busy || state === 'loading' || state === 'refreshing', onClick: () => void refresh() }, '↻'),
            h('span', { className: 'sm-add-group', role: 'group', 'aria-label': t('chooseAddMethod') },
              h('button', { type: 'button', className: 'sm-primary sm-add-primary', ref: element => { lastTrigger = element }, disabled: busy, onClick: openInstall }, h('span', { 'aria-hidden': true }, '+'), t('add')),
              h('button', { type: 'button', className: 'sm-primary sm-add-more', disabled: busy, 'aria-label': t('chooseAddMethod'), 'aria-haspopup': 'menu', 'aria-expanded': addMenuOpen, onClick: () => setAddMenuOpen(value => !value) }, '⌄'),
              addMenuOpen ? h('div', { className: 'sm-add-menu', role: 'menu' },
                h('button', { type: 'button', role: 'menuitem', className: 'sm-add-menu-item', onClick: openInstall },
                  h('span', { className: 'sm-menu-icon', 'aria-hidden': true }, '⇩'),
                  h('span', null, h('strong', null, t('install')), h('small', null, t('installHint')))),
                h('button', { type: 'button', role: 'menuitem', className: 'sm-add-menu-item', onClick: openCreate },
                  h('span', { className: 'sm-menu-icon', 'aria-hidden': true }, '✦'),
                  h('span', null, h('strong', null, t('create')), h('small', null, t('createHint'))))) : null))),
        notice ? h('p', { className: 'sm-notice', role: 'status' }, notice) : null,
        refreshError && state === 'ready' ? h('div', { className: 'sm-inline-error', role: 'alert' }, refreshError, h('button', { type: 'button', className: 'sm-quiet', onClick: () => void refresh() }, t('retry'))) : null,
        formOpen ? h('form', { className: 'sm-install-form', role: 'dialog', 'aria-label': t('install'), onSubmit: install, onKeyDown: event => { if (event.key === 'Escape') { event.stopPropagation(); closeInstall() } } },
          h('div', { className: 'sm-form-heading' }, h('strong', null, t('install')), h('p', null, t('installHint'))),
          h('label', null, t('repository'), h('input', { type: 'url', required: true, value: repository, placeholder: 'https://github.com/owner/skills/tree/main/my-skill', onInput: event => setRepository(event.currentTarget.value), autoFocus: true })),
          error ? h('div', { className: 'sm-error', role: 'alert' }, error) : null,
          h('div', { className: 'sm-form-actions' },
            h('button', { type: 'button', className: 'sm-quiet', disabled: busy, onClick: closeInstall }, t('cancel')),
            h('button', { type: 'submit', className: 'sm-primary', disabled: busy || !repository.trim() }, busy ? t('installing') : t('install')))) : null,
        createOpen ? h('section', { className: 'sm-create-form', role: 'dialog', 'aria-label': t('create'), 'aria-labelledby': 'sm-create-title', onKeyDown: event => { if (event.key === 'Escape') { event.stopPropagation(); closeCreate() } } },
          h('div', { className: 'sm-form-heading' }, h('strong', { id: 'sm-create-title' }, t('create')), h('p', null, t('createHint'))),
          h('textarea', { className: 'sm-create-input', rows: 4, value: createRequest, placeholder: t('createPlaceholder'), onInput: event => setCreateRequest(event.currentTarget.value), 'aria-label': t('createPlaceholder'), autoFocus: true }),
          error ? h('div', { className: 'sm-error', role: 'alert' }, error) : null,
          h('div', { className: 'sm-form-actions' },
            h('button', { type: 'button', className: 'sm-quiet', disabled: busy, onClick: closeCreate }, t('cancel')),
            h('button', { type: 'button', className: 'sm-primary', disabled: busy || !createRequest.trim(), onClick: async () => {
              setBusy(true); setError(''); setNotice('')
              try { await createSkill(`${t('prompt')}\n${createRequest.trim()}`); setCreateRequest(''); closeCreate() } catch { setError(t('createFailed')) } finally { setBusy(false) }
            } }, busy ? t('creating') : t('create')))) : null,
        skills.length > 0 ? h('div', { className: 'sm-toolbar' },
          h('input', { type: 'search', className: 'sm-search', value: query, placeholder: t('search'), 'aria-label': t('search'), onInput: event => setQuery(event.currentTarget.value) }),
          h('div', { className: 'sm-filters', role: 'group', 'aria-label': t('filterBySource') },
            [['all', t('all'), skills.length], ['bundled', t('bundled'), bundledCount], ['local', t('local'), skills.length - bundledCount]].map(([id, label, count]) => h('button', {
              type: 'button', key: id, className: `sm-filter${sourceFilter === id ? ' is-active' : ''}`, 'aria-pressed': sourceFilter === id,
              onClick: () => setSourceFilter(id),
            }, `${label} ${count}`)))
        ) : null,
        state === 'refreshing' ? h('p', { className: 'sm-refreshing', role: 'status' }, t('refreshing')) : null,
        h('section', { className: 'sm-installed', 'aria-labelledby': 'sm-installed-title' },
          h('div', { className: 'sm-section-heading' }, h('h3', { id: 'sm-installed-title' }, t('installedTitle')), h('span', null, String(visibleSkills.length))),
          h('div', { className: 'sm-list', 'aria-busy': state === 'loading' || state === 'refreshing' },
          state === 'loading' ? h('p', { className: 'sm-state', role: 'status' }, t('loading'))
            : state === 'error' ? h('div', { className: 'sm-state sm-error', role: 'alert' }, error || t('refreshFailed'), h('button', { type: 'button', className: 'sm-quiet', onClick: () => void refresh() }, t('retry')))
              : skills.length === 0 ? h('p', { className: 'sm-state' }, t('empty'))
                : visibleSkills.length === 0 ? h('p', { className: 'sm-state' }, t('noMatches'))
                : visibleSkills.map(skill => h('article', { className: 'sm-row', key: `${skill.provider}:${skill.name}` },
                  h('div', { className: 'sm-glyph', 'aria-hidden': true }, '✳'),
                  h('div', { className: 'sm-copy' }, h('strong', null, skill.name), h('p', { title: skill.description }, skill.description)),
                  h('div', { className: 'sm-row-meta' },
                    h('span', { className: `sm-source${skill.source === 'bundled' ? ' is-bundled' : ''}` }, skill.source === 'bundled' ? t('bundled') : t('local')),
                    skill.source !== 'bundled' ? h('button', { type: 'button', className: 'sm-row-action', disabled: busy, onClick: () => void publish(skill.name) }, t('publish')) : null)))),
          ),
        h('section', { className: 'sm-shared', 'aria-labelledby': 'sm-shared-title' },
          h('div', { className: 'sm-section-heading' }, h('h3', { id: 'sm-shared-title' }, t('shared')), h('span', null, String(sharedSkills.length))),
          sharedLoading ? h('p', { className: 'sm-state', role: 'status' }, t('sharedLoading'))
            : sharedError ? h('p', { className: 'sm-inline-error', role: 'status' }, t('sharedUnavailable'))
              : sharedSkills.length === 0 ? h('p', { className: 'sm-state' }, t('sharedEmpty'))
              : h('div', { className: 'sm-list' }, sharedSkills.map(skill => {
                const localSkill = skills.find(local => local.name === skill.name)
                const isInstalled = Boolean(localSkill)
                const canUpdate = Boolean(localSkill?.shared && localSkill.shared.sha256 !== skill.sha256)
                return h('article', { className: 'sm-row', key: `shared:${skill.name}` },
                  h('div', { className: 'sm-glyph sm-shared-glyph', 'aria-hidden': true }, '✳'),
                  h('div', { className: 'sm-copy' }, h('strong', null, skill.name), h('p', { title: skill.description }, skill.description)),
                  h('div', { className: 'sm-row-meta' },
                    h('span', { className: 'sm-version' }, `v${skill.version}`),
                    skill.canManage ? h('button', { type: 'button', className: 'sm-row-action is-danger', disabled: busy, onClick: () => void withdraw(skill.name) }, t('withdraw')) : null,
                    h('button', { type: 'button', className: 'sm-row-action', disabled: busy || (isInstalled && !canUpdate), onClick: () => void installShared(skill.name) }, canUpdate ? t('sharedUpdate') : isInstalled ? t('sharedInstalled') : t('sharedInstall')))
                )
              }))),
        error && !formOpen && !createOpen ? h('div', { className: 'sm-error', role: 'alert' }, error) : null)
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
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ t, createSkill }),
      }, SkillManagerPage))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: PANEL_ID, order: 1, label: () => t('title'), locale: NS,
      }, ({ size }) => h(IconDataOutlineRegular, { size })))
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = '@dofe/dsh-sensteed-skill-manager'
        style.textContent = `
          .sm-page{box-sizing:border-box;flex:1;width:100%;height:100%;min-height:0;min-width:0;overflow:auto;padding:calc(28px + var(--dsh-frame-top-clearance,0px)) 48px 48px;display:flex;flex-direction:column;align-items:center;gap:24px;container:skill-manager / inline-size;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
          .sm-page> *{box-sizing:border-box;flex:none;width:100%;max-width:960px;min-width:0}
          .sm-header{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:16px;padding-bottom:8px}
          .sm-heading-copy{flex:1 1 240px;min-width:0}.sm-actions{flex:none;white-space:nowrap}
          .sm-header h2{margin:0;font-size:20px;font-weight:650;line-height:1.3}.sm-header p,.sm-create p{margin:5px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5}
          .sm-actions,.sm-form-actions{display:flex;align-items:center;gap:8px}.sm-icon{width:36px;height:36px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:21px;cursor:pointer}.sm-icon:hover,.sm-quiet:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
          .sm-primary,.sm-secondary,.sm-quiet{min-height:36px;padding:0 13px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;font:inherit;font-size:13px;cursor:pointer}.sm-primary{border-color:var(--dsw-alias-button-primary-fill);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}.sm-secondary{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.sm-quiet{background:transparent;color:var(--dsw-alias-label-secondary)}.sm-primary:disabled,.sm-secondary:disabled,.sm-quiet:disabled{cursor:wait;opacity:.55}
          .sm-add-group{position:relative;display:flex}.sm-add-primary{display:inline-flex;align-items:center;gap:6px;border-radius:6px 0 0 6px}.sm-add-primary span{font-size:18px;line-height:1}.sm-add-more{width:32px;padding:0;border-left:1px solid color-mix(in srgb,var(--dsw-alias-button-primary-fill) 70%,white);border-radius:0 6px 6px 0;font-size:15px}.sm-add-menu{position:absolute;z-index:5;top:calc(100% + 8px);right:0;width:min(360px,calc(100vw - 32px));padding:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 12px 28px rgb(0 0 0 / 14%)}.sm-add-menu-item{display:flex;align-items:flex-start;gap:10px;width:100%;padding:10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}.sm-add-menu-item:hover,.sm-add-menu-item:focus-visible{background:var(--dsw-alias-bg-layer-2);outline:0}.sm-add-menu-item strong,.sm-add-menu-item small{display:block}.sm-add-menu-item strong{font-size:13px;font-weight:600}.sm-add-menu-item small{margin-top:4px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.4}.sm-menu-icon{display:grid;place-items:center;flex:0 0 24px;width:24px;height:24px;color:var(--dsw-alias-brand-primary);font-size:17px}
          .sm-list{display:grid;min-width:0}.sm-installed{display:grid;gap:10px}.sm-row{display:flex;align-items:center;gap:14px;min-height:74px;padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}.sm-row:hover{background:var(--dsw-alias-bg-layer-2)}.sm-glyph{display:grid;place-items:center;flex:0 0 48px;width:48px;height:48px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;color:var(--dsw-alias-brand-primary);font-size:22px}.sm-copy{flex:1;min-width:0}.sm-copy strong{font-size:14px;font-weight:600}.sm-copy p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.45;overflow-wrap:anywhere}.sm-source{flex:0 0 auto;padding:3px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px}.sm-source.is-bundled{background:var(--dsw-alias-state-success-secondary);color:var(--dsw-alias-state-success-primary)}.sm-row-action{flex:0 0 auto;min-height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}.sm-row-action:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}.sm-row-action:disabled{opacity:.5;cursor:default}.sm-row-action.is-danger{color:var(--dsw-alias-state-error-primary)}.sm-shared{padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}.sm-section-heading{display:flex;align-items:center;gap:8px}.sm-section-heading h3{margin:0;font-size:15px;font-weight:600}.sm-section-heading span,.sm-version{color:var(--dsw-alias-label-secondary);font-size:12px}.sm-shared-glyph{color:var(--dsw-alias-state-success-primary)}
          .sm-state{padding:28px 12px;color:var(--dsw-alias-label-secondary);font-size:13px}.sm-error,.sm-inline-error{color:var(--dsw-alias-state-error-primary)}.sm-error button,.sm-inline-error button{margin-left:8px}.sm-inline-error{font-size:13px}.sm-notice,.sm-refreshing{margin:0;color:var(--dsw-alias-state-success-primary);font-size:13px}.sm-refreshing{color:var(--dsw-alias-label-secondary)}
          .sm-toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}.sm-search{box-sizing:border-box;width:min(100%,360px);height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}.sm-search:focus-visible,.sm-create-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.sm-filters{display:flex;gap:4px}.sm-filter{min-height:32px;padding:0 9px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}.sm-filter:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.sm-filter.is-active{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
          .sm-install-form,.sm-create-form{display:grid;gap:12px;padding:18px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}.sm-form-heading{display:grid;gap:4px}.sm-form-heading strong{font-size:14px}.sm-form-heading p{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45}.sm-install-form label{display:grid;gap:7px;font-size:13px;font-weight:550}.sm-install-form input{box-sizing:border-box;width:100%;height:38px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit}.sm-install-form input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.sm-install-form p{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px}.sm-form-actions{justify-content:flex-end}.sm-create-input{box-sizing:border-box;width:100%;min-height:96px;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.5;resize:vertical}.sm-create-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
          .sm-installed,.sm-shared,.sm-list{min-width:0}.sm-shared{display:grid;gap:10px;padding-top:24px}.sm-section-heading h3,.sm-source,.sm-row-action,.sm-filter,.sm-version{white-space:nowrap}
          .sm-row{display:grid;grid-template-columns:48px minmax(0,1fr) auto;padding:14px 0;gap:16px}.sm-row-meta{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px}.sm-copy strong{display:block;overflow-wrap:anywhere;line-height:1.5}.sm-copy p{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;line-height:1.55}.sm-state{margin:0}.sm-form-actions{flex-wrap:wrap}
          .sm-add-group,.sm-filters{flex-shrink:0}.sm-add-primary,.sm-add-more{white-space:nowrap}.sm-add-menu{max-width:100cqw}.sm-search{min-width:0}.sm-icon{flex:none}.sm-filters{flex-wrap:wrap}
          @container skill-manager (max-width:600px){.sm-row{grid-template-columns:40px minmax(0,1fr);gap:8px 12px}.sm-row-meta{grid-column:2;justify-content:flex-start}.sm-glyph{width:40px;height:40px;grid-row:1 / span 2;align-self:start}.sm-search{width:100%}.sm-toolbar{gap:12px}.sm-heading-copy{flex-basis:100%}.sm-actions{width:100%;justify-content:flex-end}}
          @media(max-width:760px){.sm-page{padding-inline:24px}}
          @media(max-width:420px){.sm-page{padding-inline:16px}.sm-install-form,.sm-create-form{padding:14px}}
        `
        document.head.appendChild(style)
        return () => style.remove()
      }, 'sensteed-skill-manager: styles')
    }

    module.exports = { apply, inject: ['slots', 'locale', 'sessions', 'uiWorkspace'], __test: { request } }

    return module.exports;
  },
});
