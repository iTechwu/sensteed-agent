/** Content Profile IPC 分发：意图校验与存储动作（docs/1022 §6.4）。 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { handleContentProfilesRequest } from '../src/content-profiles.ts'
import { ContentProfileStore } from '../src/content-profiles.ts'

function store(): ContentProfileStore {
  return new ContentProfileStore(join(mkdtempSync(join(tmpdir(), 'content-profiles-ipc-')), 'content-profiles.json'))
}

const validCreate = {
  action: 'create', name: '内容创作',
  templateId: '11111111-1111-4111-8111-111111111111', templateRevision: 3,
  items: [{ kind: 'skill', itemId: '66666666-6666-4666-8666-666666666666', enabled: true }],
  mcpEndpoints: [{ service: 'knowledge', domain: 'knowledge', version: '1.0.0', enabled: true }],
  skippedItems: [{ item: { kind: 'plugin', identity: '@x/z' }, reason: '未发布到 stable 渠道' }],
}

describe('content profiles ipc dispatch', () => {
  it('creates from an instantiate result and lists profiles', () => {
    const profiles = store()
    const created = handleContentProfilesRequest(profiles, validCreate) as { id: string; summary: { skills: number; mcpEndpoints: number; skipped: number } }
    expect(created.summary).toEqual({ skills: 1, plugins: 0, mcpEndpoints: 1, skipped: 1 })
    expect(handleContentProfilesRequest(profiles, { action: 'list' })).toHaveLength(1)
    expect(handleContentProfilesRequest(profiles, { action: 'active' })).toBeNull()
  })

  it('rejects malformed intents without touching storage', () => {
    const profiles = store()
    expect(() => handleContentProfilesRequest(profiles, { ...validCreate, name: '' })).toThrow('Invalid profile name')
    expect(() => handleContentProfilesRequest(profiles, { ...validCreate, name: '名'.repeat(25) })).toThrow('Invalid profile name')
    expect(() => handleContentProfilesRequest(profiles, { ...validCreate, templateId: 'not-a-uuid' })).toThrow()
    expect(() => handleContentProfilesRequest(profiles, { ...validCreate, items: [{ kind: 'skill', itemId: 'nope', enabled: true }] })).toThrow()
    expect(() => handleContentProfilesRequest(profiles, { ...validCreate, mcpEndpoints: [{ service: 'Knowledge', domain: 'knowledge', version: '1.0.0', enabled: true }] })).toThrow()
    expect(() => handleContentProfilesRequest(profiles, { action: 'nope' })).toThrow('Invalid content-profile action')
    expect(handleContentProfilesRequest(profiles, { action: 'list' })).toHaveLength(0)
  })

  it('supports rename, activate and applied receipts through the same dispatch', () => {
    const profiles = store()
    const created = handleContentProfilesRequest(profiles, validCreate) as { id: string }
    expect((handleContentProfilesRequest(profiles, { action: 'rename', id: created.id, name: '改名' }) as { name: string }).name).toBe('改名')
    expect(handleContentProfilesRequest(profiles, { action: 'set-active', id: created.id })).toBe(true)
    expect(handleContentProfilesRequest(profiles, { action: 'active' })).toBe(created.id)
    expect((handleContentProfilesRequest(profiles, { action: 'mark-applied', id: created.id }) as { lastAppliedAt: string }).lastAppliedAt).toBeDefined()
    expect(handleContentProfilesRequest(profiles, { action: 'remove', id: created.id })).toBe(true)
    expect(handleContentProfilesRequest(profiles, { action: 'active' })).toBeNull()
    expect(() => handleContentProfilesRequest(profiles, { action: 'set-active', id: 'nope' })).toThrow()
  })
})
