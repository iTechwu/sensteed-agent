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
    generationTitle: "当前 Profile 整体管理", generationProfile: "当前 Profile", generationAction: "操作", generationEnabled: "启用", generationPreview: "查看完整变更计划", generationConfirm: "确认完整代际变更与访问声明", generationExpires: "计划截止", generationBytes: "制品字节", generationExecute: "确认并执行完整计划", generationPreviewFailed: "计划不可用或已过期，请重新检查。", generationStatusUnknown: "执行结果尚未确认。不要重复操作；请刷新检查 Host 恢复状态。", generationRestart: "已写入代际，等待 Host 安全重启；尚未确认实际加载。", generationPermissionsUnknown: "访问声明未提供；以 Host 确认计划与权限检查为准。", generationWorking: "Host 正在处理…", generation_skip: "不加入", generation_retain: "保留固定版本", generation_install: "安装", generation_update: "更新", generation_uninstall: "移除",
    title: '技能', description: '安装、创建和管理 Agent 技能', refresh: '刷新', add: '添加技能', chooseAddMethod: '选择添加技能方式',
    create: '让 Agent 创建', install: '安装第三方技能', empty: '还没有可用的技能', installedTitle: '已安装技能',
    loading: '正在读取技能…', refreshing: '正在刷新技能…', refreshFailed: '技能列表刷新失败。', serviceUnavailable: '技能服务暂时不可用，请稍后重试。', retry: '重试', repository: 'GitHub 仓库或技能目录链接',
    installAction: '安装', cancel: '取消', installing: '正在安装…', installed: '已安装',
    publish: '上传到公司', publishing: '正在上传…', publishSuccess: '已发布到公司技能库', publishError: '发布失败，请稍后重试。',
    shared: '公司共享（旧版）', sharedEmpty: '公司技能库还没有技能', sharedUnavailable: '暂时无法读取公司技能库', sharedInstall: '安装', sharedUpdate: '更新', sharedInstalled: '已安装', sharedLoading: '正在读取公司技能库…',
    generationBase: '当前基础版本未启用统一代际管理；此处目录和旧版共享技能操作不代表整体 Profile 安装。', generationReady: '当前 Profile 的统一代际服务可用；检查结果不是安装授权。', generationUnavailable: '无法检查当前 Profile 的统一代际服务，请刷新重试。',
    hub: '企业 Hub', hubEmpty: '企业 Hub 目录还没有内容', hubUnavailable: '暂时无法读取企业 Hub（需桌面端登录企业账号）', hubOpen: '在 Hub 查看', hubSkillsTitle: 'Hub 技能', hubPluginsTitle: 'Hub 插件', hubHint: '目录原文可直接查看；发布并获批准后才可安装。', workspace: '工作空间', unpublished: '尚未发布', hubLoading: '正在读取企业目录…', hubSignIn: '登录企业账号', hubSigningIn: '正在打开登录…',
    hubScripts: '含脚本', hubFiles: '文件访问', hubAccessNone: '无', hubAccessSelected: '用户选择的文件', hubAccessWorkspace: '工作区文件', hubAccessSystem: '系统文件', hubNetwork: '网络访问', hubNone: '无', hubYes: '是', hubNo: '否', hubInstall: '安装', hubUpdate: '更新', hubRemove: '移除', hubUnsupported: '插件尚不支持安装', hubConfirmTitle: '确认企业技能操作', hubConfirm: '确认', hubShared: '此操作影响本机所有 Profile 的共享技能。', hubDeclaration: '作者访问声明（尚无运行兼容性测试）', hubWritten: '已写入，等待发现或重载', hubDiscovered: '已由技能服务发现', hubRemoved: '企业技能已移除', hubConflict: '本机内容冲突', hubWorking: '本机操作进行中', hubNotExecuted: '操作未执行，请重新查看计划', hubPending: '回执待同步', hubAttention: '操作需要核对；本机内容和恢复材料已保留', hubUnknown: '授权消费结果未知；本机技能未变更',
    withdraw: '撤回', withdrawing: '正在撤回…', withdrawSuccess: '已从公司技能库撤回',
    installHint: '可粘贴单技能仓库，或合集仓库中某个技能的 /tree/ 分支目录链接。来源可信后再安装。Skill 会在本机加载。',
    installError: '安装失败，请检查仓库地址和技能结构。', installSuccess: '已安装 {name}', bundled: '内置', local: '本机',
    search: '搜索技能名称或说明', all: '全部', filterBySource: '按来源筛选', noMatches: '没有匹配的技能',
    createHint: '进入会话，由 Agent 引导你创建技能。',
    createFailed: '无法开始创建技能，请重试。', close: '关闭', creating: '正在打开会话…',
    installMenuHint: '从 GitHub 仓库或技能目录安装到本机。',
  },
  en: {
    generationTitle: "Current Profile generation", generationProfile: "Current Profile", generationAction: "Action", generationEnabled: "Enabled", generationPreview: "Review complete change plan", generationConfirm: "Confirm generation changes and access declarations", generationExpires: "Plan expires", generationBytes: "Artifact bytes", generationExecute: "Confirm and execute complete plan", generationPreviewFailed: "Plan unavailable or expired. Check again.", generationStatusUnknown: "Execution outcome is unconfirmed. Do not repeat. Refresh Host recovery status.", generationRestart: "Generation written; awaiting safe Host restart. Actual loading is not confirmed.", generationPermissionsUnknown: "Access declaration unavailable; Host plan and permission checks remain authoritative.", generationWorking: "Host is processing…", generation_skip: "Exclude", generation_retain: "Retain pinned version", generation_install: "Install", generation_update: "Update", generation_uninstall: "Remove",
    title: 'Skills', description: 'Install, create, and manage Agent skills', refresh: 'Refresh', add: 'Add skill', chooseAddMethod: 'Choose how to add a skill',
    create: 'Create with Agent', install: 'Install third-party skill', empty: 'No skills available yet', installedTitle: 'Installed skills',
    loading: 'Loading skills…', refreshing: 'Refreshing skills…', refreshFailed: 'Could not refresh the skill list.', serviceUnavailable: 'The skill service is temporarily unavailable. Try again later.', retry: 'Retry', repository: 'GitHub repository or skill directory URL',
    installAction: 'Install', cancel: 'Cancel', installing: 'Installing…', installed: 'Installed',
    publish: 'Share with company', publishing: 'Publishing…', publishSuccess: 'Published to company skills', publishError: 'Could not publish this skill. Try again.',
    shared: 'Company shared', sharedEmpty: 'No company skills yet', sharedUnavailable: 'Company skills are temporarily unavailable', sharedInstall: 'Install', sharedUpdate: 'Update', sharedInstalled: 'Installed', sharedLoading: 'Loading company skills…',
    generationBase: 'Unified generation management is not enabled in this base version. Catalog and legacy shared-skill actions do not install a complete Profile.', generationReady: 'Unified generation service is available for the current Profile. A check is not installation authorization.', generationUnavailable: 'Could not check the current Profile generation service. Refresh to retry.',
    hub: 'Company hub', hubEmpty: 'The company hub catalog is empty', hubUnavailable: 'The company hub is temporarily unavailable (desktop enterprise sign-in required)', hubOpen: 'Open in hub', hubSkillsTitle: 'Hub skills', hubPluginsTitle: 'Hub plugins', hubHint: 'Catalog documents can be viewed directly. Installation requires an approved release.', workspace: 'Workspace', unpublished: 'Not published', hubLoading: 'Loading enterprise catalog…', hubSignIn: 'Sign in to company', hubSigningIn: 'Opening sign-in…',
    hubScripts: 'Scripts', hubFiles: 'File access', hubAccessNone: 'None', hubAccessSelected: 'User selected files', hubAccessWorkspace: 'Workspace files', hubAccessSystem: 'System files', hubNetwork: 'Network access', hubNone: 'None', hubYes: 'Yes', hubNo: 'No', hubInstall: 'Install', hubUpdate: 'Update', hubRemove: 'Remove', hubUnsupported: 'Plugin installation is not supported yet', hubConfirmTitle: 'Confirm enterprise skill operation', hubConfirm: 'Confirm ', hubShared: 'This changes shared skills for every local Profile.', hubDeclaration: 'Author access declaration (no runtime compatibility test)', hubWritten: 'Written; awaiting discovery or reload', hubDiscovered: 'Discovered by the skill service', hubRemoved: 'Enterprise skill removed', hubConflict: 'Local content conflict', hubWorking: 'Local operation in progress', hubNotExecuted: 'Operation did not run; review a new plan', hubPending: 'Receipt pending sync', hubAttention: 'Review required; local content and recovery evidence preserved', hubUnknown: 'Consumption outcome unknown; local skill unchanged',
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
async function openHubItem(kind, id, workspaceId) {
  const fallback = `${HUB_WEB_BASE}/${kind === 'plugin' ? 'plugins' : 'skills'}${id ? `/${encodeURIComponent(id)}` : ''}${workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : ''}`
  try {
    const body = await request('/hub/view-url', { method: 'POST', body: JSON.stringify({ kind, ...(id ? { id } : {}) }) })
    if (typeof body?.url === 'string' && new URL(body.url).origin === new URL(HUB_WEB_BASE).origin && /^\/plugins(?:\/|$)/u.test(new URL(body.url).pathname)) {
      window.open(body.url, '_blank', 'noopener')
      return
    }
  }
  catch { /* 回退直开 */ }
  window.open(fallback, '_blank', 'noopener')
}

function hubRow(item, t, workspaceId, installed, preview, busy) {
  return h('article', { className: 'sm-row', key: `hub:${item.kind}:${item.id}` },
    h('div', { className: 'sm-glyph', 'aria-hidden': true }, h(IconSkillOutlineRegular, { size: 24 })),
    h('div', { className: 'sm-copy' }, h('strong', null, item.displayName || item.name), h('p', { title: item.description }, item.description)),
    h('div', { className: 'sm-row-meta' },
      h('span', { className: 'sm-version' }, item.version ? `v${item.version}` : t('unpublished')),
      h('button', { type: 'button', className: 'sm-row-action', onClick: () => openHubItem(item.kind, item.id, workspaceId) }, t('hubOpen')),
      installed?.localModified ? h('span',{className:'sm-inline-error'},t('hubConflict')) : null,
      item.kind === 'plugin' ? h('span', {className:'sm-version'},t('hubUnsupported')) : h(React.Fragment,null,
        h('button',{type:'button',className:'sm-row-action',disabled:busy || !item.version || (installed?.version === item.version && !installed?.localModified),onClick:() => preview(item,installed ? 'update' : 'install')},t(installed ? 'hubUpdate' : 'hubInstall')),
        installed ? h('button',{type:'button',className:'sm-row-action',disabled:busy,onClick:() => preview(item,'uninstall')},t('hubRemove')) : null)))
}

const GENERATION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const generationKey = item => `${item.kind}:${item.itemId}`
function generationSelection(check) {
  if (!check || !GENERATION_UUID.test(check.profileId) || !Array.isArray(check.entries) || !Array.isArray(check.activeItems)) throw new Error('Invalid Host generation check.')
  const active=new Map(check.activeItems.map(i=>[generationKey(i),i]))
  const rows=new Map(check.entries.map(i=>[generationKey(i),i]))
  for(const [key,item] of active) if(!rows.has(key)) rows.set(key,item)
  return [...rows.values()].map(item=>{
    if(!['skill','plugin'].includes(item.kind)||!GENERATION_UUID.test(item.itemId)) throw new Error('Invalid Host generation item.')
    const current=active.get(generationKey(item))
    return {...item,action:current?'retain':item.required?'install':'skip',enabled:item.required||current?.enabled!==false,active:!!current}
  })
}
function generationPreview(value) {
  if(!value || !GENERATION_UUID.test(value.intentId)||!GENERATION_UUID.test(value.confirmationNonce)||!GENERATION_UUID.test(value.profileId)||!Array.isArray(value.items)||!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)<=Date.now()||!/^[a-f0-9]{64}$/.test(value.planDigest)) throw new Error('Invalid or expired Host generation preview.')
  for(const item of value.items) if(!['skill','plugin'].includes(item.kind)||!GENERATION_UUID.test(item.itemId)||!['retain','install','update','uninstall'].includes(item.action)||typeof item.enabled!=='boolean')throw Error('Invalid Host plan item.')
  return value
}
function GenerationPanel({t}) {
  const [phase,setPhase]=useState('idle'),[rows,setRows]=useState([]),[profile,setProfile]=useState(''),[intent,setIntent]=useState(null),[operation,setOperation]=useState(null),[error,setError]=useState('')
  const mounted=useRef(true), serial=useRef(0), executing=useRef(false)
  useEffect(()=>()=>{mounted.current=false;serial.current++},[])
  const post=async(method,body,long=false)=>{
    const value=await (long?requestLong:request)(`/hub/generation/${method}`,{method:'POST',body:JSON.stringify(body)})
    if(value?.available!==true) {if(value?.reason==='BASE_VERSION_NOT_ENABLED'){setPhase('base');return null}throw Error('Generation service unavailable')}
    return value.result
  }
  const check=async()=>{
    const epoch=++serial.current;setPhase('checking');setIntent(null);setError('')
    try {const value=await post('check',{channel:'stable'});if(!value||!mounted.current||epoch!==serial.current)return
      setRows(generationSelection(value));setProfile(value.profileId);setOperation(value.operation||null);setPhase(value.operation?.operationId&&!['ACTIVATED','ROLLED_BACK'].includes(value.operation.phase)?'operation':'ready')
    }catch{if(mounted.current&&epoch===serial.current){setPhase('error');setError(t('generationUnavailable'))}}
  }
  useEffect(()=>{void check()},[])
  useEffect(()=>{
    if(!operation?.operationId || ['ACTIVATED','ROLLED_BACK'].includes(operation.phase))return
    const timer=setTimeout(()=>{void post('status',{operationId:operation.operationId}).then(value=>{if(mounted.current&&value)setOperation(value)}).catch(()=>{if(mounted.current)setError(t('generationStatusUnknown'))})},3000)
    return ()=>clearTimeout(timer)
  },[operation])
  const preview=async()=>{
    const epoch=++serial.current;setPhase('previewing');setIntent(null);setError('')
    try {const value=await post('preview',{channel:'stable',requested:rows.filter(i=>i.action!=='skip').map(({kind,itemId,action,enabled})=>({kind,itemId,action,enabled}))});if(!value||!mounted.current||epoch!==serial.current)return
      const checked=generationPreview(value);if(checked.profileId!==profile)throw Error('Profile changed');setIntent(checked);setPhase('confirm')
    }catch{if(mounted.current&&epoch===serial.current){setPhase('ready');setError(t('generationPreviewFailed'))}}
  }
  const execute=async()=>{
    if(executing.current||!intent)return
    let valid;try{valid=generationPreview(intent)}catch{setIntent(null);setPhase('ready');setError(t('generationPreviewFailed'));return}
    executing.current=true;setIntent(null);setPhase('executing');setError('')
    try {const value=await post('execute',{intentId:valid.intentId,confirmationNonce:valid.confirmationNonce},true);if(!mounted.current||!value)return
      if(!GENERATION_UUID.test(value.operationId))throw Error('Invalid operation')
      setOperation(value);setPhase('operation')
    }catch{if(mounted.current){setPhase('unknown');setError(t('generationStatusUnknown'))}}
    finally{executing.current=false}
  }
  const busy=['checking','previewing','executing'].includes(phase)
  return h('section',{className:'sm-generation','aria-label':t('generationTitle')},
    h('h4',null,t('generationTitle')),
    phase==='base'?h('p',{role:'status'},t('generationBase')):null,
    phase==='error'?h('p',{role:'alert'},error):null,
    phase!=='base'&&profile?h('p',null,`${t('generationProfile')}: ${profile}`):null,
    !['base','idle','checking','error'].includes(phase)?h('div',null,
      rows.map(item=>h('div',{key:generationKey(item),className:'sm-generation-row'},
        h('span',null,`${item.displayName||item.itemId} (${item.kind}) ${item.version||''}`),
        h('select',{'aria-label':`${t('generationAction')} ${item.displayName||item.itemId}`,value:item.action,disabled:busy||phase==='confirm'||phase==='operation'||phase==='unknown',onChange:e=>{const action=e.currentTarget.value;setRows(rows.map(i=>generationKey(i)===generationKey(item)?{...i,action}:i));setIntent(null)}},
          (item.active?['retain','update',...(!item.required?['uninstall']:[])]:item.required?['install']:['skip','install']).map(action=>h('option',{key:action,value:action},t(`generation_${action}`)))),
        h('label',null,h('input',{type:'checkbox',checked:item.enabled,disabled:busy||item.required||phase!=='ready',onChange:e=>{const enabled=e.currentTarget.checked;setRows(rows.map(i=>generationKey(i)===generationKey(item)?{...i,enabled}:i));setIntent(null)}}),t('generationEnabled')),
        item.reason?h('p',null,item.reason):null)),
      phase==='ready'?h('button',{type:'button',className:'sm-quiet',onClick:()=>void preview()},t('generationPreview')):null):null,
    intent?h('div',{className:'sm-generation-confirm',role:'region','aria-label':t('generationConfirm')},
      h('h4',null,t('generationConfirm')),h('p',null,`${t('generationProfile')}: ${intent.profileId}`),h('p',null,`${t('generationExpires')}: ${intent.expiresAt}`),h('p',null,`${t('generationBytes')}: ${intent.totalBytes??'—'}`),
      intent.items.map((item,index)=>h('article',{key:index},h('strong',null,`${t(`generation_${item.action}`)} · ${item.displayName||item.itemId} · ${item.version||'—'}`),
        item.accessDeclaration?h('p',null,`${t('hubScripts')}: ${String(item.accessDeclaration.containsScripts)} · ${t('hubFiles')}: ${item.accessDeclaration.fileAccess} · ${t('hubNetwork')}: ${(item.accessDeclaration.networkHosts||[]).join(', ')||t('hubNone')}`):h('p',null,t('generationPermissionsUnknown')))),
      h('button',{type:'button',className:'sm-primary',disabled:busy,onClick:()=>void execute()},t('generationExecute')),
      h('button',{type:'button',className:'sm-quiet',onClick:()=>{setIntent(null);setPhase('ready')}},t('cancel'))):null,
    operation?h('div',{role:'status'},h('p',null,`${operation.operationId} · ${operation.state||''} · ${operation.phase||''}`),operation.errorCode?h('p',null,operation.errorCode):null,operation.restartRequired?h('p',null,t('generationRestart')):null):null,
    error&&phase!=='error'?h('p',{role:'alert'},error):null,
    busy?h('p',{role:'status'},t('generationWorking')):null,
    !busy?h('button',{type:'button',className:'sm-quiet',onClick:()=>void check()},t('refresh')):null)
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
  const [hubWorkspaces, setHubWorkspaces] = useState([])
  const [hubWorkspaceId, setHubWorkspaceId] = useState('')
  const [hubSourceErrors, setHubSourceErrors] = useState({})
  const [hubLoading, setHubLoading] = useState(false)
  const [hubIntent,setHubIntent] = useState(null)
  const [hubInstalled,setHubInstalled] = useState([])
  const [hubOperations,setHubOperations] = useState([])
  const hubConfirmRef = useRef(null)
  useEffect(() => { if (hubIntent) hubConfirmRef.current?.focus() },[hubIntent])
  const operation = useRef(false)
  const refreshGeneration = useRef(0)
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
    const generation = ++refreshGeneration.current
    const current = () => refreshGeneration.current === generation
    setState(skills.length > 0 ? 'refreshing' : 'loading')
    setSharedLoading(true); setHubLoading(true)
    setError(''); setRefreshError(''); setNotice(''); setHubIntent(null)
    await Promise.allSettled([
      request('?source=local').then(body => {
        if (!current()) return
        setSkills(body.skills || []); setState('ready')
      }).catch(cause => {
        if (!current()) return
        setState(skills.length > 0 ? 'ready' : 'error')
        setRefreshError(cause?.statusCode >= 500 ? t('serviceUnavailable') : t('refreshFailed'))
      }),
      request('?source=shared').then(body => {
        if (!current()) return
        setSharedSkills(body.sharedSkills || []); setSharedError(body.sharedError || '')
      }).catch(() => { if (current()) setSharedError(t('sharedUnavailable')) })
        .finally(() => { if (current()) setSharedLoading(false) }),
      request('?source=hub').then(body => {
        if (!current()) return
        setHubSkills((body.hubSkills || []).map(item => ({ id: item.skillId, name: item.slug, displayName: item.displayName, description: item.description, version: item.stableVersion, kind: 'skill' })))
        setHubPlugins((body.hubPlugins || []).map(item => ({ id: item.pluginId, name: item.npmPackageName || item.pluginId, displayName: item.displayName, description: item.description, version: item.stableVersion, kind: 'plugin' })))
        setHubWorkspaces(body.hubWorkspaces || [])
        setHubWorkspaceId(body.hubWorkspaceId || '')
        setHubSourceErrors({ skills: body.hubSkillsError, plugins: body.hubPluginsError })
        setHubError(body.hubWorkspaceError || '')
        setHubSsoRequired(body.hubErrorCode === 'HUB_SSO_REQUIRED')
        void request('/hub/skills/operations').then(result => {
          if (!current()) return
          setHubInstalled(result.installed || []); setHubOperations(result.operations || [])
        }).catch(() => { if (current()) { setHubInstalled([]); setHubOperations([]) } })
      }).catch(() => {
        if (!current()) return
        setHubSkills([]); setHubPlugins([]); setHubWorkspaces([]); setHubWorkspaceId('')
        setHubError(t('hubUnavailable'))
      }).finally(() => { if (current()) setHubLoading(false) }),
    ])
  }
  const selectWorkspace = async workspaceId => {
    ++refreshGeneration.current
    setHubIntent(null); setHubInstalled([]); setHubOperations([])
    setHubLoading(true); setHubError(''); setHubSkills([]); setHubPlugins([])
    try {
      await request('/hub/workspace', { method: 'POST', body: JSON.stringify({ workspaceId }) })
      await refresh()
    } catch (cause) { setHubError(cause.message || t('hubUnavailable')) }
    finally { setHubLoading(false) }
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
  const previewHub = async (item,action) => {
    if (operation.current) return
    operation.current = true; setBusy(true); setError(''); setHubIntent(null)
    try { setHubIntent(await request('/hub/skills/preview',{method:'POST',body:JSON.stringify({skillId:item.id,action})})) }
    catch (cause) { setError(cause.message) }
    finally { operation.current = false; setBusy(false) }
  }
  const executeHub = async () => {
    if (operation.current || !hubIntent) return
    operation.current = true; setBusy(true); setError('')
    try {
      await requestLong('/hub/skills/execute',{method:'POST',body:JSON.stringify({intentId:hubIntent.intentId})})
      setHubIntent(null); await refresh()
    } catch (cause) { setError(cause.message); setHubIntent(null) }
    finally { operation.current = false; setBusy(false) }
  }
  const operationLabel = value => value.status === 'ABORTED' ? t('hubNotExecuted') : value.status === 'CONSUME_UNKNOWN' ? t('hubUnknown') : value.status === 'NEEDS_ATTENTION' ? t('hubAttention')
    : !value.state ? t('hubWorking') : value.state === 'DISCOVERED' ? t('hubDiscovered') : value.state === 'REMOVED' ? t('hubRemoved') : t('hubWritten')
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
                h('span', { className: `sm-source${skill.source === 'bundled' ? ' is-bundled' : ''}` }, skill.source === 'bundled' ? t('bundled') : skill.source === 'hub' ? t('hub') : skill.shared ? t('shared') : t('local')),
                skill.source !== 'bundled' && skill.source !== 'hub' ? h('button', { type: 'button', className: 'sm-row-action', disabled: busy, onClick: () => void publish(skill.name) }, t('publish')) : null)))),
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
      hubWorkspaces.length > 0 ? h('label', { className: 'sm-workspace' }, t('workspace'),
        h('select', { value: hubWorkspaceId, disabled: busy || hubLoading, onChange: event => void selectWorkspace(event.currentTarget.value) },
          hubWorkspaces.map(item => h('option', { key: item.ssoTeam.id, value: item.ssoTeam.id }, `${item.ssoTenant.name} · ${item.ssoTeam.name}`)))) : null,
      h('p', { className: 'sm-hub-hint' }, t('hubHint')),
      h(GenerationPanel,{t}),
      hubLoading ? h('p', { className: 'sm-refreshing', role: 'status' }, t('hubLoading')) : null,
      hubError ? h('div', { className: 'sm-inline-error', role: 'status' }, hubError,
        hubSsoRequired
          ? h('button', { type: 'button', className: 'sm-quiet', disabled: hubSigningIn, onClick: signInToHub }, hubSigningIn ? t('hubSigningIn') : t('hubSignIn'))
          : h('button', { type: 'button', className: 'sm-quiet', disabled: hubLoading, onClick: () => void refresh() }, t('retry'))) : null,
      !hubError && !hubLoading && !hubSourceErrors.skills && !hubSourceErrors.plugins && hubSkills.length === 0 && hubPlugins.length === 0 ? h('p', { className: 'sm-state' }, t('hubEmpty')) : null,
      [['skills', t('hubSkillsTitle'), visibleHubSkills], ['plugins', t('hubPluginsTitle'), visibleHubPlugins]].map(([domain, title, items]) =>
        h('div', { className: 'sm-list', key: domain },
          items.length > 0 || hubSourceErrors[domain] ? h('h4', { className: 'sm-hub-group' }, title) : null,
          hubSourceErrors[domain] && !hubError ? h('p', { className: 'sm-inline-error', role: 'status' }, hubSourceErrors[domain]) : null,
          items.map(item => hubRow(item, t, hubWorkspaceId, hubInstalled.find(value => value.skillId === item.id), previewHub, busy))))) : null,
    error && !formOpen ? h('div', { className: 'sm-error', role: 'alert' }, error) : null),
    hubOperations.length ? h('div',{className:'sm-notice',role:'status'},hubOperations.slice(-5).map(value => h('p',{key:value.operationId},`${value.installName}: ${operationLabel(value)}${value.receiptPending ? ` · ${t('hubPending')}` : ''}`))) : null,
    hubIntent ? h('section',{className:'sm-overlay',role:'dialog','aria-modal':true,'aria-label':t('hubConfirmTitle'),onKeyDown:event => {
      if (event.key === 'Escape' && !busy) setHubIntent(null)
      if (event.key === 'Tab') { const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled)')]; const first=controls[0],last=controls.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() } }
    }},h('div',{className:'sm-install-dialog'},
      h('h2',null,`${t('hubConfirmTitle')} · ${t(hubIntent.action === 'uninstall' ? 'hubRemove' : hubIntent.action === 'update' ? 'hubUpdate' : 'hubInstall')}`),h('p',null,`${hubIntent.workspace?.ssoTeam?.name || ''} · ${hubIntent.installName} · ${hubIntent.existingVersion || '—'} → ${hubIntent.action === 'uninstall' ? '—' : hubIntent.version}`),
      h('p',null,t('hubShared')),h('p',null,t('hubDeclaration')),
      h('p',null,`${hubIntent.compatibility.authorDeclared} · ${t('hubScripts')}: ${hubIntent.accessDeclaration.containsScripts ? t('hubYes') : t('hubNo')} · ${t('hubFiles')}: ${t({'none':'hubAccessNone','user-selected':'hubAccessSelected','workspace':'hubAccessWorkspace','system':'hubAccessSystem'}[hubIntent.accessDeclaration.fileAccess])}`),
      h('p',null,`${t('hubNetwork')}: ${hubIntent.accessDeclaration.networkHosts.join(', ') || t('hubNone')}`),
      h('button',{ref:hubConfirmRef,type:'button',disabled:busy,onClick:() => void executeHub()},busy ? t('installing') : `${t('hubConfirm')}${t(hubIntent.action === 'uninstall' ? 'hubRemove' : hubIntent.action === 'update' ? 'hubUpdate' : 'hubInstall')}`),
      h('button',{type:'button',disabled:busy,onClick:() => setHubIntent(null)},t('cancel')))) : null,
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
      .sm-workspace{display:flex;align-items:center;gap:12px;margin-bottom:12px;font-size:13px}.sm-workspace select{max-width:100%;min-height:36px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:inherit;padding:0 8px}
      .sm-generation{margin:12px 0;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;font-size:13px;overflow-wrap:anywhere}.sm-generation h4{margin:0 0 10px}.sm-generation-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0}.sm-generation-row span{flex:1;min-width:160px}.sm-generation-row select{min-height:32px;background:var(--dsw-alias-bg-layer-1);color:inherit;border:1px solid var(--dsw-alias-border-l1);border-radius:6px}.sm-generation-confirm{margin-top:14px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}.sm-generation-confirm article{padding:8px 0}.sm-generation button{margin:6px 8px 0 0}
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

module.exports = { apply, inject: ['slots', 'locale', 'sessions', 'uiWorkspace', 'workspaces', 'layout'], __test: { request, createSkillConversation, generationSelection, generationPreview, GenerationPanel } }
