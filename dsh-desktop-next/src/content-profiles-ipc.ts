/** Content-combination Profile IPC (docs/1022 §6.4). Renderer sends intents; the Host owns storage, paths and scoping. */
import type { ContentProfileStore, ContentProfileItem } from './content-profiles.ts'

export type ContentProfilesRequest =
  | { action: 'list' }
  | { action: 'active' }
  | { action: 'create'; name: string; templateId: string; templateRevision: number;
      items: { kind: 'skill' | 'plugin'; itemId: string; enabled: boolean }[]
      mcpEndpoints: { service: string; domain: string; version: string; enabled: boolean }[]
      skippedItems: { item: unknown; reason: string }[] }
  | { action: 'create-custom'; name: string; items: ContentProfileItem[] }
  | { action: 'rename'; id: string; name: string }
  | { action: 'remove'; id: string }
  | { action: 'set-active'; id: string | null }
  | { action: 'mark-applied'; id: string }

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
