// Host-only enterprise catalog client. No bearer or ticket enters the catalog view.
export const HUB_API_BASE = 'https://ai.hozonauto.com/plugins/api'
export const HUB_WEB_BASE = 'https://ai.hozonauto.com/plugins'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const PAGE_LIMIT = 100
const MAX_PAGES = 100

export function hubSession(ctx) {
  const value = ctx.dofeAuth?.getDatasourceSession?.()
  return typeof value?.accessToken === 'string' && value.accessToken ? value : undefined
}

function failure(code, message) { return Object.assign(new Error(message), { code }) }

const ID_PATH = '[0-9a-f-]{36}'
const JSON_ROUTES = [
  ['GET', /^\/skillhub\/v1\/(me|workspaces|skills|plugins)(?:\?page=\d+&limit=100)?$/u],
  ['GET', new RegExp(`^/skillhub/v1/skills/${ID_PATH}$`, 'iu')],
  ['GET', new RegExp(`^/skillhub/v1/skills/releases/${ID_PATH}/manifest$`, 'iu')],
  ['POST', /^\/skillhub\/v1\/devices\/bind$/u],
  ['POST', /^\/skillhub\/v1\/skills\/(install-plans|installation-reports)$/u],
  ['POST', new RegExp(`^/skillhub/v1/skills/install-plans/${ID_PATH}/(authorize|consume)$`, 'iu')],
  ['POST', new RegExp(`^/skillhub/v1/skills/releases/${ID_PATH}/download-grants$`, 'iu')],
]
export async function boundedBody(response, maximum) {
  const declared = response.headers?.get?.('content-length')
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > maximum)) throw failure('HUB_RESPONSE_TOO_LARGE', 'Hub 返回内容超过限制。')
  if (!response.body) {
    // Response-shaped test doubles have no reader; real fetch bodies always do.
    const bytes = Buffer.from(JSON.stringify(await response.json()))
    if (bytes.length > maximum) throw failure('HUB_RESPONSE_TOO_LARGE', 'Hub 返回内容超过限制。')
    return bytes
  }
  const reader = response.body.getReader(); const chunks = []; let count = 0
  try {
    while (true) {
      const {done,value} = await reader.read()
      if (done) break
      count += value.length
      if (count > maximum) throw failure('HUB_RESPONSE_TOO_LARGE', 'Hub 返回内容超过限制。')
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks)
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
export async function callHubCatalog(ctx, path, options = {}) {
  const session = options.session || hubSession(ctx), method = options.method || 'GET'
  if (!session) throw failure('HUB_SSO_REQUIRED', '请先在桌面端登录企业账号。')
  if (!JSON_ROUTES.some(([verb,pattern]) => verb === method && pattern.test(path))) throw failure('HUB_INVALID_REQUEST', '无效的 Hub 请求。')
  let response
  try {
    response = await (options.fetch || globalThis.fetch)(`${HUB_API_BASE}${path}`, {
      method, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: options.signal || AbortSignal.timeout(15_000),
      headers: {
        Accept: 'application/json', Authorization: `Bearer ${session.accessToken}`,
        ...(method === 'POST' ? { 'Content-Type':'application/json' } : {}),
        ...(options.workspaceId ? { 'x-current-tenant': options.workspaceId } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify(options.body) } : {}),
    })
  } catch { throw failure('HUB_UNAVAILABLE', '暂时无法连接企业 Hub，请稍后重试。') }
  if (response.status === 401) throw failure('HUB_SSO_REQUIRED', '企业登录已失效，请重新登录。')
  if (response.status === 403) throw failure('HUB_ACCESS_DENIED', '当前账号无权执行此操作，请确认成员权限和设备状态。')
  let envelope
  try { envelope = JSON.parse((await boundedBody(response,2 * 1024 * 1024)).toString('utf8')) } catch (error) { if (error.code) throw error }
  if (![200,201,202].includes(response.status) || !response.ok || envelope?.code !== 200 || !envelope?.data) {
    throw failure('HUB_UNAVAILABLE', '企业 Hub 返回异常，请稍后重试。')
  }
  return envelope.data
}
export async function downloadHubArchive(ctx, grant, options = {}) {
  if (!UUID.test(grant?.grantId || '') || !Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= Date.now()) throw failure('HUB_INVALID_RESPONSE','下载授权无效或已过期。')
  const path = `/plugins/api/skillhub/v1/downloads/${grant.grantId}/content`
  if (![path,`https://ai.hozonauto.com${path}`].includes(grant.downloadUrl)) throw failure('HUB_INVALID_RESPONSE','下载地址未通过安全校验。')
  const session = options.session || hubSession(ctx)
  if (!session) throw failure('HUB_SSO_REQUIRED','请先登录企业账号。')
  let response
  try {
    response = await (options.fetch || globalThis.fetch)(`https://ai.hozonauto.com${path}`, {
      redirect:'error', credentials:'omit', cache:'no-store', signal:AbortSignal.timeout(30_000),
      headers:{ Accept:'application/zip', Authorization:`Bearer ${session.accessToken}`, 'x-current-tenant':options.workspaceId },
    })
  } catch { throw failure('HUB_UNAVAILABLE','技能下载中断，请重新确认。') }
  if (response.status !== 200 || response.headers?.get?.('content-type')?.split(';')[0] !== 'application/zip') throw failure('HUB_DOWNLOAD_FAILED','技能下载未通过认证。')
  return boundedBody(response,10 * 1024 * 1024)
}

export async function allHubPages(ctx, path, options = {}) {
  const list = []
  const ids = new Set()
  let total
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await callHubCatalog(ctx, `${path}?page=${page}&limit=${PAGE_LIMIT}`, options)
    if (!Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0
      || result.page !== page || result.limit !== PAGE_LIMIT) {
      throw failure('HUB_INVALID_RESPONSE', '目录分页数据无效，请重新刷新。')
    }
    total ??= result.total
    if (total !== result.total) throw failure('HUB_CATALOG_CHANGED', '目录正在更新，请重新刷新。')
    for (const item of result.list) {
      const id = item.skillId || item.pluginId || item.ssoTeam?.id
      if (!UUID.test(id || '') || ids.has(id)) throw failure('HUB_INVALID_RESPONSE', '目录条目重复或无效，请重新刷新。')
      ids.add(id)
      list.push(item)
    }
    if (list.length === total) return { list, total }
    if (list.length > total || result.list.length === 0) throw failure('HUB_INVALID_RESPONSE', '目录分页不完整，请重新刷新。')
  }
  throw failure('HUB_CATALOG_LIMIT', '目录超过本机浏览上限，请在 Hub 中搜索。')
}

function sourceError(error) {
  return { list: [], total: 0, error: error.message, code: error.code || 'HUB_UNAVAILABLE' }
}

export class HubCatalogClient {
  constructor(ctx, options = {}) {
    this.ctx = ctx; this.fetch = options.fetch; this.revision = 0
    this.unwatch = ctx.dofeAuth?.watchBinding?.(() => { this.revision += 1 })
  }
  dispose() { this.unwatch?.() }

  identity() {
    const session = hubSession(this.ctx)
    if (!session) throw failure('HUB_SSO_REQUIRED', '请先在桌面端登录企业账号。')
    const owner = JSON.stringify([session.operator || '', session.tenantId || ''])
    if (this.owner !== owner) { this.owner = owner; this.workspaceId = undefined; this.revision = (this.revision || 0) + 1 }
    return { session, owner, revision: this.revision }
  }

  assertCurrent(snapshot) {
    if (this.identity().owner !== snapshot.owner || this.revision !== snapshot.revision) {
      throw failure('HUB_WORKSPACE_CHANGED', '账号或工作空间已切换，请重新刷新。')
    }
  }

  async context(workspaceId) {
    const snapshot = this.identity()
    const selection = workspaceId || this.workspaceId || (UUID.test(snapshot.session.tenantId || '') ? snapshot.session.tenantId : undefined)
    const options = { fetch: this.fetch, session: snapshot.session, workspaceId: selection, signal: AbortSignal.timeout(15_000) }
    const me = await callHubCatalog(this.ctx, '/skillhub/v1/me', options)
    if (!UUID.test(me.workspace?.ssoTeam?.id || '') || !UUID.test(me.tenantId || '') || !Array.isArray(me.permissions)
      || ((workspaceId || this.workspaceId) && me.workspace.ssoTeam.id !== (workspaceId || this.workspaceId))) {
      throw failure('HUB_INVALID_RESPONSE', '工作空间身份不匹配，请重新选择。')
    }
    this.assertCurrent(snapshot)
    return { snapshot, me, options: { ...options, workspaceId: me.workspace.ssoTeam.id } }
  }

  async select(workspaceId) {
    if (!UUID.test(workspaceId || '')) throw failure('HUB_INVALID_REQUEST', '请选择有效的工作空间。')
    const context = await this.context(workspaceId)
    this.workspaceId = context.me.workspace.ssoTeam.id
    this.revision += 1
    return { workspace: context.me.workspace, workspaceId: this.workspaceId }
  }

  async catalog() {
    let context
    try { context = await this.context() } catch (error) {
      // Membership can be revoked while a different workspace remains available.
      // List memberships without the rejected selection so the user can recover.
      let workspaces = []
      if (error.code !== 'HUB_SSO_REQUIRED') {
        const snapshot = this.identity()
        const result = await allHubPages(this.ctx, '/skillhub/v1/workspaces', {
          fetch: this.fetch, session: snapshot.session,
        }).catch(sourceError)
        this.assertCurrent(snapshot)
        workspaces = result.list
      }
      return { workspace: null, workspaces, skills: sourceError(error), plugins: sourceError(error), workspaceError: error.message, workspaceErrorCode: error.code }
    }
    const { snapshot, me, options } = context
    const [workspaces, skills, plugins] = await Promise.all([
      allHubPages(this.ctx, '/skillhub/v1/workspaces', options).catch(sourceError),
      allHubPages(this.ctx, '/skillhub/v1/skills', options).catch(sourceError),
      allHubPages(this.ctx, '/skillhub/v1/plugins', options).catch(sourceError),
    ])
    this.assertCurrent(snapshot)
    this.workspaceId = me.workspace.ssoTeam.id
    return {
      workspace: me.workspace, workspaceId: this.workspaceId, permissions: me.permissions,
      workspaces: workspaces.list, workspaceError: workspaces.error || null,
      skills, plugins,
    }
  }
}
