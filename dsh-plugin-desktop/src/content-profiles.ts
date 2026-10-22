/** instantiate 返回的期望集视图（manager 传入；字段与 L0 校验后的结果一致）。 */
export interface HubInstantiatedShape {
  readonly templateId: string
  readonly revision: number
  readonly items: readonly { kind: 'skill' | 'plugin'; itemId: string; enabled: boolean }[]
  readonly mcpEndpoints: readonly { service: string; domain: string; version: string; enabled: boolean }[]
  readonly skippedItems: readonly { item: unknown; reason: string }[]
}

/** Host-owned content-combination Profile store (docs/1022 §6.4).
 * 双壳（stable desktop 与 NEXT）共用：渲染进程只发意图，存储与作用域都在 Host 进程，
 * 落盘在 harness profile 目录（与 generation identity 的 profilePath 同族）。
 * 创建入口仅 instantiate（§6.3 Tab B 等价 = 企业目录勾选流程，不另建本地 Profile）；
 * 早期实验壳创建的无模板来源行仍可读取与本地切换。 */
/** Content-combination Profile store (docs/1022 §6.4). Born-from-template stays frozen: upstream template updates never mutate an existing profile. */
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

export type ContentProfileItem =
  | { kind: 'skill'; itemId: string; enabled: boolean }
  | { kind: 'plugin'; itemId: string; enabled: boolean }
  | { kind: 'mcp.endpoint'; service: string; domain: string; version: string; enabled: boolean }

export interface ContentProfileSummary {
  skills: number
  plugins: number
  mcpEndpoints: number
  skipped: number
}

export interface ContentProfile {
  id: string
  name: string
  sourceTemplateId?: string
  sourceTemplateRevision?: number
  summary: ContentProfileSummary
  items: ContentProfileItem[]
  /** 显式保留的阻断项与原因；禁止静默跳过（docs/1022 §2）。 */
  skippedItems: { item: unknown; reason: string }[]
  createdAt: string
  lastAppliedAt?: string
}

export interface ContentProfilesState {
  version: 1
  activeId: string | null
  profiles: ContentProfile[]
}

/** 与 instantiateProfileTemplate 返回的字段形态一致（itemId 目录身份视图）。 */
export interface ContentProfileInstantiateInput {
  readonly templateId: string
  readonly templateRevision: number
  readonly items: readonly { readonly kind: 'skill' | 'plugin'; readonly itemId: string; readonly enabled: boolean }[]
  readonly mcpEndpoints: readonly {
    readonly service: string
    readonly domain: string
    readonly version: string
    readonly enabled: boolean
  }[]
  readonly skippedItems: readonly { readonly item: unknown; readonly reason: string }[]
}

/** 本地唯一名：冲突加「副本」，仍冲突再追加序号（docs/1022 §6.4）。 */
export function uniqueProfileName(existing: readonly string[], desired: string): string {
  const taken = new Set(existing)
  if (!taken.has(desired)) return desired
  let candidate = `${desired}副本`
  for (let ordinal = 2; taken.has(candidate); ordinal += 1) candidate = `${desired}副本${ordinal}`
  return candidate
}

function summarize(items: readonly ContentProfileItem[], skipped: number): ContentProfileSummary {
  return {
    skills: items.filter((item) => item.kind === 'skill').length,
    plugins: items.filter((item) => item.kind === 'plugin').length,
    mcpEndpoints: items.filter((item) => item.kind === 'mcp.endpoint').length,
    skipped,
  }
}

const EMPTY: ContentProfilesState = { version: 1, activeId: null, profiles: [] }

/** 仅持久化 profiles 与 activeId；apply 阶段是运行时状态，不属于本存储。 */
export class ContentProfileStore {
  constructor(private readonly file: string) {}

  load(): ContentProfilesState {
    if (!existsSync(this.file)) return { ...EMPTY, profiles: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as ContentProfilesState
      if (parsed?.version !== 1 || !Array.isArray(parsed.profiles) || typeof parsed.activeId !== 'string' && parsed.activeId !== null) return { ...EMPTY, profiles: [] }
      return parsed
    } catch {
      return { ...EMPTY, profiles: [] }
    }
  }

  private writeChain: Promise<void> = Promise.resolve()
  /**
   * 文件锁覆盖读取、修改和原子提交；其他 Host/store 实例同样读取最新提交。
   * 读者只能看见完整的已提交文件，失败写入不会发布内存态，链自身不中断。
   */
  private transact<T>(fn: (state: ContentProfilesState) => { result: T; next?: ContentProfilesState }): Promise<T> {
    const exec = this.writeChain.then(() => withFileLock(this.file, async () => {
      const outcome = fn(this.load())
      if (outcome.next) {
        await writeFileAtomic(this.file, `${JSON.stringify(outcome.next, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
      }
      return outcome.result
    }))
    this.writeChain = exec.then(() => undefined, () => undefined)
    return exec
  }
  /** 等待在途事务与落盘完成（测试与有序关停用）。 */
  flush(): Promise<void> { return this.writeChain }

  list(): readonly ContentProfile[] {
    return this.load().profiles
  }

  get(id: string): ContentProfile | undefined {
    return this.load().profiles.find((profile) => profile.id === id)
  }

  activeId(): string | null {
    return this.load().activeId
  }

  /** 模板实例化结果落库：出生即冻结（templateId+revision 仅作来源记录）。 */
  async create(name: string, input: ContentProfileInstantiateInput): Promise<ContentProfile> {
    return this.transact((state) => {
      const items: ContentProfileItem[] = [
        ...input.items.map((item) => ({ kind: item.kind, itemId: item.itemId, enabled: item.enabled })),
        ...input.mcpEndpoints.map((endpoint) => ({
          kind: 'mcp.endpoint' as const, service: endpoint.service, domain: endpoint.domain,
          version: endpoint.version, enabled: endpoint.enabled,
        })),
      ]
      const profile: ContentProfile = {
        id: randomUUID(),
        name: uniqueProfileName(state.profiles.map((existing) => existing.name), name),
        sourceTemplateId: input.templateId,
        sourceTemplateRevision: input.templateRevision,
        summary: summarize(items, input.skippedItems.length),
        items,
        skippedItems: [...input.skippedItems],
        createdAt: new Date().toISOString(),
      }
      const next = { ...state, profiles: [...state.profiles, profile] }
      return { result: profile, next }
    })
  }

  async rename(id: string, name: string): Promise<ContentProfile | undefined> {
    return this.transact((state) => {
      if (!state.profiles.some((profile) => profile.id === id)) return { result: undefined }
      const profiles = state.profiles.map((profile) => profile.id === id
        ? { ...profile, name: uniqueProfileName(state.profiles.filter((other) => other.id !== id).map((other) => other.name), name) }
        : profile)
      return { result: profiles.find((profile) => profile.id === id), next: { ...state, profiles } }
    })
  }

  async remove(id: string): Promise<boolean> {
    return this.transact((state) => {
      if (!state.profiles.some((profile) => profile.id === id)) return { result: false }
      const next = {
        ...state,
        activeId: state.activeId === id ? null : state.activeId,
        profiles: state.profiles.filter((profile) => profile.id !== id),
      }
      return { result: true, next }
    })
  }

  async setActive(id: string | null): Promise<boolean> {
    return this.transact((state) => {
      if (id !== null && !state.profiles.some((profile) => profile.id === id)) return { result: false }
      return { result: true, next: { ...state, activeId: id } }
    })
  }

  /** 应用完成回执；入口与阶段由调用方的 apply 管线驱动。 */
  async markApplied(id: string, appliedAt = new Date().toISOString()): Promise<ContentProfile | undefined> {
    return this.transact((state) => {
      if (!state.profiles.some((profile) => profile.id === id)) return { result: undefined }
      const profiles = state.profiles.map((profile) => profile.id === id
        ? { ...profile, lastAppliedAt: appliedAt }
        : profile)
      return { result: profiles.find((profile) => profile.id === id), next: { ...state, profiles } }
    })
  }
}

/** 落盘文件名约定；目录由 manager 的 profileDirectory 决定。 */
export const CONTENT_PROFILES_FILENAME = 'content-profiles.json'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const endpointPart = /^[a-z][a-z0-9_-]{0,79}$/u
const exactVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-beta(\.[1-9]\d*)?)?$/u

function fail(message: string): never { throw new Error(message) }

function profileName(value: unknown): string {
  if (typeof value !== 'string') fail('Invalid profile name')
  const name = value.trim()
  if (!name || name.length > 24) fail('Invalid profile name')
  return name
}

function itemId(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) fail('Invalid item identity')
  return value
}

function mcpEndpoint(value: unknown): { kind: 'mcp.endpoint'; service: string; domain: string; version: string; enabled: boolean } {
  if (!value || typeof value !== 'object') fail('Invalid mcp endpoint')
  const item = value as Record<string, unknown>
  if (typeof item.service !== 'string' || !endpointPart.test(item.service)
    || typeof item.domain !== 'string' || !endpointPart.test(item.domain)
    || typeof item.version !== 'string' || !exactVersion.test(item.version)
    || typeof item.enabled !== 'boolean') fail('Invalid mcp endpoint')
  return { kind: 'mcp.endpoint', service: item.service, domain: item.domain, version: item.version, enabled: item.enabled }
}

/** manager.instantiate 成功后的本地落库：创建内容 Profile 并置为当前（docs/1022 §6.3 创建即应用）。
 * Hub 期望集注册在先（Host identity profileId）；本调用失败仅意味着切换器暂缺该条目，
 * 不回滚 Hub 注册——重试创建得到新本地条目，期望集不受影响。 */
export async function recordInstantiatedProfile(
  store: ContentProfileStore,
  name: string,
  result: Pick<HubInstantiatedShape, 'templateId' | 'revision' | 'items' | 'mcpEndpoints' | 'skippedItems'>,
): Promise<ContentProfile> {
  const profile = await store.create(name, {
    templateId: result.templateId,
    templateRevision: result.revision,
    items: result.items,
    mcpEndpoints: result.mcpEndpoints,
    skippedItems: result.skippedItems,
  })
  await store.setActive(profile.id)
  return profile
}

/** 纯分发便于单测；注册壳只做 sender 校验与 store 装配。 */
export async function handleContentProfilesRequest(
  store: ContentProfileStore,
  raw: unknown,
): Promise<unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Invalid content-profile request')
  const request = raw as Record<string, unknown>
  const id = (): string => { if (typeof request.id !== 'string' || !uuid.test(request.id)) fail('Invalid profile id'); return request.id }
  switch (request.action) {
    case 'list': return store.list()
    case 'active': return store.activeId()
    case 'create': {
      const items = request.items
      if (!Array.isArray(items) || items.length > 64
        || items.some(item => {
          const entry = item as Record<string, unknown>
          return (entry.kind !== 'skill' && entry.kind !== 'plugin')
            || typeof entry.itemId !== 'string' || !uuid.test(entry.itemId)
            || typeof entry.enabled !== 'boolean'
        })) fail('Invalid selection items')
      const mcpEndpoints = request.mcpEndpoints
      if (!Array.isArray(mcpEndpoints) || mcpEndpoints.length > 64) fail('Invalid mcp endpoints')
      const skippedItems = request.skippedItems
      if (!Array.isArray(skippedItems) || skippedItems.length > 64
        || skippedItems.some(item => {
          const entry = item as Record<string, unknown>
          return typeof entry.reason !== 'string' || entry.reason.length < 1 || entry.reason.length > 200
        })) fail('Invalid skipped items')
      if (typeof request.templateId !== 'string' || !uuid.test(request.templateId)
        || typeof request.templateRevision !== 'number' || !Number.isSafeInteger(request.templateRevision) || request.templateRevision < 1) fail('Invalid template source')
      return await store.create(profileName(request.name), {
        templateId: request.templateId,
        templateRevision: request.templateRevision,
        items: (items as { kind: 'skill' | 'plugin'; itemId: string; enabled: boolean }[]).map(item => ({ ...item, itemId: itemId(item.itemId) })),
        mcpEndpoints: mcpEndpoints.map(mcpEndpoint),
        skippedItems: skippedItems as { item: unknown; reason: string }[],
      })
    }
    case 'rename': return await store.rename(id(), profileName(request.name))
    case 'remove': return await store.remove(id())
    case 'set-active': {
      if (request.id !== null && (typeof request.id !== 'string' || !uuid.test(request.id))) fail('Invalid profile id')
      return await store.setActive(request.id as string | null)
    }
    case 'mark-applied': return await store.markApplied(id())
    default: fail('Invalid content-profile action')
  }
}
