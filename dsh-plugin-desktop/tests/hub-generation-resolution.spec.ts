import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { findOverlayPackage } from '../src/package-overlay.ts'
import { HUB_GENERATION_ORIGIN, HubGenerationStore, type HubGenerationDescriptor, type HubManagedPackageSelection } from '../src/hub-generation-store.ts'
import { hubPackageIsHostOwned } from '../src/hub-base-ownership.ts'
const roots: string[] = []
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
async function fixture(version: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hub-exact-'))); roots.push(root)
  const identity = { origin: HUB_GENERATION_ORIGIN, tenantId: 'tenant', actorRef: 'actor', deviceId: 'device', profileId: 'desktop' }
  const store = new HubGenerationStore(root, identity), gen = store.generationDirectory('g1')
  const manifest = 'profile/node_modules/extension/package.json'
  mkdirSync(join(gen, 'profile/node_modules/extension'), { recursive: true, mode: 0o700 })
  mkdirSync(join(gen, 'skills'), { mode: 0o700 })
  mkdirSync(join(gen, 'profile/node_modules/react'), { mode: 0o700 })
  const coreText = '{"name":"react","version":"99.0.0"}'
  writeFileSync(join(gen, 'profile/node_modules/react/package.json'), coreText, { mode: 0o600 })
  const text = JSON.stringify({ name: 'extension', version })
  writeFileSync(join(gen, manifest), text, { mode: 0o600 })
  const value: HubGenerationDescriptor = { schemaVersion: 1, identity, generationId: 'g1', packages: [{ name: 'extension', manifest, releaseId: 'release', payloadDigest: hash('closure') }], skillsRoot: 'skills', files: { [manifest]: hash(text), 'profile/node_modules/react/package.json': hash(coreText) } }
  await store.prepare(value); await store.activate()
  const install = join(root, 'install'); mkdirSync(join(install, 'node_modules/extension'), { recursive: true })
  writeFileSync(join(install, 'package.json'), '{"name":"host"}')
  writeFileSync(join(install, 'node_modules/extension/package.json'), '{"name":"extension","version":"9.0.0"}')
  const options = { installPackageUrl: pathToFileURL(join(install, 'package.json')).href, profilePackageUrl: pathToFileURL(join(gen, 'profile/package.json')).href, managedSelection: store.managedSelection() }
  return { root, store, gen, options, value }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
describe('exact managed package selection', () => {
  it.each(['1.0.0', '9.0.0', 'not-semver'])('selects exact generation despite install 9.0.0 and managed %s', async version => {
    const { options, gen } = await fixture(version)
    expect(findOverlayPackage('extension', options)?.selected.manifestPath).toBe(join(gen, 'profile/node_modules/extension/package.json'))
    expect(findOverlayPackage('extension', options)?.install).toBeUndefined()
  })
  it('rejects a forged capability and wrong Profile rather than falling back', async () => {
    const { options, root } = await fixture('1.0.0')
    expect(() => findOverlayPackage('extension', { ...options, managedSelection: {} as HubManagedPackageSelection })).toThrow('capability')
    expect(() => findOverlayPackage('extension', { ...options, profilePackageUrl: pathToFileURL(join(root, 'other/package.json')).href })).toThrow('anchor mismatch')
  })
  it('rejects payload changes and disappearance even with an installed fallback', async () => {
    const { options, gen } = await fixture('1.0.0')
    const path = join(gen, 'profile/node_modules/extension/package.json')
    writeFileSync(path, '{"name":"extension","version":"10.0.0"}')
    expect(() => findOverlayPackage('extension', options)).toThrow('digest')
    rmSync(path)
    expect(() => findOverlayPackage('extension', options)).toThrow('file set')
  })
  it('rejects a symlink substituted after sealing', async () => {
    const { options, gen, root } = await fixture('1.0.0')
    const path = join(gen, 'profile/node_modules/extension/package.json'); rmSync(path)
    symlinkSync(join(root, 'install/node_modules/extension/package.json'), path)
    expect(() => findOverlayPackage('extension', options)).toThrow('symlink')
  })
  it('invalidates a capability when startup recovery changes active identity', async () => {
    const { options, store } = await fixture('1.0.0'); await store.recover()
    expect(() => findOverlayPackage('extension', options)).toThrow('stale')
  })
  it('protects immutable L0 names independently of caller policy', async () => {
    for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/dsh', '@dofe/dsh-sensteed-product', 'dsh-plugin-desktop', 'react', 'react-dom', 'electron']) expect(hubPackageIsHostOwned(name)).toBe(true)
    const { store, value } = await fixture('1.0.0'); await store.recover()
    await expect(store.prepare({ ...value, packages: [{ ...value.packages[0]!, name: '@deepseek-ai/cordis' }] })).rejects.toThrow('Host-owned')
  })
  it('never allows a production Profile to override an immutable L0 package', async () => {
    const { options, root } = await fixture('1.0.0')
    const base = join(root, 'install')
    mkdirSync(join(base, 'node_modules/react'), { recursive: true })
    writeFileSync(join(base, 'node_modules/react/package.json'), '{"name":"react","version":"1.0.0"}')
    expect(findOverlayPackage('react', options)?.selected.source).toBe('install')
    expect(findOverlayPackage('react', options)?.selected.version).toBe('1.0.0')
    rmSync(join(base, 'node_modules/react'), { recursive: true })
    expect(findOverlayPackage('react', options)).toBeUndefined()
  })
  it('keeps ordinary Profile version selection unchanged', async () => {
    const { options } = await fixture('1.0.0')
    const { managedSelection: _unused, ...ordinary } = options
    expect(findOverlayPackage('extension', ordinary)?.selected.source).toBe('install')
  })
})
