import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, realpath, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { callHubCatalog, downloadHubArchive, HUB_API_BASE } from './hub-client.js'
import { unpackSkillArchive, fileManifestDigest, jcs, sha256 } from './skill-archive.js'
import { HubInstallStore, readJson, safePath, statOptional, syncDirectory, treeState } from './hub-install-store.js'
import { NAME, UUID, requireValue, trustedKeys, planDigest, verifyPlan, verifyRelease } from './hub-release-verifier.js'
const PREFIX = '/skillhub/v1'
const messages = {
  HUB_LOCAL_CONFLICT:'同名技能来自内置、本机、旧共享或其他企业，不能覆盖。',
  HUB_LOCAL_MODIFIED:'本机技能已被修改，已保留内容。请备份处理后重新确认。',
  HUB_INCOMPATIBLE_HOST:'当前桌面版本不满足作者兼容声明，或无法验证宿主版本。',
  HUB_UNTRUSTED_KEY:'此发布的签名密钥不在本机可信列表中，无法安装。',
  HUB_INTENT_EXPIRED:'安装确认已过期，请重新查看计划。',
  HUB_STATE_CHANGED:'本机内容、账号或工作空间已变化，请重新查看计划。',
  HUB_NEEDS_ATTENTION:'上次操作需要人工核对，已保留技能和恢复材料。',
}
export function safeHubError(error) { return {code:error?.code || 'HUB_INSTALL_FAILED',error:messages[error?.code] || '企业技能操作未完成，请刷新计划后重试。'} }
function ownIdentity(value) { return {origin:value.origin,operator:value.operator,tenantId:value.tenantId,teamId:value.teamId,actorRef:value.actorRef,deviceId:value.deviceId} }
function sameOwner(a,b) { return a?.origin === b.origin && a.operator === b.operator && a.tenantId === b.tenantId && a.teamId === b.teamId && a.actorRef === b.actorRef }
function bodyOnly(value,keys) { requireValue(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)),'HUB_INVALID_REQUEST') }
function bodyText(markdown) { return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u,'').trim() }
export class HubSkillInstaller {
  constructor(ctx,hub,options = {}) {
    this.ctx = ctx; this.hub = hub; this.options = options; this.store = new HubInstallStore(options)
    this.intents = new Map(); this.active = new Set(); this.trust = options.trust || trustedKeys
    this.hostVersion = () => {
      if (options.hostVersion) return options.hostVersion
      try { return ctx.desktopRuntime?.updates?.currentVersion } catch { return undefined }
    }
  }
  async initialize() {
    this.ready ??= this.store.initialize().then(async () => { await this.recover(); return this.store }).catch(error => { this.ready = undefined; throw error })
    return this.ready
  }
  async current() {
    const context = await this.hub.context()
    requireValue(typeof context.snapshot.session.operator === 'string' && context.snapshot.session.operator.length > 0,'HUB_SSO_REQUIRED')
    const identity = {origin:HUB_API_BASE,operator:context.snapshot.session.operator,tenantId:context.me.tenantId,teamId:context.me.workspace.ssoTeam.id}
    const device = await this.store.device(identity,() => this.call(context,'/devices/bind',{hostDescriptor:{kind:'sensteed',hostScopeId:this.store.scope.hostScopeId}}))
    this.hub.assertCurrent(context.snapshot)
    return {...context,identity:{...identity,actorRef:device.ownerRef,deviceId:device.deviceId}}
  }
  async call(context,path,body) {
    this.hub.assertCurrent(context.snapshot)
    let result
    try { result = await callHubCatalog(this.ctx,`${PREFIX}${path}`,{...context.options,signal:AbortSignal.timeout(15_000),...(body === undefined ? {} : {method:'POST',body})}) }
    catch (error) {
      if (error.code === 'HUB_ACCESS_DENIED' && context.identity && path === '/skills/install-plans') await this.store.invalidateDevice(context.identity)
      throw error
    }
    this.hub.assertCurrent(context.snapshot)
    return result
  }
  async receipts() {
    const names = await readdir(join(this.store.directory,'receipts'))
    requireValue(names.length <= 2000,'HUB_STATE_LIMIT')
    const result = []
    for (const file of names) {
      if (!file.endsWith('.json') || !NAME.test(file.slice(0,-5))) continue
      const receipt = await this.store.receipt(file.slice(0,-5))
      requireValue(receipt?.schemaVersion === 1 && receipt.source === 'hub' && receipt.installName === file.slice(0,-5),'HUB_STATE_CORRUPT')
      result.push(receipt)
    }
    return result
  }
  async verifyReceipt(receipt) {
    requireValue(receipt?.schemaVersion === 1 && receipt.source === 'hub' && UUID.test(receipt.operationId),'HUB_LOCAL_MODIFIED')
    const trust=this.trust(),manifest=verifyRelease(receipt.signed,{...trust,revokedKeyIds:[]})
    requireValue(receipt.identity?.origin === HUB_API_BASE && receipt.identity.tenantId === manifest.tenantId
      && receipt.skillId === manifest.skillId && receipt.releaseId === manifest.releaseId && receipt.version === manifest.version
      && receipt.installName === manifest.installName && receipt.artifactDigest === manifest.artifact.sha256 && receipt.fileManifestDigest === manifest.fileManifestDigest,'HUB_LOCAL_MODIFIED')
    const operation=await readJson(this.store.operationPath(receipt.operationId))
    requireValue(operation?.nextReceipt && jcs(operation.nextReceipt) === jcs(receipt),'HUB_LOCAL_MODIFIED')
  }
  async localState(name,identity,action) {
    await safePath(this.store.root)
    const receipt = await this.store.receipt(name), state = await treeState(this.store.target(name))
    // Independently inspect packaged roots: the winning registry entry alone can hide a bundled collision.
    const bundledRoots = this.options.bundledRoots ?? (process.env.DSH_BUNDLED_SKILL_DIR ? [process.env.DSH_BUNDLED_SKILL_DIR] : undefined)
    requireValue(Array.isArray(bundledRoots),'HUB_INCOMPATIBLE_HOST')
    for (const root of bundledRoots) {
      // Packaged roots may be inside Electron's read-only app.asar virtual tree.
      const rootInfo=await lstat(root)
      requireValue(rootInfo.isDirectory() && !rootInfo.isSymbolicLink() && resolve(await realpath(root)) === resolve(root),'HUB_UNSAFE_LOCAL_PATH')
      const entries = await readdir(root)
      requireValue(!entries.some(entry => entry.normalize('NFC').toLowerCase().replace(/\.md$/u,'') === name),'HUB_LOCAL_CONFLICT')
    }
    const entries = await readdir(this.store.root)
    requireValue(!entries.some(entry => entry !== name && entry.normalize('NFC').toLowerCase().replace(/\.md$/u,'') === name),'HUB_LOCAL_CONFLICT')
    const snapshot = await this.ctx.skills.snapshot({})
    requireValue(snapshot.complete === true,'HUB_DISCOVERY_INCOMPLETE')
    const winners = snapshot.skills.filter(skill => skill.name === name)
    requireValue(winners.every(skill => skill.source !== 'bundled' && skill.path && resolve(skill.path) === join(this.store.target(name),'SKILL.md')),'HUB_LOCAL_CONFLICT')
    if (action === 'install') requireValue(!state.exists && !receipt && winners.length === 0,'HUB_LOCAL_CONFLICT')
    else {
      if (receipt) await this.verifyReceipt(receipt)
      requireValue(receipt?.schemaVersion === 1 && receipt.source === 'hub' && receipt.installName === name && sameOwner(receipt.identity,identity),'HUB_LOCAL_CONFLICT')
      requireValue(state.exists && state.digest === receipt.fileManifestDigest && state.treeDigest === receipt.treeDigest,'HUB_LOCAL_MODIFIED')
    }
    const digest = sha256(jcs({exists:state.exists,treeDigest:state.treeDigest,receipt:receipt || null}))
    return {state,receipt,digest}
  }
  async preview(body) {
    bodyOnly(body,['action','skillId','releaseId'])
    requireValue(['install','update','uninstall'].includes(body.action) && UUID.test(body.skillId) && (body.releaseId === undefined || UUID.test(body.releaseId)),'HUB_INVALID_REQUEST')
    await this.initialize()
    const context = await this.current(), identity = context.identity
    let signed, releaseId = body.releaseId, previous
    if (body.action === 'uninstall') {
      previous = (await this.receipts()).find(value => value.skillId === body.skillId && sameOwner(value.identity,identity))
      requireValue(previous,'HUB_LOCAL_CONFLICT'); signed = previous.signed; releaseId = previous.releaseId
    } else {
      if (!releaseId) {
        const detail = await this.call(context,`/skills/${body.skillId}`)
        releaseId = detail.channels?.find(channel => channel.name === 'stable')?.releaseId
      }
      requireValue(UUID.test(releaseId),'HUB_NOT_PUBLISHED')
      signed = await this.call(context,`/skills/releases/${releaseId}/manifest`)
    }
    const version = this.hostVersion()
    if (body.action !== 'uninstall') requireValue(typeof version === 'string','HUB_INCOMPATIBLE_HOST')
    const trust = this.trust()
    const manifest = verifyRelease(signed,body.action === 'uninstall' ? {...trust,revokedKeyIds:[]} : trust,body.action === 'uninstall' ? undefined : version)
    requireValue(manifest.tenantId === identity.tenantId && manifest.skillId === body.skillId && manifest.releaseId === releaseId,'HUB_PLAN_MISMATCH')
    const local = await this.localState(manifest.installName,identity,body.action)
    if (body.action === 'update') requireValue(local.receipt.skillId === body.skillId && local.receipt.releaseId !== releaseId,'HUB_LOCAL_CONFLICT')
    const expected = {tenantId:identity.tenantId,actorRef:identity.actorRef,deviceId:identity.deviceId,action:body.action,skillId:manifest.skillId,
      releaseId:manifest.releaseId,version:manifest.version,installName:manifest.installName,artifactDigest:manifest.artifact.sha256,
      target:{kind:'skill-shared',hostScopeId:this.store.scope.hostScopeId},observedStateDigest:local.digest}
    const plan = verifyPlan(await this.call(context,'/skills/install-plans',{action:body.action,releaseId,deviceId:identity.deviceId,target:expected.target,observedStateDigest:local.digest}),expected)
    const intentId = randomUUID(), expiresAt = Math.min(Date.parse(plan.expiresAt),Date.now()+3*60_000)
    for (const [key,value] of this.intents) if (value.expiresAt <= Date.now()) this.intents.delete(key)
    requireValue(this.intents.size < 30,'HUB_STATE_LIMIT')
    this.intents.set(intentId,{context,identity,plan,signed,expiresAt,expected,localDigest:local.digest})
    return {intentId,action:plan.action,skillId:plan.skillId,installName:plan.installName,version:plan.version,workspace:context.me.workspace,
      existingVersion:local.receipt?.version || null,accessDeclaration:manifest.accessDeclaration,compatibility:{authorDeclared:manifest.compatibility.sensteed,tested:false},
      sharedScope:true,requiresReload:plan.requiresReload,expiresAt:new Date(expiresAt).toISOString()}
  }
  event(operation,state,seq,errorCode) {
    return {operationId:operation.operationId,seq,planId:operation.plan.planId,deviceId:operation.identity.deviceId,releaseId:operation.plan.releaseId,
      state,installedVersion:state === 'REMOVED' ? null : operation.plan.action === 'uninstall' ? operation.previousReceipt?.version || null : operation.plan.version,
      ...(errorCode ? {errorCode} : {}),occurredAt:new Date().toISOString(),clientVersion:'0.1.0',hostVersion:this.hostVersion() || 'unknown'}
  }
  async phase(operation,phase) { operation.phase = phase; await this.store.save(operation); await this.options.afterPhase?.(phase,operation) }
  async execute(body) {
    bodyOnly(body,['intentId']); requireValue(UUID.test(body.intentId),'HUB_INVALID_REQUEST')
    const intent = this.intents.get(body.intentId)
    requireValue(intent && intent.expiresAt > Date.now(),'HUB_INTENT_EXPIRED')
    this.intents.delete(body.intentId)
    const {context,identity,plan,signed} = intent, manifest = signed.manifest
    this.hub.assertCurrent(context.snapshot)
    let files
    if (plan.action !== 'uninstall') {
      const grant = await this.call(context,`/skills/releases/${plan.releaseId}/download-grants`,{purpose:'install',deviceId:identity.deviceId})
      const archive = await downloadHubArchive(this.ctx,grant,{...context.options,signal:undefined})
      this.hub.assertCurrent(context.snapshot)
      requireValue(archive.length === manifest.artifact.bytes && sha256(archive) === manifest.artifact.sha256,'HUB_ARTIFACT_MISMATCH')
      files = unpackSkillArchive(archive)
      requireValue(fileManifestDigest(files) === manifest.fileManifestDigest,'HUB_FILE_MANIFEST_MISMATCH')
      requireValue(this.options.parseSkill(Buffer.from(files['SKILL.md']).toString('utf8')).name === plan.installName,'HUB_ARTIFACT_MISMATCH')
    }
    return this.store.lock(plan.installName,async () => {
      this.hub.assertCurrent(context.snapshot)
      requireValue(intent.expiresAt > Date.now(),'HUB_INTENT_EXPIRED')
      verifyPlan(plan,intent.expected)
      if (plan.action !== 'uninstall') requireValue(typeof this.hostVersion() === 'string','HUB_INCOMPATIBLE_HOST')
      verifyRelease(signed,plan.action === 'uninstall' ? {...this.trust(),revokedKeyIds:[]} : this.trust(),plan.action === 'uninstall' ? undefined : this.hostVersion())
      const before = await this.localState(plan.installName,identity,plan.action)
      requireValue(before.digest === intent.localDigest,'HUB_STATE_CHANGED')
      const pending = (await this.store.operations()).some(op => op.plan.installName === plan.installName && !['DONE','ABORTED'].includes(op.phase))
      requireValue(!pending,'HUB_NEEDS_ATTENTION')
      const operationId = randomUUID(), stage = join(this.store.directory,'staging',operationId)
      if (files) await this.stage(stage,files)
      const staged = files ? await treeState(stage) : {digest:null,treeDigest:null}
      requireValue(!files || staged.digest === manifest.fileManifestDigest,'HUB_ARTIFACT_MISMATCH')
      const operation = {schemaVersion:1,operationId,identity:ownIdentity(identity),plan,signed,previousReceipt:before.receipt || null,
        beforeTreeDigest:before.state.treeDigest,afterTreeDigest:staged.treeDigest,phase:'PREPARED',events:[],acked:[]}
      operation.commitEvent = this.event(operation,plan.action === 'uninstall' ? 'REMOVED' : 'WRITTEN',0)
      operation.nextReceipt = plan.action === 'uninstall' ? null : {schemaVersion:1,source:'hub',identity:ownIdentity(identity),operationId,skillId:plan.skillId,releaseId:plan.releaseId,
        installName:plan.installName,version:plan.version,artifactDigest:plan.artifactDigest,fileManifestDigest:manifest.fileManifestDigest,treeDigest:staged.treeDigest,signed}
      this.active.add(operationId)
      let consumeStarted = false
      try {
        // Durable reservation precedes authorize/consume; grants and bearer never enter the journal.
        await this.phase(operation,'PREPARED')
        const grant = await this.call(context,`/skills/install-plans/${plan.planId}/authorize`,{deviceId:identity.deviceId,planDigest:plan.planDigest})
        requireValue(UUID.test(grant.executionGrant) && Date.parse(grant.expiresAt) > Date.now(),'HUB_INVALID_RESPONSE')
        this.hub.assertCurrent(context.snapshot)
        requireValue((await this.localState(plan.installName,identity,plan.action)).digest === intent.localDigest,'HUB_STATE_CHANGED')
        await this.phase(operation,'CONSUMING')
        // Phase persistence yields: identity must still match immediately before the request begins.
        this.hub.assertCurrent(context.snapshot)
        consumeStarted = true
        let ack
        try { ack = await callHubCatalog(this.ctx,`${PREFIX}/skills/install-plans/${plan.planId}/consume`,{...context.options,signal:AbortSignal.timeout(15_000),method:'POST',body:{deviceId:identity.deviceId,planDigest:plan.planDigest,executionGrant:grant.executionGrant,operationId}}) }
        catch { await this.phase(operation,'CONSUME_UNKNOWN'); return this.summary(operation) }
        if (ack?.ack !== true || Object.keys(ack).length !== 1) { await this.phase(operation,'CONSUME_UNKNOWN'); return this.summary(operation) }
        await this.phase(operation,'CONSUMED')
        this.hub.assertCurrent(context.snapshot)
        requireValue((await this.localState(plan.installName,identity,plan.action)).digest === intent.localDigest,'HUB_STATE_CHANGED')
        await this.phase(operation,'SWAPPING')
        const destination = this.store.target(plan.installName), backup = join(this.store.directory,'backups',operationId)
        if (before.state.exists) {
          await rename(destination,backup); await syncDirectory(this.store.root); await syncDirectory(dirname(backup))
          requireValue((await treeState(backup)).treeDigest === before.state.treeDigest,'HUB_LOCAL_MODIFIED')
        }
        await this.phase(operation,'BACKED_UP')
        if (files) {
          requireValue(!(await statOptional(destination)),'HUB_LOCAL_CONFLICT')
          requireValue((await treeState(stage)).treeDigest === staged.treeDigest,'HUB_LOCAL_MODIFIED')
          await rename(stage,destination); await syncDirectory(this.store.root); await syncDirectory(dirname(stage))
        }
        await this.phase(operation,'PUBLISHED')
        await this.finishCommit(operation)
        if (files) await this.discover(operation)
        else await this.phase(operation,'DONE')
        await this.store.lock('hub-outbox',() => this.flush(context))
        return this.summary((await this.store.operations()).find(value => value.operationId === operationId))
      } catch (error) {
        if (['PREPARED'].includes(operation.phase)) await this.phase(operation,'ABORTED')
        else if (operation.phase === 'CONSUMING') await this.phase(operation,consumeStarted ? 'CONSUME_UNKNOWN' : 'ABORTED')
        else if (!['DONE','CONSUME_UNKNOWN'].includes(operation.phase)) {
          operation.errorCode = error.code || 'HUB_LOCAL_FAILURE'
          await this.recoverOperation(operation)
        }
        return this.summary(operation)
      } finally { this.active.delete(operationId) }
    })
  }
  async stage(path,files) {
    await mkdir(path,{mode:0o700}); await safePath(path)
    for (const [name,bytes] of Object.entries(files)) {
      const destination = join(path,...name.split('/')); await safePath(dirname(destination),true)
      const file = await open(destination,'wx',0o600)
      try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
      await syncDirectory(dirname(destination))
    }
    await syncDirectory(path); await syncDirectory(dirname(path))
  }
  async finishCommit(operation) {
    const state = await treeState(this.store.target(operation.plan.installName))
    if (operation.beforeTreeDigest) requireValue((await treeState(join(this.store.directory,'backups',operation.operationId))).treeDigest === operation.beforeTreeDigest,'HUB_LOCAL_MODIFIED')
    requireValue(operation.plan.action === 'uninstall' ? !state.exists : state.treeDigest === operation.afterTreeDigest,'HUB_LOCAL_MODIFIED')
    if (operation.nextReceipt) await this.store.saveReceipt(operation.plan.installName,operation.nextReceipt)
    else await this.store.removeReceipt(operation.plan.installName)
    if (!operation.events.some(event => event.seq === 0)) operation.events.push(operation.commitEvent)
    await this.phase(operation,'COMMITTED')
  }
  async discover(operation) {
    const name = operation.plan.installName, path = join(this.store.target(name),'SKILL.md')
    const markdown = await readFile(path,'utf8')
    let discovered = false
    for (let attempt = 0; attempt < (this.options.discoveryAttempts ?? 8); attempt++) {
      const snapshot = await this.ctx.skills.snapshot({})
      const summary = snapshot.skills.find(value => value.name === name)
      if (snapshot.complete === true && summary?.path === path && summary.source === 'user-dsh' && typeof summary.provider === 'string') {
        const value = await this.ctx.skills.get(name)
        if (value?.path === path && value.provider === summary.provider && value.content === bodyText(markdown)
          && (await treeState(this.store.target(name))).treeDigest === operation.afterTreeDigest) { discovered = true; break }
      }
      if (attempt + 1 < (this.options.discoveryAttempts ?? 8)) await new Promise(resolve => setTimeout(resolve,this.options.discoveryDelay ?? 300))
    }
    operation.events.push(this.event(operation,discovered ? 'DISCOVERED' : 'DISCOVERY_FAILED',1,discovered ? undefined : 'HOST_DISCOVERY_PENDING'))
    await this.phase(operation,'DONE')
  }
  async recover() {
    for (const operation of await this.store.operations()) {
      await this.store.lock(operation.plan.installName,async () => {
        const fresh = await readJson(this.store.operationPath(operation.operationId))
        if (!['DONE','ABORTED','CONSUME_UNKNOWN','NEEDS_ATTENTION'].includes(fresh.phase)) await this.recoverOperation(fresh)
      })
    }
  }
  async recoverOperation(operation) {
    const name = operation.plan.installName, destination = this.store.target(name), backup = join(this.store.directory,'backups',operation.operationId)
    if (operation.phase === 'PREPARED') { await this.phase(operation,'ABORTED'); return }
    if (operation.phase === 'CONSUMING') { await this.phase(operation,'CONSUME_UNKNOWN'); return }
    try {
      const trust=this.trust(),manifest=verifyRelease(operation.signed,{...trust,revokedKeyIds:[]})
      requireValue(planDigest(operation.plan) === operation.plan.planDigest && operation.identity.origin === HUB_API_BASE
        && operation.plan.tenantId === manifest.tenantId && operation.plan.tenantId === operation.identity.tenantId
        && operation.plan.actorRef === operation.identity.actorRef && operation.plan.deviceId === operation.identity.deviceId
        && operation.plan.skillId === manifest.skillId && operation.plan.releaseId === manifest.releaseId
        && operation.plan.installName === manifest.installName && operation.plan.artifactDigest === manifest.artifact.sha256,'HUB_STATE_CORRUPT')
      const current = await treeState(destination), old = await treeState(backup)
      const mayPublish = ['BACKED_UP','PUBLISHED','COMMITTED'].includes(operation.phase)
      const committed = mayPublish && (!operation.beforeTreeDigest || old.treeDigest === operation.beforeTreeDigest) && (operation.plan.action === 'uninstall' ? !current.exists && old.exists && old.treeDigest === operation.beforeTreeDigest
        : current.exists && current.treeDigest === operation.afterTreeDigest && current.digest === manifest.fileManifestDigest)
      if (committed) {
        await this.finishCommit(operation)
        if (operation.plan.action !== 'uninstall' && !operation.events.some(event => event.seq === 1)) {
          operation.events.push(this.event(operation,'DISCOVERY_FAILED',1,'HOST_RESTART_DISCOVERY_PENDING'))
        }
        await this.phase(operation,'DONE'); return
      }
      if (!current.exists && old.exists && old.treeDigest === operation.beforeTreeDigest) {
        await rename(backup,destination); await syncDirectory(this.store.root); await syncDirectory(dirname(backup))
      }
    } catch { /* Preserve all evidence when a tree or journal cannot be proved. */ }
    if (!operation.events.length) {
      const event = this.event(operation,'DISCOVERY_FAILED',0,operation.errorCode || 'HOST_COMMIT_NOT_COMPLETED')
      event.installedVersion = operation.previousReceipt?.version || null
      operation.events.push(event)
    }
    await this.phase(operation,'NEEDS_ATTENTION')
  }
  summary(operation) {
    return {operationId:operation.operationId,skillId:operation.plan.skillId,installName:operation.plan.installName,action:operation.plan.action,version:operation.plan.version,
      status:operation.phase,state:operation.events.at(-1)?.state || null,receiptPending:operation.events.some(event => !operation.acked.includes(event.seq)),
      errorCode:operation.errorCode || (operation.phase === 'CONSUME_UNKNOWN' ? 'HUB_CONSUME_UNKNOWN' : null)}
  }
  async flush(context) {
    for (const operation of await this.store.operations()) {
      if (!sameOwner(operation.identity,context.identity) || !['DONE','NEEDS_ATTENTION'].includes(operation.phase) || (operation.retryAt || 0) > Date.now()) continue
      for (const event of operation.events) {
        if (operation.acked.includes(event.seq)) continue
        try {
          // Use original device and payload. A new binding never rewrites a pending receipt.
          const ack = await this.call(context,'/skills/installation-reports',event)
          requireValue(ack?.ack === true && Object.keys(ack).length === 1,'HUB_INVALID_RESPONSE')
          operation.acked.push(event.seq); await this.store.save(operation)
        } catch {
          operation.retryCount = Math.min((operation.retryCount || 0) + 1,8)
          operation.retryAt = Date.now() + Math.min(1000 * 2 ** operation.retryCount,5 * 60_000)
          await this.store.save(operation)
          return
        }
      }
    }
  }
  async status(operationId) {
    requireValue(operationId === undefined || UUID.test(operationId),'HUB_INVALID_REQUEST')
    await this.initialize()
    const context = await this.current()
    // Serialize outbox writers; active execution owns its own journal until it returns.
    await this.store.lock('hub-outbox',async () => { if (!this.active.size) await this.flush(context) })
    const operations = (await this.store.operations()).filter(op => sameOwner(op.identity,context.identity))
    const installed = []
    for (const receipt of (await this.receipts()).filter(value => sameOwner(value.identity,context.identity))) {
      let localModified = false, present = false
      try {
        await this.verifyReceipt(receipt)
        const state=await treeState(this.store.target(receipt.installName));present=state.exists
        localModified=!state.exists || state.digest !== receipt.fileManifestDigest || state.treeDigest !== receipt.treeDigest
      } catch { localModified=true }
      installed.push({skillId:receipt.skillId,releaseId:receipt.releaseId,installName:receipt.installName,version:receipt.version,source:'hub',localModified,present})
    }
    return {operations:operations.filter(op => !operationId || op.operationId === operationId).map(op => this.summary(op)),installed}
  }
}
