/** Content Profile store (docs/1022 §6.4): 唯一命名、出生冻结、active 语义与持久化。 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ContentProfileStore,
  recordInstantiatedProfile,
  uniqueProfileName,
  type ContentProfileInstantiateInput,
} from '../src/content-profiles.ts'

function store(): ContentProfileStore {
  return new ContentProfileStore(join(mkdtempSync(join(tmpdir(), 'content-profiles-')), 'content-profiles.json'))
}

const templateInput: ContentProfileInstantiateInput = {
  templateId: '11111111-1111-4111-8111-111111111111',
  templateRevision: 3,
  items: [
    { kind: 'skill', itemId: '66666666-6666-4666-8666-666666666666', enabled: true },
    { kind: 'plugin', itemId: '77777777-7777-4777-8777-777777777777', enabled: false },
  ],
  mcpEndpoints: [{ service: 'knowledge', domain: 'knowledge', version: '1.0.0', enabled: true }],
  skippedItems: [{ item: { kind: 'plugin', identity: '@x/z', version: '1.0.0', enabled: true }, reason: '未发布到 stable 渠道' }],
}

describe('content profile store', () => {
  it('creates from an instantiate result with frozen template provenance and summary', async () => {
    const profiles = store()
    const profile = await profiles.create('内容创作', templateInput)
    expect(profile.name).toBe('内容创作')
    expect(profile.sourceTemplateId).toBe(templateInput.templateId)
    expect(profile.sourceTemplateRevision).toBe(3)
    expect(profile.summary).toEqual({ skills: 1, plugins: 1, mcpEndpoints: 1, skipped: 1 })
    expect(profile.items).toHaveLength(3)
    expect(profile.skippedItems[0]?.reason).toBe('未发布到 stable 渠道')
    expect(profile.lastAppliedAt).toBeUndefined()
  })

  it('keeps born state frozen when the same template later changes upstream', async () => {
    const profiles = store()
    const born = await profiles.create('内容创作', templateInput)
    const changed = await await profiles.create('另一模板', { ...templateInput, templateRevision: 9, items: [] })
    expect(born.items).toHaveLength(3)
    expect(changed.items).toHaveLength(1)
    expect(profiles.get(born.id)?.items).toHaveLength(3)
  })

  it('uniquifies names with 副本 and ordinal suffixes across create and rename', async () => {
    expect(uniqueProfileName([], '工作')).toBe('工作')
    expect(uniqueProfileName(['工作'], '工作')).toBe('工作副本')
    expect(uniqueProfileName(['工作', '工作副本'], '工作')).toBe('工作副本2')
    const profiles = store()
    await profiles.create('工作', templateInput)
    const second = await await profiles.create('工作', templateInput)
    expect(second.name).toBe('工作副本')
    const renamed = await profiles.rename(second.id, '工作')
    // 自身旧名不占用命名空间：改名回原集合中的同名候选时让位给既有名，落回空闲名
    expect(renamed?.name).toBe('工作副本')
  })

  it('tracks activeId, clears it on removal, and stamps applied receipts', async () => {
    const profiles = store()
    const first = await profiles.create('自定义', templateInput)
    const second = await profiles.create('模板', templateInput)
    expect(profiles.activeId()).toBeNull()
    expect(await profiles.setActive(first.id)).toBe(true)
    expect(await profiles.setActive(second.id)).toBe(true)
    expect(profiles.activeId()).toBe(second.id)
    expect(await profiles.setActive('nope')).toBe(false)
    await profiles.markApplied(second.id)
    expect(profiles.get(second.id)?.lastAppliedAt).toBeDefined()
    expect(await profiles.remove(second.id)).toBe(true)
    expect(profiles.get(second.id)).toBeUndefined()
    expect(profiles.activeId()).toBeNull()
    expect(await profiles.remove(second.id)).toBe(false)
  })

  it('round-trips through disk and falls back to an empty state on corrupt files', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'content-profiles-')), 'content-profiles.json')
    const profiles = new ContentProfileStore(file)
    const created = await profiles.create('内容创作', templateInput)
    await profiles.setActive(created.id)
    await profiles.flush()
    const reopened = new ContentProfileStore(file)
    expect(reopened.activeId()).toBe(created.id)
    expect(reopened.get(created.id)?.summary).toEqual({ skills: 1, plugins: 1, mcpEndpoints: 1, skipped: 1 })
    writeFileSync(file, '{not json')
    expect(new ContentProfileStore(file).load().profiles).toEqual([])
  })
})

describe('content profile store concurrency', () => {
  it('serializes concurrent creates without losing updates', async () => {
    const profiles = store()
    const created = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        profiles.create(`并发${index}`, { ...templateInput, templateRevision: index + 1 })),
    )
    await profiles.flush()
    expect(new Set(created.map((profile) => profile.id)).size).toBe(12)
    const listed = profiles.list()
    expect(listed).toHaveLength(12)
    // 唯一名在串行事务下保持无碰撞
    expect(new Set(listed.map((profile) => profile.name)).size).toBe(12)
  })
})

describe('recordInstantiatedProfile (manager instantiate 本地落库)', () => {
  it('creates the content profile and marks it active in one step', async () => {
    const profiles = store()
    const shape = {
      templateId: templateInput.templateId,
      revision: templateInput.templateRevision,
      items: templateInput.items,
      mcpEndpoints: templateInput.mcpEndpoints,
      skippedItems: templateInput.skippedItems,
    }
    const created = await recordInstantiatedProfile(profiles, '内容创作', shape)
    expect(created.summary).toEqual({ skills: 1, plugins: 1, mcpEndpoints: 1, skipped: 1 })
    expect(profiles.activeId()).toBe(created.id)
    expect(profiles.list()).toHaveLength(1)
  })
})
