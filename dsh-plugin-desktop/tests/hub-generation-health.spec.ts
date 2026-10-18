import { prepareHubHostBoot } from '../src/hub-host-boot.ts'
import { hubGenerationBootReference } from '../src/hub-generation-boot.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { HubGenerationStore, HUB_GENERATION_ORIGIN } from '../src/hub-generation-store.ts'
import { hubGenerationPatch, inspectHubGenerationLoaded } from '../src/hub-generation-health.ts'
const roots: string[] = []
async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hub-health-'))); roots.push(root)
  const store = new HubGenerationStore(root, { origin: HUB_GENERATION_ORIGIN, tenantId: '11111111-1111-4111-8111-111111111111', actorRef: 'sso:user@example.com', deviceId: '22222222-2222-4222-8222-222222222222', profileId: '33333333-3333-4333-8333-333333333333' })
  const gen = store.generationDirectory('g1'), profile = join(gen, 'profile')
  mkdirSync(join(profile, 'node_modules/example'), { recursive: true, mode: 0o700 }); mkdirSync(join(gen, 'skills/example'), { recursive: true, mode: 0o700 })
  const files: Record<string, string> = {}
  for (const [path, text] of Object.entries({ 'profile/node_modules/example/package.json': '{"name":"example","version":"1.0.0"}', 'profile/node_modules/example/index.js': 'export default 1', 'skills/example/SKILL.md': '# Example' })) {
    writeFileSync(join(gen, path), text, { mode: 0o600 }); files[path] = createHash('sha256').update(text).digest('hex')
  }
  await store.prepare({ schemaVersion: 2, identity: store.identity, generationId: 'g1', packages: [{ name: 'example', manifest: 'profile/node_modules/example/package.json', releaseId: 'release', payloadDigest: 'a'.repeat(64) }], skillsRoot: 'skills', files,
    verifiedComposition: { entries: [{ id: 'example', packageName: 'example', config: {} }], skills: [{ name: 'example', path: 'skills/example/SKILL.md', sha256: files['skills/example/SKILL.md']! }] } })
  await store.activate()
  const selection = store.managedSelection(), loader = { entries: () => [{ options: { id: 'example', name: 'example' }, disabled: false, fiber: { state: 2 } }] }
  const skills = { list: async () => [{ name: 'example', path: join(gen, 'skills/example/SKILL.md'), provider: 'hub-g1', source: 'hub' }] }
  const urls = () => [pathToFileURL(join(profile, 'node_modules/example/index.js')).href]
  return { store, profile, selection, loader, skills, urls }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
describe('Hub generation local loaded health', () => {
  it('requires active entries, observed module paths and actual skill discovery together', async () => {
    const f = await fixture()
    expect(hubGenerationPatch(f.store)).toEqual({ insert: [{ id: 'example', name: 'example', config: {} }] })
    expect(await inspectHubGenerationLoaded(f.store, f.selection, f.profile, f.loader, f.skills, 'hub-g1', f.urls)).toEqual({ generationId: 'g1', entryIds: ['example'], skillNames: ['example'] })
    expect(f.store.readState().phase).toBe('verifying')
  })
  it('reconstructs the real Host boot patch and rejects collisions before loading', async () => {
    const f = await fixture(), reference = hubGenerationBootReference(f.store, f.profile)
    const boot = prepareHubHostBoot({ reference, expectedIdentity: f.store.identity, skillProviderName: 'hub-g1' }, f.profile, ['desktop-shell'])
    expect(boot.patch.insert[0]?.name).toBe('example')
    expect(boot.generationId).toBe('g1')
    expect(() => prepareHubHostBoot({ reference, expectedIdentity: f.store.identity, skillProviderName: 'hub-other' }, f.profile, [])).toThrow('provider identity')
    expect(() => prepareHubHostBoot({ reference, expectedIdentity: f.store.identity, skillProviderName: 'hub-g1' }, f.profile, ['example'])).toThrow('collides')
  })
  it('does not treat boot success, missing modules or the wrong skill provider as health', async () => {
    const f = await fixture()
    await expect(inspectHubGenerationLoaded(f.store, f.selection, f.profile, { entries: () => [] }, f.skills, 'hub-g1', f.urls)).rejects.toThrow('missing')
    await expect(inspectHubGenerationLoaded(f.store, f.selection, f.profile, f.loader, f.skills, 'hub-g1', () => [])).rejects.toThrow('module path')
    await expect(inspectHubGenerationLoaded(f.store, f.selection, f.profile, f.loader, f.skills, 'wrong-provider', f.urls)).rejects.toThrow('provenance')
    const inactive = { entries: () => [{ options: { id: 'example', name: 'example' }, disabled: false, fiber: { state: 0 } }] }
    await expect(inspectHubGenerationLoaded(f.store, f.selection, f.profile, inactive, f.skills, 'hub-g1', f.urls)).rejects.toThrow('not active')
  })
})
