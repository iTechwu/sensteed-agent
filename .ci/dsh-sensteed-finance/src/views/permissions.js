// 完整策略是替换关系；最终权限始终由服务器解析，不在客户端叠加旧授权。
function financePolicyPeople(directory, purpose = 'permission') {
  return (directory?.members || []).filter(person => person.userId && (purpose === 'role' ? (person.identityEnabled ?? person.enabled) : person.enabled) && person.source !== 'LOCAL_MIRROR')
}
function financePolicyDepartmentPeople(directory, ids, purpose = 'permission') {
  const selected = new Set(ids)
  let changed = true
  while (changed) {
    changed = false
    for (const department of directory?.departments || []) if (selected.has(department.parentId) && !selected.has(department.id)) { selected.add(department.id); changed = true }
  }
  return [...new Set(financePolicyPeople(directory, purpose).filter(person => person.departmentIds?.some(id => selected.has(id))).map(person => person.userId))]
}
function FinanceOrganizationNotice({ directory, onRefresh }) {
  if (!directory?.syncStatus || directory.syncStatus === 'SUCCESS') return null
  return h('div', { role: directory.syncStatus === 'FAILED' ? 'alert' : 'status', className: 'sf-note' },
    directory.syncStatus === 'FAILED' ? '飞书组织同步失败，目录可能不完整。请先核对通讯录同步状态；成员无需先登录。' : '组织同步正在进行，当前显示已同步的成员。',
    directory.syncError ? h('p', null, financeErrorText(directory.syncError)) : null,
    onRefresh ? h(GhostButton, { onClick: onRefresh }, '刷新目录') : null)
}
function financePolicyErrors(value, people, roles, orgs, departments, confirmed = true) {
    const errors = {};
    if (value.subjectType === 'USER') {
        if (!value.userIds.length ||
            value.userIds.length > 500 ||
            value.userIds.some((id) => !id || id.length > 64 || !people.some((person) => person.userId === id)))
            errors.subject = '请从当前组织选择 1 至 500 名可用成员';
    }
    else if (value.subjectType !== 'ROLE' ||
        !roles.some((role) => role.id === value.subjectId && role.enabled))
        errors.subject = '请选择可用岗位角色';
    if (value.permissions.length > 100 ||
        value.permissions.some((code) => !Object.hasOwn(FINANCE_PERMISSION_NAMES, code)))
        errors.permissions = '存在不可识别的功能，请刷新后核对';
    if (value.permissions.length) {
        if (!value.scopes.length || value.scopes.length > 100)
            errors.scopes = '请选择 1 至 100 个数据范围';
        value.scopes.forEach((scope, index) => {
            const key = `scope-${index}`;
            if (!['SELF', 'GLOBAL', 'ORG', 'DEPARTMENT'].includes(scope.scopeType))
                errors[`${key}-scopeType`] = '请选择数据范围';
            if ((scope.scopeType === 'ORG' || scope.orgId) && !orgs.some((row) => row.id === scope.orgId))
                errors[`${key}-orgId`] = '请选择有效主体';
            if ((scope.scopeType === 'DEPARTMENT' || scope.departmentId) &&
                !departments.some((row) => row.id === scope.departmentId))
                errors[`${key}-departmentId`] = '请选择有效部门';
            for (const field of ['yearFrom', 'yearTo'])
                if (scope[field] !== '' &&
                    scope[field] != null &&
                    (!String(scope[field]).trim() || !Number.isSafeInteger(Number(scope[field]))))
                    errors[`${key}-${field}`] = '年度必须是整数';
            if (!errors[`${key}-yearFrom`] &&
                !errors[`${key}-yearTo`] &&
                scope.yearFrom !== '' &&
                scope.yearFrom != null &&
                scope.yearTo !== '' &&
                scope.yearTo != null &&
                Number(scope.yearFrom) > Number(scope.yearTo))
                errors[`${key}-yearTo`] = '起始年度不能晚于截止年度';
        });
    }
    if (!value.reason.trim() || value.reason.trim().length > 500)
        errors.reason = '请填写 1 至 500 字的变更原因';
    if (!confirmed)
        errors.confirmation = '请核对并确认完整替换后的权限范围';
    return errors;
}

function financePolicyScopes(value) {
    return value.permissions.length
        ? value.scopes.map((scope) => ({
            scopeType: scope.scopeType,
            ...(scope.orgId ? { orgId: scope.orgId } : {}),
            ...(scope.departmentId ? { departmentId: scope.departmentId } : {}),
            ...(scope.yearFrom !== '' && scope.yearFrom != null
                ? { yearFrom: Number(scope.yearFrom) }
                : {}),
            ...(scope.yearTo !== '' && scope.yearTo != null ? { yearTo: Number(scope.yearTo) } : {}),
        }))
        : [];
}

function financePolicyScopeSummary(value, orgs, departments) {
    if (!value.permissions.length)
        return '收回全部功能，不保留数据范围';
    return (value.scopes
        .map((scope, index) => `${index + 1}. ${{ SELF: '仅本人', GLOBAL: '全组织', ORG: '指定主体', DEPARTMENT: '指定部门' }[scope.scopeType] || '待选择范围'}${scope.orgId ? ` · 主体：${orgs.find((row) => row.id === scope.orgId)?.name || '待核对'}` : ''}${scope.departmentId ? ` · 部门：${departments.find((row) => row.id === scope.departmentId)?.name || '待核对'}` : ''} · 年度 ${scope.yearFrom ?? ''}—${scope.yearTo ?? ''}（空端不限）`)
        .join('；') || '待添加数据范围');
}

function financePolicyRequest(value, people, roles, orgs, departments) {
  const errors = financePolicyErrors(value, people, roles, orgs, departments)
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0])
  const common = { permissions: [...new Set(value.permissions)], scopes: financePolicyScopes(value), reason: value.reason.trim() }
  return value.subjectType === 'USER' ? { path: '/finance/permission-policies/batch', body: { userIds: [...new Set(value.userIds)], ...common } }
    : { path: '/finance/permission-policies', body: { subjectType: 'ROLE', subjectId: value.subjectId, ...common } }
}
function PermissionsView({ ctx }) {
  const action = useFinanceAction()
  const [dialog, setDialog] = useState(null)
  const [tab, setTab] = useFinanceViewState(ctx, 'permissionTab', 'USER')
  const revision = `${ctx.revision}-${action.revision}`
  const manage = ctx.permissions?.includes('finance.permission.manage')
  const me = useFinanceResource('/finance/permissions/me', revision)
  const policies = useFinanceResource(manage ? '/finance/permission-policies' : null, revision)
  const roles = useFinanceResource(manage ? '/finance/access-roles' : null, revision)
  const directory = useFinanceResource(manage ? '/finance/permissions/organization-directory' : null, revision)
  const people = financePolicyPeople(directory.data), roleRows = financeRows(roles.data), policyRows = financeRows(policies.data)
  const name = (type, id) => type === 'USER' ? people.find(row => row.userId === id)?.name || id : roleRows.find(row => row.id === id)?.name || FINANCE_POLICY_ROLE_NAMES[id] || id
  const ready = manage && [policies, roles, directory].every(resource => !resource.loading && !resource.error && resource.data != null)
  const edit = policy => setDialog({ kind: 'policy', policy })
  return h('div', { className: 'sf-stack' },
    h(Card, { title: '我的权限可用范围' }, h(FinanceResource, { resource: me }, h(Table, { tableId: 'finance-my-permissions', rows: (me.data?.permissions || []).map(permission => ({ permission, scopes: me.data?.scopes?.find(row => row.permission === permission)?.scopes || [] })), empty: '暂无权限', columns: [
      { key: 'permission', label: '功能', render: row => FINANCE_PERMISSION_NAMES[row.permission] || row.permission },
      { key: 'scopes', label: '数据范围', render: row => financeScopeDescription(row.scopes, ctx.orgs, ctx.departments) },
    ] }))),
    manage ? h(Card, { title: '功能与数据权限', actions: [h(GhostButton, { key: 'edit', disabled: !ready || action.busy, onClick: () => edit() }, '配置完整权限')] },
      h('p', { className: 'sf-note' }, '成员有独立配置时仅使用成员权限；未配置时继承岗位角色。部门仅辅助选人，不会自动授权未来加入的成员。'),
      h(Notice, null, action.notice),
      ...[policies, roles, directory].map((resource, i) => h(FinanceResource, { key: i, resource })),
      h(PillTabs, { value: tab, onChange: setTab, t: value => value, tabs: [['USER', '成员独立配置'], ['ROLE', '岗位角色配置']] }),
      h(Table, { tableId: 'finance-complete-policies-' + tab, rows: tab === 'USER' ? policyRows.filter(row => row.subjectType === 'USER') : roleRows.map(role => ({ subjectType: 'ROLE', subjectId: role.id, role, ...policyRows.find(row => row.subjectType === 'ROLE' && row.subjectId === role.id) })), empty: '暂无成员独立配置，成员继承岗位角色', columns: [
        { key: 'subjectId', label: tab === 'USER' ? '成员' : '岗位角色', render: row => name(row.subjectType, row.subjectId) },
        { key: 'permissions', label: '功能', render: row => row.permissions ? row.permissions.length ? row.permissions.map(code => FINANCE_PERMISSION_NAMES[code] || code).join('、') : '全部关闭' : '使用内置角色默认模板' },
        { key: 'scopes', label: '数据范围', render: row => row.scopes ? financeScopeDescription(row.scopes, ctx.orgs, ctx.departments) : '默认范围' },
        { key: 'actions', label: '操作', sortable: false, render: row => h('div', { className: 'sf-row' }, h(GhostButton, { disabled: !ready || action.busy || row.role?.enabled === false, onClick: () => edit(row) }, '配置'),
          row.id && (row.subjectType === 'USER' || row.role?.builtIn) ? h(GhostButton, { disabled: !ready || action.busy, onClick: () => setDialog({ kind: 'restore', policy: row }) }, row.subjectType === 'USER' ? '恢复继承岗位' : '恢复内置模板') : null) },
      ] }),
      ctx.role === 'FINANCE_OWNER' ? h(GhostButton, { onClick: () => ctx.onNavigate('identity', { directorySection: 'members' }) }, '前往成员与角色管理岗位') : null) : null,
    manage ? h(FinancePermissionHistory, { ctx, directory: directory.data }) : null,
    dialog?.kind === 'policy' ? h(FinancePolicyDialog, { key: dialog.policy?.id || dialog.policy?.subjectId || 'new', policy: dialog.policy, initialTab: tab, people, roles: roleRows.map(role => ({ ...role, policy: policyRows.find(policy => policy.subjectType === 'ROLE' && policy.subjectId === role.id) })), directory: directory.data, directoryBlocked: !ready, onDirectoryRefresh: () => { directory.retry(); roles.retry(); policies.retry() }, orgs: ctx.orgs, departments: ctx.departments, onClose: () => setDialog(null), onSave: async request => { await action.run(request.path, request.body, 'PUT'); setDialog(null) } }) : null,
    dialog?.kind === 'restore' ? h(FinanceFormDialog, { title: dialog.policy.subjectType === 'USER' ? '恢复继承岗位' : '恢复内置模板', onClose: () => setDialog(null), fields: [{ key: 'reason', label: '恢复原因', required: true, maxLength: 500, type: 'textarea' }], onSubmit: async body => { await action.run(`/finance/permission-policies/${dialog.policy.id}/remove`, body); setDialog(null) } }) : null)
}
function FinancePolicyDialog({ policy, initialTab, people, roles, directory, directoryBlocked = false, onDirectoryRefresh, orgs, departments, onClose, onSave }) {
  const empty = { subjectType: initialTab || 'USER', subjectId: '', userIds: [], permissions: [], scopes: [{scopeType:'SELF'}], reason: '' }
  const roleDraft = id => {
    const current = roles.find(role => role.id === id)?.policy
    return {...empty, subjectType:'ROLE', subjectId:id, permissions:[...(current?.permissions || FINANCE_ROLE_PERMISSION_BASELINE[id] || [])], scopes:(current?.scopes || [{scopeType:['DEPT_FILLER','DEPT_LEADER','DEPT_COLLABORATOR'].includes(id) ? 'SELF' : 'GLOBAL'}]).map(scope=>({...scope})), reason:''}
  }
  const [value, setValue] = useState(() => policy ? {...(policy.subjectType === 'ROLE' ? roleDraft(policy.subjectId) : empty),...policy,userIds:policy.subjectType === 'USER' ? [policy.subjectId] : [],reason:''} : empty)
  const [confirmation,setConfirmation] = useState(''), [error,setError] = useState(''), [busy,setBusy] = useState(false), [attempted,setAttempted] = useState(false), [search,setSearch] = useState('')
  const lock=useRef(false), formRef=useRef(null), initial=useRef(value), prefix=useId(), exit=useFinanceFormExit(initial.current,value,busy,onClose)
  const close=()=>{if(!lock.current)exit.close()}
  const fingerprint=JSON.stringify([value.subjectType,value.subjectId,value.userIds,value.permissions,value.scopes])
  const errors=financePolicyErrors(value,people,roles,orgs,departments,confirmation===fingerprint)
  const attrs=key=>({'aria-invalid':attempted&&errors[key]?true:undefined,'aria-describedby':attempted&&errors[key]?`${prefix}-${key}-error`:undefined})
  const message=key=>attempted&&errors[key]?h('p',{id:`${prefix}-${key}-error`,className:'sf-neg sf-field-error'},errors[key]):null
  const update=patch=>{setValue(current=>({...current,...patch}));setError('')}
  const load=next=>{exit.reset(next);setValue(next);setConfirmation('');setAttempted(false);setError('');setSearch('')}
  const switchTo=next=>{if(!lock.current)exit.leave(()=>load(next))}
  const changeScope=(index,patch)=>update({scopes:value.scopes.map((scope,i)=>i===index?{...scope,...patch}:scope)})
  const save=async event=>{
    event.preventDefault();if(lock.current || directoryBlocked)return
    setAttempted(true);setError('')
    if(Object.keys(errors).length){financeFocusFormError(formRef.current);return}
    lock.current=true;setBusy(true)
    try{const result=await onSave(financePolicyRequest(value,people,roles,orgs,departments));if(result===false)setError('保存失败，填写内容已保留，请核对后重试')}
    catch(cause){setError(cause.message||'保存失败，填写内容已保留，请核对后重试')}
    finally{lock.current=false;setBusy(false)}
  }
  const fields=(items,values,change)=>financeFormFields(items,values,change,attempted?errors:{},busy,prefix)
  const memberOptions=people.map(person=>[person.userId,`${person.name||person.userId} · ${(person.departmentIds||[]).map(id=>directory?.departments?.find(d=>d.id===id)?.name).filter(Boolean).join('、')||'未分配部门'}`])
  const groups=FINANCE_PERMISSION_GROUPS.map(group=>({...group,permissions:group.permissions.filter(code=>`${FINANCE_PERMISSION_NAMES[code]} ${code}`.toLowerCase().includes(search.trim().toLowerCase()))})).filter(group=>group.permissions.length)
  return h(Dialog,{title:'配置完整权限',width:'lg',onClose:close,dismissDisabled:busy},h('form',{ref:formRef,noValidate:true,onSubmit:save,className:'sf-stack'},
    h('p',{className:'sf-note'},'选择成员或角色，设置可用功能及可访问数据。保存完整替换原配置，未选功能将被收回。成员独立配置不会与角色权限叠加。'),
    h(FinanceOrganizationNotice,{directory,onRefresh:busy?undefined:onDirectoryRefresh}),
    h('fieldset',{disabled:busy,className:'sf-fieldset sf-stack'},
      h('legend',null,'1. 选择配置对象'),
      h(FormRow,{label:'配置对象'},h(Select,{'aria-label':'配置对象',value:value.subjectType,options:[['USER','成员'],['ROLE','岗位角色']],onChange:subjectType=>{if(subjectType!==value.subjectType)switchTo({...empty,subjectType})}})),
      value.subjectType==='USER'?h('div',{className:'sf-stack'},
        ...fields([{key:'subject',label:'选择成员',required:true,multi:true,searchable:true,options:memberOptions}],{subject:value.userIds},(_,userIds)=>update({userIds})),
        h(FormRow,{label:'按部门追加当前成员（含下级）'},h(SearchSelect,{buttonTrigger:true,value:'',options:(directory?.departments||[]).map(row=>[row.id,row.name]),placeholder:'选择部门追加成员',onChange:id=>update({userIds:[...new Set([...value.userIds,...financePolicyDepartmentPeople(directory,[id])])]})})),
        h('p',{className:'sf-note'},'选择部门仅追加当前可用成员，未来加入部门的人不会自动获得此次配置。成员无需先登录。'))
        :h(FormRow,{label:'岗位角色（必填）'},h(SearchSelect,{buttonTrigger:true,'aria-label':'岗位角色',...attrs('subject'),value:value.subjectId,options:roles.filter(role=>role.enabled).map(role=>[role.id,role.name]),placeholder:'选择岗位角色',onChange:id=>{if(id!==value.subjectId)switchTo(roleDraft(id))}}),message('subject')),
      h('h3',null,`2. 选择功能 · 已选 ${value.permissions.length} 项`),
      h(FormRow,{label:'搜索功能权限'},h(Field,{'aria-label':'搜索功能权限',value:search,onChange:setSearch,placeholder:'搜索功能名称或权限码'})),
      h(FormRow,{label:'填入角色默认功能'},h(Select,{'aria-label':'填入角色默认功能',value:'',options:[['','选择模板'],...Object.entries(FINANCE_POLICY_ROLE_NAMES)],onChange:id=>update({permissions:[...(FINANCE_ROLE_PERMISSION_BASELINE[id]||[])]})})),
      h('div',{tabIndex:-1,'aria-label':'完整功能清单',...attrs('permissions'),className:'sf-stack'},
        ...groups.map(group=>h('div',{key:group.domain,className:'sf-stack'},
          h('label',null,h('input',{type:'checkbox','aria-label':group.domain,'aria-checked':group.permissions.every(code=>value.permissions.includes(code))?true:group.permissions.some(code=>value.permissions.includes(code))?'mixed':false,ref:node=>{if(node)node.indeterminate=group.permissions.some(code=>value.permissions.includes(code))&&!group.permissions.every(code=>value.permissions.includes(code))},checked:group.permissions.every(code=>value.permissions.includes(code)),onChange:event=>update({permissions:event.target.checked?[...new Set([...value.permissions,...group.permissions])]:value.permissions.filter(code=>!group.permissions.includes(code))})}),group.domain),
          ...group.permissions.map(code=>h('label',{key:code},h('input',{type:'checkbox','aria-label':FINANCE_PERMISSION_NAMES[code],checked:value.permissions.includes(code),onChange:event=>update({permissions:event.target.checked?[...new Set([...value.permissions,code])]:value.permissions.filter(item=>item!==code)})}),FINANCE_PERMISSION_NAMES[code],FINANCE_HIGH_RISK_PERMISSIONS.includes(code)?'（高风险）':'')))),
        !groups.length?h('p',null,'没有匹配的功能'):null,message('permissions')),
      h('h3',null,'3. 数据范围（多个范围取并集）'),
      ...(!value.permissions.length?[h('p',{role:'status'},'全部功能关闭；保存时不保留数据范围。')]:[
        ...value.scopes.map((scope,index)=>h('div',{key:index,className:'sf-inline-form sf-stack'},
          ...fields([{key:`scope-${index}-scopeType`,label:`数据范围 ${index+1}`,required:true,options:[['SELF','仅本人'],['DEPARTMENT','指定部门'],['ORG','指定主体'],['GLOBAL','全组织']]},{key:`scope-${index}-orgId`,label:`主体 ${index+1}`,required:scope.scopeType==='ORG',searchable:true,options:orgs.map(row=>[row.id,row.name])},{key:`scope-${index}-departmentId`,label:`部门 ${index+1}`,required:scope.scopeType==='DEPARTMENT',searchable:true,options:departments.map(row=>[row.id,row.name])},...['yearFrom','yearTo'].map(key=>({key:`scope-${index}-${key}`,label:`${key==='yearFrom'?'起始年度':'截止年度'} ${index+1}`,type:'number',step:'1'}))],Object.fromEntries(['scopeType','orgId','departmentId','yearFrom','yearTo'].map(key=>[`scope-${index}-${key}`,scope[key]??''])),(key,next)=>changeScope(index,{[key.replace(`scope-${index}-`,'')]:next})),
          h(GhostButton,{'aria-label':`移除数据范围 ${index+1}`,onClick:()=>update({scopes:value.scopes.filter((_,i)=>i!==index)})},'移除此范围'))),
        h(GhostButton,{...attrs('scopes'),disabled:value.scopes.length>=100,onClick:()=>update({scopes:[...value.scopes,{scopeType:'SELF'}]})},'添加数据范围'),message('scopes')]),
      h('p',{className:'sf-note'},'同一范围的主体、部门及年度共同限制数据；不同范围取并集。年度留空表示不限制该端年度。'),
      ...fields([{key:'reason',label:'变更原因',required:true,maxLength:500,type:'textarea'}],{reason:value.reason},(_,reason)=>update({reason})),
      h('p',{'aria-label':'保存摘要',className:'sf-note'},`${value.subjectType==='USER'?`完整替换 ${value.userIds.length} 名成员：${value.userIds.map(id=>people.find(person=>person.userId===id)?.name||id).join('、')||'待选择'}`:`完整替换角色：${roles.find(role=>role.id===value.subjectId)?.name||'待选择'}`}；仅保留 ${value.permissions.length} 项功能。${financePolicyScopeSummary(value,orgs,departments)}`),
      h('label',null,h('input',{'aria-label':'确认完整替换',type:'checkbox',...attrs('confirmation'),checked:confirmation===fingerprint,onChange:event=>setConfirmation(event.target.checked?fingerprint:'')}),'我已核对对象、完整功能及数据范围，并确认完整替换'),message('confirmation')),
    attempted&&Object.keys(errors).length?h('p',{role:'alert',className:'sf-neg'},'请检查输入，已定位到首个错误。'):null,
    directoryBlocked?h('p',{role:'status'},'所需目录尚未就绪，请刷新目录后重试。',h(GhostButton,{disabled:busy,onClick:onDirectoryRefresh},'刷新目录')):null,
    error?h('p',{role:'alert',className:'sf-neg'},error):null,exit.prompt,
    h('div',{className:'sf-row'},h(GhostButton,{disabled:busy,onClick:close},'取消'),h(PrimaryButton,{type:'submit',busy,disabled:directoryBlocked},busy?'保存中…':'保存完整配置'))))
}

function FinanceRoleManager({ roles, ready, action }) {
  const [dialog, setDialog] = useState(null)
  const run = async body => {
    const kind = dialog.kind, role = dialog.role
    body.reason = String(body.reason || '').trim()
    if (!body.reason || body.reason.length > 500) throw new Error('请填写 1 至 500 字的变更原因')
    if (kind !== 'remove') {
      body.name = String(body.name || '').trim()
      body.description = String(body.description || '').trim()
      if (!body.name || body.name.length > 100 || body.description.length > 500) throw new Error('请填写 1 至 100 字的岗位名称，说明不超过 500 字')
    }
    if (kind === 'create' && !Object.hasOwn(FINANCE_POLICY_ROLE_NAMES, body.baseRole)) throw new Error('请选择基础岗位模板')
    if (kind === 'remove') await action.run(`/finance/access-roles/${role.id}/remove`, body)
    else await action.run(kind === 'create' ? '/finance/access-roles' : `/finance/access-roles/${role.id}`, { ...body, ...(kind === 'edit' ? { enabled: body.enabled === 'true' } : {}) }, kind === 'edit' ? 'PUT' : 'POST')
    setDialog(null)
  }
  return h('section', { className: 'sf-stack' }, h('h3', null, '岗位角色'), h('p', { className: 'sf-note' }, '分配岗位会保留成员独立权限。若希望成员改为继承岗位，请在成员配置中选择“恢复继承岗位”。'),
    h('div', { className: 'sf-row' }, h(GhostButton, { disabled: !ready || action.busy, onClick: () => setDialog({ kind: 'create' }) }, '新增岗位角色')),
    h(Table, { tableId: 'finance-access-roles', rows: roles, columns: [{ key: 'name', label: '岗位名称' }, { key: 'baseRole', label: '基础岗位', render: row => FINANCE_POLICY_ROLE_NAMES[row.baseRole] || row.baseRole }, { key: 'enabled', label: '状态', render: row => row.enabled ? '启用' : '停用' }, { key: 'memberCount', label: '成员数' }, { key: 'actions', label: '维护', render: role => role.builtIn ? '内置岗位' : h('div', { className: 'sf-row' }, h(GhostButton, { disabled: !ready || action.busy, onClick: () => setDialog({ kind: 'edit', role }) }, '修改岗位'), h(GhostButton, { disabled: !ready || action.busy || role.memberCount > 0, onClick: () => setDialog({ kind: 'remove', role }) }, '删除无成员岗位')) }] }),
    dialog ? h(FinanceFormDialog, { title: { create: '新增岗位角色', edit: '修改岗位角色', remove: '删除无成员岗位' }[dialog.kind], description: dialog.kind === 'remove' ? `即将删除岗位“${dialog.role.name}”，请核对岗位并填写变更原因。` : undefined, initial: dialog.role ? { name: dialog.role.name, description: dialog.role.description || '', enabled: String(dialog.role.enabled) } : {}, onClose: () => setDialog(null), fields: [
      ...(dialog.kind === 'remove' ? [] : [{ key: 'name', label: '岗位名称', required: true, maxLength: 100 }, { key: 'description', label: '岗位说明', type: 'textarea', maxLength: 500 }, ...(dialog.kind === 'create' ? [{ key: 'baseRole', label: '基础岗位模板', searchable: true, options: Object.entries(FINANCE_POLICY_ROLE_NAMES), required: true }] : [{ key: 'enabled', label: '状态', options: [['true', '启用'], ['false', '停用']], required: true }])]),
      { key: 'reason', label: '变更原因', required: true, type: 'textarea', maxLength: 500 },
    ], onSubmit: run }) : null)
}

function financeScopeDescription(scopes, orgs = [], departments = []) {
  return (scopes || []).map(scope => {
    const target = scope.scopeType === 'ORG' ? `指定主体：${orgs.find(row => row.id === scope.orgId)?.name || scope.orgId || '待核对'}`
      : scope.scopeType === 'DEPARTMENT' ? `指定部门：${departments.find(row => row.id === scope.departmentId)?.name || scope.departmentId || '待核对'}`
      : scope.scopeType === 'SELF' ? '本人数据' : scope.scopeType === 'GLOBAL' ? '全域数据' : '范围待核对'
    return `${target}${scope.yearFrom != null || scope.yearTo != null ? ` · ${scope.yearFrom ?? '不限'}—${scope.yearTo ?? '不限'}年` : ''}`
  }).join('；') || '未配置数据范围'
}
function financeHistoricalGrantStatus(grant, now = Date.now()) {
  return grant.revokedAt ? '已撤销' : grant.expiresAt && Date.parse(grant.expiresAt) <= now ? '已过期'
    : grant.startsAt && Date.parse(grant.startsAt) > now ? '待生效' : '未撤销且在有效期内'
}
function FinancePermissionHistory({ ctx, directory }) {
  const [page, setPage] = useFinanceViewState(ctx, 'permissionHistoryPage', 1), [userId, setUserId] = useFinanceViewState(ctx, 'permissionHistoryUser', ''), [permission, setPermission] = useFinanceViewState(ctx, 'permissionHistoryCode', '')
  const [activeOnly, setActiveOnly] = useFinanceViewState(ctx, 'permissionHistoryActive', false), [selected, setSelected] = useState(null)
  const action = useFinanceAction()
  const query = new URLSearchParams({ page: String(page), limit: '20', activeOnly: String(activeOnly) })
  if (userId) query.set('userId', userId)
  if (permission) query.set('permission', permission)
  const resource = useFinanceResource(`/finance/permissions?${query}`, `${ctx.revision}-${action.revision}`)
  const name = grant => directory?.members?.find(row => row.userId === grant.userId)?.name || grant.userName || `目录外成员（${grant.userId}）`
  return h(Card, { title: '历史补充授权台账（审计）' },
    h('p', { className: 'sf-note' }, '仅用于历史查阅与撤销标记，不参与当前有效权限计算。当前可用范围以“我的权限可用范围”和完整权限策略为准；有效期内不代表当前可用。'),
    h('div', { className: 'sf-row' },
      h(SearchSelect, { value: userId, options: (directory?.members || []).filter(row => row.userId).map(row => [row.userId, row.name]), placeholder: '全部历史成员', onChange: value => { setUserId(value); setPage(1) } }),
      h(SearchSelect, { value: permission, options: Object.entries(FINANCE_PERMISSION_NAMES), placeholder: '全部历史功能', onChange: value => { setPermission(value); setPage(1) } }),
      h('label', null, h('input', { type: 'checkbox', checked: activeOnly, onChange: event => { setActiveOnly(event.target.checked); setPage(1) } }), '仅未撤销且在有效期内')),
    h(Notice, null, action.notice),
    h(FinanceResource, { resource }, h(Table, { tableId: 'finance-historical-permission-ledger', rows: financeRows(resource.data), empty: '当前筛选无历史授权记录', columns: [
      { key: 'userName', label: '成员', render: name }, { key: 'permission', label: '历史功能', render: row => FINANCE_PERMISSION_NAMES[row.permission] || row.permission },
      { key: 'scope', label: '历史数据范围', render: row => financeScopeDescription([row], ctx.orgs, ctx.departments) },
      { key: 'status', label: '历史记录状态', render: row => financeHistoricalGrantStatus(row) },
      { key: 'validity', label: '有效期', render: row => `${row.startsAt ? new Date(row.startsAt).toLocaleString('zh-CN', { hour12: false }) : '立即开始'} 至 ${row.expiresAt ? new Date(row.expiresAt).toLocaleString('zh-CN', { hour12: false }) : '长期'}` },
      ...financeColumns([['grantedByName', '授权人'], ['grantReason', '原授权原因'], ['revokeReason', '撤销原因'], ['revokedAt', '撤销时间']]),
      { key: 'actions', label: '审计操作', sortable: false, render: row => !row.revokedAt ? h(GhostButton, { disabled: action.busy, onClick: () => setSelected(row) }, '标记撤销') : '已留痕' },
    ] }), h(Pager, { page, total: resource.data?.total, limit: 20, onPage: setPage })),
    selected ? h(FinanceFormDialog, { title: '标记撤销历史补充授权', description: `${name(selected)} · ${FINANCE_PERMISSION_NAMES[selected.permission] || selected.permission} · ${financeScopeDescription([selected], ctx.orgs, ctx.departments)}。只标记此条历史记录，当前完整权限策略不变。`, fields: [{ key: 'reason', label: '撤销原因', required: true, maxLength: 500, type: 'textarea' }], onClose: () => setSelected(null), onSubmit: async body => { const reason = String(body.reason || '').trim(); if (!reason) throw new Error('请填写撤销原因'); await action.run(`/finance/permissions/${selected.id}/revoke`, { reason }); setSelected(null) } }) : null)
}
