/** Host-owned content-combination Profile store (docs/1022 §6.4).
 * 双壳（stable desktop 与 NEXT）共用：渲染进程只发意图，存储与作用域都在 Host 进程，
 * 落盘在 harness profile 目录（与 generation identity 的 profilePath 同族）。 */
/** Content-combination Profile store (docs/1022 §6.4). Born-from-template stays frozen: upstream template updates never mutate an existing profile. */
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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
    if (this.cached) return this.cached
    if (!existsSync(this.file)) return { ...EMPTY, profiles: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as ContentProfilesState
      if (parsed?.version !== 1 || !Array.isArray(parsed.profiles) || typeof parsed.activeId !== 'string' && parsed.activeId !== null) return { ...EMPTY, profiles: [] }
      this.cached = parsed
      return parsed
    } catch {
      return { ...EMPTY, profiles: [] }
    }
  }

  /** 进程内镜像：load 优先读镜像，避免在途原子写造成读写撕裂。 */
  private cached: ContentProfilesState | undefined
  private writeChain: Promise<void> = Promise.resolve()
  private persist(state: ContentProfilesState): ContentProfilesState {
    this.cached = state
    // 串行化进程内写者；进程外由 generation 维护锁约束安装类写者。
    this.writeChain = this.writeChain
      .then(() => withFileLock(this.file, async () => {
        await writeFileAtomic(this.file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
      }))
      .catch(() => {})
    return state
  }
  /** 等待在途持久化落盘（测试与有序关停用）。 */
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
  create(name: string, input: ContentProfileInstantiateInput): ContentProfile {
    const state = this.load()
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
    return this.persist({ ...state, profiles: [...state.profiles, profile] }).profiles.at(-1)!
  }

  createCustom(name: string, items: readonly ContentProfileItem[]): ContentProfile {
    const state = this.load()
    const profile: ContentProfile = {
      id: randomUUID(),
      name: uniqueProfileName(state.profiles.map((existing) => existing.name), name),
      summary: summarize(items, 0),
      items: [...items],
      skippedItems: [],
      createdAt: new Date().toISOString(),
    }
    return this.persist({ ...state, profiles: [...state.profiles, profile] }).profiles.at(-1)!
  }

  rename(id: string, name: string): ContentProfile | undefined {
    const state = this.load()
    const profiles = state.profiles.map((profile) => profile.id === id
      ? { ...profile, name: uniqueProfileName(state.profiles.filter((other) => other.id !== id).map((other) => other.name), name) }
      : profile)
    return this.persist({ ...state, profiles }).profiles.find((profile) => profile.id === id)
  }

  remove(id: string): boolean {
    const state = this.load()
    if (!state.profiles.some((profile) => profile.id === id)) return false
    return !this.persist({
      ...state,
      activeId: state.activeId === id ? null : state.activeId,
      profiles: state.profiles.filter((profile) => profile.id !== id),
    }).profiles.some((profile) => profile.id === id)
  }

  setActive(id: string | null): boolean {
    const state = this.load()
    if (id !== null && !state.profiles.some((profile) => profile.id === id)) return false
    this.persist({ ...state, activeId: id })
    return true
  }

  /** 应用完成回执；入口与阶段由调用方的 apply 管线驱动。 */
  markApplied(id: string, appliedAt = new Date().toISOString()): ContentProfile | undefined {
    const state = this.load()
    const profiles = state.profiles.map((profile) => profile.id === id
      ? { ...profile, lastAppliedAt: appliedAt }
      : profile)
    return this.persist({ ...state, profiles }).profiles.find((profile) => profile.id === id)
  }
}

/** 默认落盘位置由调用方用 data-directory 解析后传入；此处仅提供文件名约定。 */
export const CONTENT_PROFILES_FILENAME = 'content-profiles.json'
export const contentProfilesFile = (home: string): string => join(home, CONTENT_PROFILES_FILENAME)

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

/** 纯分发便于单测；注册壳只做 sender 校验与 store 装配。 */
export function handleContentProfilesRequest(
  store: ContentProfileStore,
  raw: unknown,
): unknown {
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
      return store.create(profileName(request.name), {
        templateId: request.templateId,
        templateRevision: request.templateRevision,
        items: (items as { kind: 'skill' | 'plugin'; itemId: string; enabled: boolean }[]).map(item => ({ ...item, itemId: itemId(item.itemId) })),
        mcpEndpoints: mcpEndpoints.map(mcpEndpoint),
        skippedItems: skippedItems as { item: unknown; reason: string }[],
      })
    }
    case 'create-custom': {
      const items = request.items
      if (!Array.isArray(items) || items.length < 1 || items.length > 64) fail('Invalid profile items')
      const validated: ContentProfileItem[] = items.map((item): ContentProfileItem => {
        const entry = item as Record<string, unknown>
        if (entry.kind === 'mcp.endpoint') return mcpEndpoint(entry)
        if ((entry.kind !== 'skill' && entry.kind !== 'plugin')
          || typeof entry.itemId !== 'string' || !uuid.test(entry.itemId)
          || typeof entry.enabled !== 'boolean') fail('Invalid profile item')
        return { kind: entry.kind, itemId: entry.itemId, enabled: entry.enabled }
      })
      return store.createCustom(profileName(request.name), validated)
    }
    case 'rename': return store.rename(id(), profileName(request.name))
    case 'remove': return store.remove(id())
    case 'set-active': {
      if (request.id !== null && (typeof request.id !== 'string' || !uuid.test(request.id))) fail('Invalid profile id')
      return store.setActive(request.id as string | null)
    }
    case 'mark-applied': return store.markApplied(id())
    default: fail('Invalid content-profile action')
  }
}
