/** Desktop L0-owned fixed-origin transport, extracted from the manager Host client. */
import { verifyHubSyncSnapshot, type HubReleaseTrust, type HubSyncExpected, type VerifiedHubSyncSnapshot } from './hub-sync-verifier.ts'
import { HUB_GENERATION_ORIGIN } from './hub-generation-store.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
/** 精确版本（与 Hub 侧 HubVersionSchema 同值域）；模板条目只允许精确版本引用。 */
const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-beta(\.[1-9]\d*)?)?$/u
const MCP_ENDPOINT_PART = /^[a-z][a-z0-9_-]{0,79}$/u
type HubRequestPath = '/skillhub/v1/me' | '/skillhub/v1/devices/bind' | '/skillhub/v1/sync/resolve'
  | '/skillhub/v1/generations/boot-authorization' | '/skillhub/v1/generations/plans' | '/skillhub/v1/generations/installation-reports'
  | `/skillhub/v1/generations/plans/${string}/${'authorize' | 'consume' | 'consume-status' | 'downloads'}`
  | `/skillhub/v1/profile-templates/public?${string}`
  | `/skillhub/v1/profile-templates/${string}/preview`
  | `/skillhub/v1/profile-templates/${string}/instantiate`
/** docs/1022 标准模板（§4 wire 形态）；结构与 Hub 契约一一对应，仅结构校验不带语义。 */
export interface HubProfileTemplateItem {
  readonly kind: 'skill' | 'plugin' | 'mcp.endpoint'
  readonly identity?: string
  readonly service?: string
  readonly domain?: string
  readonly version: string
  readonly enabled: boolean
}
export interface HubProfileTemplatePublic {
  readonly id: string
  readonly key: string
  readonly revision: number
  readonly displayName: string
  readonly description: string
  readonly useCases: readonly string[]
  readonly iconKey: string
  readonly counts: { readonly skills: number; readonly plugins: number; readonly mcpEndpoints: number }
  readonly updatedAt: string
}
export interface HubProfileTemplatePreview {
  readonly templateId: string
  readonly revision: number
  readonly items: readonly {
    readonly item: HubProfileTemplateItem
    readonly disposition: 'installable' | 'blocked'
    readonly reason?: string
    readonly releaseId?: string
  }[]
}
export interface HubProfileTemplateInstantiateResult {
  readonly templateId: string
  readonly revision: number
  readonly profileName: string
  readonly plans: readonly {
    readonly kind: 'skill' | 'plugin'
    readonly symbol: string
    readonly version: string
    readonly releaseId: string
    readonly planId: string
    readonly enabled: boolean
  }[]
  readonly mcpEndpoints: readonly {
    readonly service: string
    readonly domain: string
    readonly version: string
    readonly enabled: boolean
  }[]
  readonly skippedItems: readonly { readonly item: HubProfileTemplateItem; readonly reason: string }[]
}
export interface HubSsoSession { readonly accessToken: string; readonly tenantId: string; readonly operator: string }
/** Structural L0 SSO seam; no product or extension runtime imports and no second refresh-token writer. */
export interface HubSsoSource {
  getDatasourceSession(): HubSsoSession | undefined
  getOfflineIdentity?(): Promise<{ readonly operator: string; readonly tenantId: string } | undefined>
  watchBinding(listener: () => void): () => void
}
export interface HubHostContext {
  readonly tenantId: string
  readonly actorRef: string
  readonly workspaceId: string
  readonly permissions: readonly string[]
  readonly revision: number
}
export class HubHostError extends Error {
  constructor(readonly code: 'HUB_SSO_REQUIRED' | 'HUB_CONTEXT_CHANGED' | 'HUB_INVALID_RESPONSE' | 'HUB_ACCESS_DENIED' | 'HUB_UNAVAILABLE' | 'HUB_INVALID_REQUEST') {
    super(code)
  }
}
function fail(code: HubHostError['code']): never { throw new HubHostError(code) }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('HUB_INVALID_RESPONSE')
  return value as Record<string, unknown>
}
/** 模板条目三类符号引用的闭集校验（docs/1022 §3）。 */
function templateItem(value: unknown): HubProfileTemplateItem {
  const item = object(value)
  if (typeof item.version !== 'string' || !EXACT_VERSION.test(item.version) || typeof item.enabled !== 'boolean') fail('HUB_INVALID_RESPONSE')
  if (item.kind === 'mcp.endpoint') {
    if (typeof item.service !== 'string' || !MCP_ENDPOINT_PART.test(item.service)
      || typeof item.domain !== 'string' || !MCP_ENDPOINT_PART.test(item.domain)) fail('HUB_INVALID_RESPONSE')
    return Object.freeze({ kind: item.kind, service: item.service, domain: item.domain, version: item.version, enabled: item.enabled })
  }
  if ((item.kind !== 'skill' && item.kind !== 'plugin') || typeof item.identity !== 'string'
    || item.identity.length < 1 || item.identity.length > 214) fail('HUB_INVALID_RESPONSE')
  return Object.freeze({ kind: item.kind, identity: item.identity, version: item.version, enabled: item.enabled })
}
async function responseJson(response: Response): Promise<unknown> {
  const size = response.headers.get('content-length')
  if (size !== null && (!/^\d+$/u.test(size) || Number(size) > MAX_RESPONSE_BYTES)) fail('HUB_INVALID_RESPONSE')
  if (response.body === null) fail('HUB_INVALID_RESPONSE')
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let count = 0
  try {
    while (true) {
      let part: ReadableStreamReadResult<Uint8Array>
      try { part = await reader.read() } catch { fail('HUB_UNAVAILABLE') }
      if (part.done) break
      if ((count += part.value.byteLength) > MAX_RESPONSE_BYTES) fail('HUB_INVALID_RESPONSE')
      chunks.push(part.value)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown } catch { fail('HUB_INVALID_RESPONSE') }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
/** Tokens are sampled inside each Host call and never included in returned context or diagnostics. */
export class HubHostClient {
  private readonly invalidationListeners = new Set<()=>void>()
  private readonly denialListeners = new Set<()=>void>()
  watchInvalidation(listener:()=>void):()=>void { this.invalidationListeners.add(listener); return ()=>{this.invalidationListeners.delete(listener)} }
  watchOfflineDenial(listener:()=>void):()=>void { this.denialListeners.add(listener); return ()=>{this.denialListeners.delete(listener)} }
  private denyOffline():void { this.offlineBlocked=true;for(const listener of this.denialListeners)listener() }
  private revision = 0
  private owner: string | undefined
  private selection: string | undefined
  private controller = new AbortController()
  private disposed = false
  private offlineBlocked = false
  private readonly unwatch: () => void
  constructor(private readonly auth: HubSsoSource, private readonly fetcher: typeof fetch = globalThis.fetch) {
    this.unwatch = auth.watchBinding(() => this.invalidate())
  }
  private invalidate(notify = true): void {
    this.revision += 1; this.controller.abort(); this.controller = new AbortController(); this.selection = undefined
    if(notify) for(const listener of this.invalidationListeners) listener()
  }
  dispose(): void { this.disposed = true; this.controller.abort(); this.unwatch() }
  /** Owner observation only; signed, healthy boot authority is checked separately. No API bearer is returned. */
  async offlineOwner(): Promise<{ readonly operator: string; readonly tenantId: string } | undefined> {
    if (this.disposed || this.offlineBlocked) return undefined
    const revision = this.revision, session = this.auth.getDatasourceSession()
    const owner = session ?? await this.auth.getOfflineIdentity?.()
    if (this.disposed || this.offlineBlocked || revision !== this.revision || !owner?.operator || !UUID.test(owner.tenantId)) return undefined
    return Object.freeze({ operator: owner.operator, tenantId: owner.tenantId })
  }
  private current(): { session: HubSsoSession; revision: number } {
    const session = this.auth.getDatasourceSession()
    if (this.disposed || !session?.accessToken || !session.operator || !UUID.test(session.tenantId)) fail('HUB_SSO_REQUIRED')
    const owner = JSON.stringify([session.operator, session.tenantId])
    if (this.owner !== owner) { const changed=this.owner!==undefined; this.owner = owner; this.invalidate(changed) }
    return { session, revision: this.revision }
  }
  assertCurrent(context: HubHostContext): void {
    const current = this.current()
    if (current.revision !== context.revision || current.session.operator !== context.actorRef) fail('HUB_CONTEXT_CHANGED')
  }
  private async request(path: HubRequestPath, workspaceId?: string, body?: object, idempotencyKey?: string): Promise<{ data: Record<string, unknown>; revision: number; actorRef: string }> {
    const current = this.current(), cancellation = this.controller.signal
    let response: Response
    try {
      response = await this.fetcher(`${HUB_GENERATION_ORIGIN}${path}`, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
        signal: AbortSignal.any([cancellation, AbortSignal.timeout(15_000)]),
        headers: { accept: 'application/json', authorization: `Bearer ${current.session.accessToken}`,
          ...(workspaceId === undefined ? {} : { 'x-current-tenant': workspaceId }),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(idempotencyKey === undefined ? {} : { 'idempotency-key': idempotencyKey }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch { if (cancellation.aborted) fail('HUB_CONTEXT_CHANGED'); fail('HUB_UNAVAILABLE') }
    if (response.status === 401) { this.denyOffline(); fail('HUB_SSO_REQUIRED') }
    if (response.status === 403) { this.denyOffline(); fail('HUB_ACCESS_DENIED') }
    if (!response.ok) { if(response.status>=500)fail('HUB_UNAVAILABLE');fail('HUB_INVALID_RESPONSE') }
    let payload:unknown
    try { payload=await responseJson(response) }
    catch(error){if(cancellation.aborted||current.revision!==this.revision)fail('HUB_CONTEXT_CHANGED');throw error}
    const envelope = object(payload), data = object(envelope.data)
    if (envelope.code !== 200 && envelope.code !== 201) fail('HUB_INVALID_RESPONSE')
    const latest = this.current()
    if (current.revision !== latest.revision || cancellation.aborted) fail('HUB_CONTEXT_CHANGED')
    return { data, revision: current.revision, actorRef: current.session.operator }
  }
  /** Identity is server-validated with SSO; workspace header is only a requested membership. */
  async context(workspaceId?: string): Promise<HubHostContext> {
    if (workspaceId !== undefined && !UUID.test(workspaceId)) fail('HUB_INVALID_REQUEST')
    const selected = workspaceId ?? this.selection
    const result = await this.request('/skillhub/v1/me', selected)
    const workspace = object(result.data.workspace), team = object(workspace.ssoTeam)
    if (typeof result.data.tenantId !== 'string' || !UUID.test(result.data.tenantId)
      || typeof team.id !== 'string' || !UUID.test(team.id) || selected !== undefined && team.id !== selected
      || !Array.isArray(result.data.permissions) || result.data.permissions.length > 1024
      || !result.data.permissions.every(value => typeof value === 'string' && value.length <= 256)) fail('HUB_INVALID_RESPONSE')
    const context = Object.freeze({ tenantId: result.data.tenantId, workspaceId: team.id, actorRef: result.actorRef,
      permissions: Object.freeze([...result.data.permissions] as string[]), revision: result.revision })
    this.assertCurrent(context)
    this.offlineBlocked = false
    return context
  }
  async bindDevice(context:HubHostContext,hostDescriptor:Readonly<Record<string,unknown>>):Promise<string>{
    this.assertCurrent(context)
    const result=await this.request('/skillhub/v1/devices/bind',context.workspaceId,{hostDescriptor})
    this.assertCurrent(context)
    if(typeof result.data.deviceId!=='string'||!UUID.test(result.data.deviceId)||result.data.ownerRef!==context.actorRef)fail('HUB_INVALID_RESPONSE')
    return result.data.deviceId
  }
  /** Agent 模板选择器的公开列表（仅 published）；结构与 docs/1022 §4 一一对应。 */
  async profileTemplates(context: HubHostContext, page = 1): Promise<{ readonly list: readonly HubProfileTemplatePublic[]; readonly total: number }> {
    this.assertCurrent(context)
    if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) fail('HUB_INVALID_REQUEST')
    const result = await this.request(`/skillhub/v1/profile-templates/public?page=${page}&limit=50`, context.workspaceId)
    this.assertCurrent(context)
    const rows = result.data.list
    if (!Array.isArray(rows) || rows.length > 100 || typeof result.data.total !== 'number'
      || !Number.isSafeInteger(result.data.total) || result.data.total < 0) fail('HUB_INVALID_RESPONSE')
    const list = rows.map((row): HubProfileTemplatePublic => {
      const item = object(row)
      const counts = object(item.counts)
      const useCases = item.useCases
      if (typeof item.id !== 'string' || !UUID.test(item.id) || typeof item.key !== 'string'
        || !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(item.key) || typeof item.revision !== 'number'
        || !Number.isSafeInteger(item.revision) || item.revision < 1 || typeof item.displayName !== 'string'
        || item.displayName.length < 1 || item.displayName.length > 24 || typeof item.description !== 'string'
        || item.description.length > 120 || typeof item.iconKey !== 'string' || item.iconKey.length < 1
        || item.iconKey.length > 64 || typeof item.updatedAt !== 'string' || Number.isNaN(Date.parse(item.updatedAt))
        || !Array.isArray(useCases) || useCases.length < 2 || useCases.length > 4
        || useCases.some((useCase) => typeof useCase !== 'string' || useCase.length < 1 || useCase.length > 20)) fail('HUB_INVALID_RESPONSE')
      const skillCount = counts.skills, pluginCount = counts.plugins, mcpCount = counts.mcpEndpoints
      if (typeof skillCount !== 'number' || !Number.isSafeInteger(skillCount) || skillCount < 0
        || typeof pluginCount !== 'number' || !Number.isSafeInteger(pluginCount) || pluginCount < 0
        || typeof mcpCount !== 'number' || !Number.isSafeInteger(mcpCount) || mcpCount < 0) fail('HUB_INVALID_RESPONSE')
      return Object.freeze({
        id: item.id, key: item.key, revision: item.revision, displayName: item.displayName,
        description: item.description, useCases: Object.freeze([...useCases] as string[]), iconKey: item.iconKey,
        counts: Object.freeze({ skills: skillCount, plugins: pluginCount, mcpEndpoints: mcpCount }),
        updatedAt: item.updatedAt,
      })
    })
    return { list: Object.freeze(list), total: result.data.total }
  }
  /** 逐项 disposition 消费复核；blocked 原因服务端已本地化，结构仅限长文本边界。 */
  async profileTemplatePreview(context: HubHostContext, templateId: string): Promise<HubProfileTemplatePreview> {
    this.assertCurrent(context)
    if (!UUID.test(templateId)) fail('HUB_INVALID_REQUEST')
    const result = await this.request(`/skillhub/v1/profile-templates/${templateId}/preview`, context.workspaceId)
    this.assertCurrent(context)
    const items = result.data.items
    if (result.data.templateId !== templateId || typeof result.data.revision !== 'number'
      || !Number.isSafeInteger(result.data.revision) || result.data.revision < 1
      || !Array.isArray(items) || items.length < 1 || items.length > 64) fail('HUB_INVALID_RESPONSE')
    return {
      templateId, revision: result.data.revision,
      items: Object.freeze(items.map((row): HubProfileTemplatePreview['items'][number] => {
        const entry = object(row)
        const disposition = entry.disposition
        if (disposition !== 'installable' && disposition !== 'blocked') fail('HUB_INVALID_RESPONSE')
        if (entry.reason !== undefined && (typeof entry.reason !== 'string' || entry.reason.length < 1 || entry.reason.length > 200)) fail('HUB_INVALID_RESPONSE')
        if (entry.releaseId !== undefined && (typeof entry.releaseId !== 'string' || !UUID.test(entry.releaseId))) fail('HUB_INVALID_RESPONSE')
        if (disposition === 'blocked' && typeof entry.reason !== 'string') fail('HUB_INVALID_RESPONSE')
        return Object.freeze({
          item: templateItem(entry.item),
          disposition,
          ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
          ...(entry.releaseId !== undefined ? { releaseId: entry.releaseId } : {}),
        })
      })),
    }
  }
  /** 实例化：Hub 逐项创建既有安装计划；返回的 planId 走既有 authorize/consume 管线。 */
  async instantiateProfileTemplate(context: HubHostContext, input: {
    readonly templateId: string
    readonly profileName: string
    readonly deviceId: string
    readonly target: { readonly hostScopeId: string; readonly profileId: string }
  }): Promise<HubProfileTemplateInstantiateResult> {
    this.assertCurrent(context)
    if (!UUID.test(input.templateId) || !UUID.test(input.deviceId)) fail('HUB_INVALID_REQUEST')
    const profileName = input.profileName.trim()
    if (!profileName || profileName.length > 24) fail('HUB_INVALID_REQUEST')
    const target = input.target
    if (typeof target?.hostScopeId !== 'string' || target.hostScopeId.length < 1 || target.hostScopeId.length > 128
      || typeof target.profileId !== 'string' || target.profileId.length < 1 || target.profileId.length > 128) fail('HUB_INVALID_REQUEST')
    const result = await this.request(`/skillhub/v1/profile-templates/${input.templateId}/instantiate`, context.workspaceId, {
      templateId: input.templateId, profileName, deviceId: input.deviceId, target,
    })
    this.assertCurrent(context)
    const plans = result.data.plans, mcpEndpoints = result.data.mcpEndpoints, skippedItems = result.data.skippedItems
    if (result.data.templateId !== input.templateId || result.data.profileName !== profileName
      || typeof result.data.revision !== 'number' || !Number.isSafeInteger(result.data.revision) || result.data.revision < 1
      || !Array.isArray(plans) || plans.length > 64 || !Array.isArray(mcpEndpoints) || mcpEndpoints.length > 64
      || !Array.isArray(skippedItems) || skippedItems.length > 64) fail('HUB_INVALID_RESPONSE')
    for (const row of plans) {
      const plan = object(row)
      if ((plan.kind !== 'skill' && plan.kind !== 'plugin') || typeof plan.symbol !== 'string'
        || plan.symbol.length < 1 || plan.symbol.length > 255 || typeof plan.version !== 'string' || !EXACT_VERSION.test(plan.version)
        || typeof plan.releaseId !== 'string' || !UUID.test(plan.releaseId)
        || typeof plan.planId !== 'string' || !UUID.test(plan.planId) || typeof plan.enabled !== 'boolean') fail('HUB_INVALID_RESPONSE')
    }
    for (const row of mcpEndpoints) {
      const endpoint = object(row)
      if (typeof endpoint.service !== 'string' || !MCP_ENDPOINT_PART.test(endpoint.service)
        || typeof endpoint.domain !== 'string' || !MCP_ENDPOINT_PART.test(endpoint.domain)
        || typeof endpoint.version !== 'string' || !EXACT_VERSION.test(endpoint.version)
        || typeof endpoint.enabled !== 'boolean') fail('HUB_INVALID_RESPONSE')
    }
    for (const row of skippedItems) {
      const skipped = object(row)
      if (typeof skipped.reason !== 'string' || skipped.reason.length < 1 || skipped.reason.length > 200) fail('HUB_INVALID_RESPONSE')
      templateItem(skipped.item)
    }
    return Object.freeze({
      templateId: input.templateId, revision: result.data.revision, profileName,
      plans: Object.freeze(plans as HubProfileTemplateInstantiateResult['plans']),
      mcpEndpoints: Object.freeze(mcpEndpoints as HubProfileTemplateInstantiateResult['mcpEndpoints']),
      skippedItems: Object.freeze(skippedItems as HubProfileTemplateInstantiateResult['skippedItems']),
    })
  }
  async bootAuthorization(context:HubHostContext,input:{readonly deviceId:string;readonly profileId:string;readonly generationDigest:string;readonly target:HubSyncExpected['target']}):Promise<unknown>{
    this.assertCurrent(context)
    if(!UUID.test(input.deviceId)||!UUID.test(input.profileId)||!/^[a-f0-9]{64}$/u.test(input.generationDigest))fail('HUB_INVALID_REQUEST')
    return (await this.request('/skillhub/v1/generations/boot-authorization',context.workspaceId,input)).data
  }
  /** Read-only signed update check; never calls prepare/consume/activate. */
  async check(context: HubHostContext, request: {
    readonly mode: 'initial' | 'check' | 'reconcile'
    readonly installed: readonly { readonly kind: 'skill' | 'plugin'; readonly itemId: string; readonly releaseId: string | null;
      readonly artifactDigest: string | null; readonly channelRevision: number; readonly enabled: boolean; readonly userRemoved: boolean }[]
  }, expected: HubSyncExpected, trust: HubReleaseTrust): Promise<VerifiedHubSyncSnapshot> {
    this.assertCurrent(context)
    if (expected.origin !== HUB_GENERATION_ORIGIN || expected.tenantId !== context.tenantId || expected.actorRef !== context.actorRef) fail('HUB_CONTEXT_CHANGED')
    const result = await this.request('/skillhub/v1/sync/resolve', context.workspaceId, {
      mode: request.mode, channel: expected.channel, deviceId: expected.deviceId, profileId: expected.profileId,
      observedStateDigest: expected.observedStateDigest, target: expected.target, installed: request.installed,
    })
    this.assertCurrent(context)
    return verifyHubSyncSnapshot(result.data, trust, expected)
  }
  /** Host-only wire transport. Replies are untrusted until the execution verifier validates them. */
  async generationRequest(context: HubHostContext, operation:
    | { readonly kind: 'prepare'; readonly idempotencyKey: string; readonly body: object }
    | { readonly kind: 'authorize' | 'consume' | 'consume-status' | 'downloads'; readonly planId: string; readonly body: object }
    | { readonly kind: 'receipt'; readonly body: object }): Promise<unknown> {
    this.assertCurrent(context)
    let path: HubRequestPath
    if (operation.kind === 'prepare') {
      if (!UUID.test(operation.idempotencyKey)) fail('HUB_INVALID_REQUEST')
      path = '/skillhub/v1/generations/plans'
    } else if (operation.kind === 'receipt') path = '/skillhub/v1/generations/installation-reports'
    else {
      if (!UUID.test(operation.planId)) fail('HUB_INVALID_REQUEST')
      path = `/skillhub/v1/generations/plans/${operation.planId}/${operation.kind}`
    }
    const result = await this.request(path, context.workspaceId, operation.body,
      operation.kind === 'prepare' ? operation.idempotencyKey : undefined)
    this.assertCurrent(context)
    return result.data
  }
  /** Aggregate binary content only, addressed by server UUID and checked against exact signed evidence. */
  async generationBytes(context: HubHostContext, downloadId: string, expected: { readonly bytes:number; readonly sha256:string; readonly contentType:string }): Promise<Buffer> {
    this.assertCurrent(context)
    if (!UUID.test(downloadId) || !Number.isSafeInteger(expected.bytes) || expected.bytes<0 || expected.bytes>256*1024*1024 || !/^[a-f0-9]{64}$/u.test(expected.sha256)) fail('HUB_INVALID_REQUEST')
    const current=this.current(), cancellation=this.controller.signal
    let response:Response
    try { response=await this.fetcher(`${HUB_GENERATION_ORIGIN}/skillhub/v1/generations/downloads/${downloadId}/content`, {
      method:'GET',redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.any([cancellation,AbortSignal.timeout(60_000)]),
      headers:{accept:expected.contentType,authorization:`Bearer ${current.session.accessToken}`,'x-current-tenant':context.workspaceId},
    }) } catch { if(cancellation.aborted)fail('HUB_CONTEXT_CHANGED');fail('HUB_UNAVAILABLE') }
    if(response.status===401){this.denyOffline();fail('HUB_SSO_REQUIRED')}if(response.status===403){this.denyOffline();fail('HUB_ACCESS_DENIED')}
    if(!response.ok || !response.body || response.headers.get('content-type')?.split(';')[0]!==expected.contentType)fail('HUB_INVALID_RESPONSE')
    const length=response.headers.get('content-length')
    if(length!==null && length!==String(expected.bytes))fail('HUB_INVALID_RESPONSE')
    const reader=response.body.getReader(), chunks:Uint8Array[]=[];let count=0
    try { while(true){const part=await reader.read();if(part.done)break;if((count+=part.value.byteLength)>expected.bytes)fail('HUB_INVALID_RESPONSE');chunks.push(part.value)} }
    finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
    const bytes=Buffer.concat(chunks)
    this.assertCurrent(context)
    if(current.revision!==this.current().revision || bytes.length!==expected.bytes || (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex')!==expected.sha256)fail('HUB_INVALID_RESPONSE')
    return bytes
  }
  /** Changing workspace invalidates pending operations; caller must resolve a fresh context. */
  async selectWorkspace(workspaceId: string): Promise<HubHostContext> {
    await this.context(workspaceId)
    this.invalidate(); this.selection = workspaceId
    return await this.context(workspaceId)
  }
}
