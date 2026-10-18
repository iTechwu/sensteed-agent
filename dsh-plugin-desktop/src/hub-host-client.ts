/** Desktop L0-owned fixed-origin transport, extracted from the manager Host client. */
import { verifyHubSyncSnapshot, type HubReleaseTrust, type HubSyncExpected, type VerifiedHubSyncSnapshot } from './hub-sync-verifier.ts'
import { HUB_GENERATION_ORIGIN } from './hub-generation-store.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
type HubRequestPath = '/skillhub/v1/me' | '/skillhub/v1/devices/bind' | '/skillhub/v1/sync/resolve'
  | '/skillhub/v1/generations/boot-authorization' | '/skillhub/v1/generations/plans' | '/skillhub/v1/generations/installation-reports'
  | `/skillhub/v1/generations/plans/${string}/${'authorize' | 'consume' | 'consume-status' | 'downloads'}`
export interface HubSsoSession { readonly accessToken: string; readonly tenantId: string; readonly operator: string }
/** Structural L0 SSO seam; no product or extension runtime imports and no second refresh-token writer. */
export interface HubSsoSource {
  getDatasourceSession(): HubSsoSession | undefined
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
async function responseJson(response: Response): Promise<unknown> {
  const size = response.headers.get('content-length')
  if (size !== null && (!/^\d+$/u.test(size) || Number(size) > MAX_RESPONSE_BYTES)) fail('HUB_INVALID_RESPONSE')
  if (response.body === null) fail('HUB_INVALID_RESPONSE')
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let count = 0
  try {
    while (true) {
      const part = await reader.read()
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
  watchInvalidation(listener:()=>void):()=>void { this.invalidationListeners.add(listener); return ()=>{this.invalidationListeners.delete(listener)} }
  private revision = 0
  private owner: string | undefined
  private selection: string | undefined
  private controller = new AbortController()
  private disposed = false
  private readonly unwatch: () => void
  constructor(private readonly auth: HubSsoSource, private readonly fetcher: typeof fetch = globalThis.fetch) {
    this.unwatch = auth.watchBinding(() => this.invalidate())
  }
  private invalidate(notify = true): void {
    this.revision += 1; this.controller.abort(); this.controller = new AbortController(); this.selection = undefined
    if(notify) for(const listener of this.invalidationListeners) listener()
  }
  dispose(): void { this.disposed = true; this.controller.abort(); this.unwatch() }
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
    if (response.status === 401) fail('HUB_SSO_REQUIRED')
    if (response.status === 403) fail('HUB_ACCESS_DENIED')
    if (!response.ok) fail('HUB_UNAVAILABLE')
    const envelope = object(await responseJson(response)), data = object(envelope.data)
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
    return context
  }
  async bindDevice(context:HubHostContext,hostDescriptor:Readonly<Record<string,unknown>>):Promise<string>{
    this.assertCurrent(context)
    const result=await this.request('/skillhub/v1/devices/bind',context.workspaceId,{hostDescriptor})
    this.assertCurrent(context)
    if(typeof result.data.deviceId!=='string'||!UUID.test(result.data.deviceId)||result.data.ownerRef!==context.actorRef)fail('HUB_INVALID_RESPONSE')
    return result.data.deviceId
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
    if(response.status===401)fail('HUB_SSO_REQUIRED');if(response.status===403)fail('HUB_ACCESS_DENIED')
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
