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

export async function callHubCatalog(ctx, path, options = {}) {
  const session = options.session || hubSession(ctx)
  if (!session) throw failure('HUB_SSO_REQUIRED', '请先在桌面端登录企业账号。')
  if (!path.startsWith('/skillhub/v1/')) throw failure('HUB_INVALID_REQUEST', '无效的 Hub 请求。')
  let response
  try {
    response = await (options.fetch || globalThis.fetch)(`${HUB_API_BASE}${path}`, {
      redirect: 'error', signal: options.signal || AbortSignal.timeout(15_000),
      headers: {
        Accept: 'application/json', Authorization: `Bearer ${session.accessToken}`,
        ...(options.workspaceId ? { 'x-current-tenant': options.workspaceId } : {}),
      },
    })
  } catch { throw failure('HUB_UNAVAILABLE', '暂时无法连接企业 Hub，请稍后重试。') }
  const envelope = await response.json().catch(() => null)
  if (response.status === 401) throw failure('HUB_SSO_REQUIRED', '企业登录已失效，请重新登录。')
  if (response.status === 403) throw failure('HUB_ACCESS_DENIED', '当前账号无权访问此工作空间。')
  if (!response.ok || envelope?.code !== 200 || !envelope?.data) {
    throw failure('HUB_UNAVAILABLE', '企业 Hub 返回异常，请稍后重试。')
  }
  return envelope.data
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
  constructor(ctx, options = {}) { this.ctx = ctx; this.fetch = options.fetch }

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
      || (workspaceId && me.workspace.ssoTeam.id !== workspaceId)) {
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
