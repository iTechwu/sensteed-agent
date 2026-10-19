import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HUB_GENERATION_ORIGIN, HubGenerationStore, type HubGenerationDescriptor, type HubGenerationIdentity } from '../src/hub-generation-store.ts'

const roots: string[] = []
const owner: HubGenerationIdentity = { origin: HUB_GENERATION_ORIGIN, tenantId: '11111111-1111-4111-8111-111111111111', actorRef: 'actor-a', deviceId: '22222222-2222-4222-8222-222222222222', profileId: '33333333-3333-4333-8333-333333333333' }
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hub-generation-'))); roots.push(root)
  // tmpdir may itself be a platform alias; use a canonical private root.
  const store = new HubGenerationStore(root, owner)
  return { root, store }
}
function stage(store: HubGenerationStore, generationId: string): HubGenerationDescriptor {
  const root = store.generationDirectory(generationId)
  mkdirSync(root, { mode: 0o700 })
  mkdirSync(join(root, 'profile'), { mode: 0o700 })
  mkdirSync(join(root, 'profile', 'node_modules'), { mode: 0o700 })
  mkdirSync(join(root, 'profile', 'node_modules', 'extension'), { mode: 0o700 })
  mkdirSync(join(root, 'skills'), { mode: 0o700 })
  const files: Record<string, string> = {}
  for (const [path, text] of Object.entries({ 'profile/package.json': '{"name":"profile"}', 'profile/node_modules/extension/package.json': '{"name":"extension","version":"1.0.0"}', 'skills/SKILL.md': '# test' })) {
    writeFileSync(join(root, path), text, { mode: 0o600 }); files[path] = digest(text)
  }
  return { schemaVersion: 1, identity: owner, generationId, packages: [{ name: 'extension', manifest: 'profile/node_modules/extension/package.json', releaseId: 'release-a', payloadDigest: digest('signed closure evidence') }], skillsRoot: 'skills', files }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
describe('Hub generation local transaction', () => {
  it('keeps plugin and skill files in one sealed descriptor, pending until activation', async () => {
    const { store } = fixture(); const value = stage(store, 'g1')
    expect(store.readState().active).toBeNull()
    await store.prepare(value)
    expect(store.activeDescriptor()).toBeUndefined()
    expect(store.readState().phase).toBe('prepared')
    await store.activate()
    expect(store.activeDescriptor()).toEqual(value)
    await store.markHealthy('g1')
    expect(store.readState()).toMatchObject({ phase: 'stable', revision: 3, active: { generationId: 'g1' }, previous: null })
    await expect(store.prepare(value)).rejects.toThrow('already sealed')
  })
  it('recovers an unconfirmed first activation to base-only state', async () => {
    const { store, root } = fixture(); await store.prepare(stage(store, 'g1')); await store.activate()
    const recovered = new HubGenerationStore(root, owner)
    await recovered.recover()
    expect(recovered.readState()).toMatchObject({ phase: 'stable', active: null, previous: null })
  })
  it('recovers a failed upgrade to the exact previous healthy generation', async () => {
    const { store, root } = fixture()
    await store.prepare(stage(store, 'g1')); await store.activate(); await store.markHealthy('g1')
    await store.prepare(stage(store, 'g2')); await store.activate()
    expect(store.readState()).toMatchObject({ active: { generationId: 'g2' }, previous: { generationId: 'g1' } })
    await new HubGenerationStore(root, owner).recover()
    expect(store.activeDescriptor()?.generationId).toBe('g1')
  })
  it('serializes competing prepares and refuses out-of-order health', async () => {
    const { store } = fixture(); const a = stage(store, 'g1'), b = stage(store, 'g2')
    const results = await Promise.allSettled([store.prepare(a), store.prepare(b)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    await expect(store.markHealthy('g1')).rejects.toThrow('health')
    await expect(store.rollback()).rejects.toThrow('no unconfirmed')
  })
  it('rejects file mutation, missing and undeclared files before activation', async () => {
    const { store } = fixture(); const value = stage(store, 'g1'); await store.prepare(value)
    writeFileSync(join(store.generationDirectory('g1'), 'skills/SKILL.md'), '# changed')
    await expect(store.activate()).rejects.toThrow('digest')
    expect(store.readState().phase).toBe('prepared')
  })
  it('rejects descriptor mutation and preserves previous state', async () => {
    const { store } = fixture(); await store.prepare(stage(store, 'g1'))
    writeFileSync(join(store.generationDirectory('g1'), 'descriptor.json'), '{}')
    await expect(store.activate()).rejects.toThrow('descriptor tampering')
    expect(store.readState().active).toBeNull()
  })
  it('refuses rollback to a tampered previous environment', async () => {
    const { store } = fixture(); await store.prepare(stage(store, 'g1')); await store.activate(); await store.markHealthy('g1')
    await store.prepare(stage(store, 'g2')); await store.activate()
    rmSync(join(store.generationDirectory('g1'), 'skills/SKILL.md'))
    await expect(store.recover()).rejects.toThrow('file set')
    expect(store.readState().active?.generationId).toBe('g2')
  })
  it('rejects foreign identity, unknown keys, traversal and colliding paths', async () => {
    const { store } = fixture(); const value = stage(store, 'g1')
    await expect(store.prepare({ ...value, identity: { ...owner, profileId: '44444444-4444-4444-8444-444444444444' } })).rejects.toThrow('identity mismatch')
    await expect(store.prepare({ ...value, extra: true } as HubGenerationDescriptor)).rejects.toThrow('fields')
    expect(() => store.generationDirectory('../escape')).toThrow('token')
    await expect(store.prepare({ ...value, skillsRoot: '../skills' })).rejects.toThrow('relative path')
    await expect(store.prepare({ ...value, files: { ...value.files, 'skills/skill.md': digest('x') } })).rejects.toThrow('colliding')
  })
  it('rejects symlink payloads and private metadata links, including dangling links', async () => {
    const { store } = fixture(); const value = stage(store, 'g1')
    const skill = join(store.generationDirectory('g1'), 'skills/SKILL.md')
    rmSync(skill); symlinkSync('/missing-hub-audit-target', skill)
    await expect(store.prepare(value)).rejects.toThrow('symlink')
    const state = join(store.directory, 'state.json'); symlinkSync('/missing-hub-audit-target', state)
    expect(() => store.readState()).toThrow('symlink')
  })
  it('bounds metadata and rejects public permissions on POSIX', async () => {
    const { store } = fixture()
    const path = join(store.directory, 'state.json')
    writeFileSync(path, ' '.repeat(1024 * 1024 + 1), { mode: 0o600 })
    expect(() => store.readState()).toThrow('oversized')
    if (process.platform !== 'win32') { chmodSync(path, 0o644); expect(() => store.readState()).toThrow('private') }
  })
  it('rejects undeclared files, nested ancestor links and stale recovery revisions', async () => {
    const { store, root } = fixture(); const value = stage(store, 'g1')
    writeFileSync(join(store.generationDirectory('g1'), 'extra'), 'x', { mode: 0o600 })
    await expect(store.prepare(value)).rejects.toThrow('digest')
    rmSync(join(store.generationDirectory('g1'), 'extra'))
    await store.prepare(value); await store.activate()
    await expect(store.rollback(1)).rejects.toThrow('state changed')
    const outside = join(root, 'outside'); mkdirSync(outside, { mode: 0o700 })
    const skills = join(store.generationDirectory('g1'), 'skills')
    rmSync(skills, { recursive: true }); symlinkSync(outside, skills)
    expect(() => store.activeDescriptor()).toThrow('symlink')
  })
  it('seals v2 composition only for declared managed packages and exact skill files', async () => {
    const { store } = fixture(); const value = stage(store, 'g1')
    mkdirSync(join(store.generationDirectory('g1'), 'skills/example'), { mode: 0o700 })
    writeFileSync(join(store.generationDirectory('g1'), 'skills/example/SKILL.md'), '# example', { mode: 0o600 })
    const v2: HubGenerationDescriptor = { ...value, schemaVersion: 2, suppressedPackages: ['removed-plugin'], suppressedSkills: ['removed-skill'], files: { ...value.files, 'skills/example/SKILL.md': digest('# example') }, verifiedComposition: {
      entries: [{ id: 'example', packageName: 'extension', config: {} }], skills: [{ name: 'example', path: 'skills/example/SKILL.md', sha256: digest('# example') }] } }
    await expect(store.prepare({ ...v2, verifiedComposition: { ...v2.verifiedComposition!, entries: [{ id: 'example', packageName: 'untracked', config: {} }] } })).rejects.toThrow('outside managed')
    await expect(store.prepare({ ...v2, verifiedComposition: { ...v2.verifiedComposition!, skills: [{ name: 'example', path: 'skills/example/SKILL.md', sha256: 'a'.repeat(64) }] } })).rejects.toThrow('verified file set')
    await store.prepare(v2); await store.activate(); expect(store.activeDescriptor()?.verifiedComposition?.entries).toHaveLength(1); expect(store.activeDescriptor()).toMatchObject({suppressedPackages:['removed-plugin'],suppressedSkills:['removed-skill']})
  })
  it('does not reuse another profile scope and detects state scope tampering', async () => {
    const { store, root } = fixture(); await store.prepare(stage(store, 'g1'))
    const other = new HubGenerationStore(root, { ...owner, profileId: '44444444-4444-4444-8444-444444444444' })
    expect(other.directory).not.toBe(store.directory); expect(other.readState().pending).toBeNull()
    const path = join(store.directory, 'state.json'), state = JSON.parse(readFileSync(path, 'utf8'))
    writeFileSync(path, JSON.stringify({ ...state, scope: '0'.repeat(64) }))
    expect(() => store.readState()).toThrow('state identity')
  })
})
