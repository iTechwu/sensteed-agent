/** Content-combination Profile store (docs/1022 §6.4). Born-from-template stays frozen: upstream template updates never mutate an existing profile. */
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicJson } from './private-files.ts'

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

  private persist(state: ContentProfilesState): ContentProfilesState {
    atomicJson(this.file, state)
    return state
  }

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
