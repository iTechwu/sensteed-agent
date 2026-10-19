import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { calculateHubBuildManifest, readPackagedHubBuildIdentity } from '../src/hub-build-identity.ts'
import { generateHubBuildManifest } from '../scripts/generate-hub-build-manifest.mjs'
async function fixture(work: (root: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'hub-base-'))
  try { mkdirSync(join(root, 'app.asar.unpacked')); writeFileSync(join(root, 'app.asar'), 'base archive'); writeFileSync(join(root, 'app.asar.unpacked', 'native.node'), 'native base'); await work(root) }
  finally { rmSync(root, { recursive: true, force: true }) }
}
describe('precise immutable Host build identity', () => {
  it('seals actual packed and unpacked bytes without changing when external Hub generations change', async () => fixture(async root => {
    const sealed = await generateHubBuildManifest(root)
    mkdirSync(join(root, 'hub-generations')); writeFileSync(join(root, 'hub-generations', 'updated.js'), 'new plugin')
    expect((await readPackagedHubBuildIdentity(join(root, 'app.asar'), root)).hostBuildDigest).toBe(sealed.hostBuildDigest)
    expect(Object.isFrozen((await readPackagedHubBuildIdentity(join(root, 'app.asar'), root)).unpacked)).toBe(true)
  }))
  it('changes identity for archive mutation, changed native bytes and injected unpacked runtime files', async () => fixture(async root => {
    let sealed = await generateHubBuildManifest(root)
    writeFileSync(join(root, 'app.asar'), 'mutated archive')
    expect((await readPackagedHubBuildIdentity(join(root, 'app.asar'), root)).hostBuildDigest).not.toBe(sealed.hostBuildDigest)
    sealed = await generateHubBuildManifest(root); writeFileSync(join(root, 'app.asar.unpacked', 'native.node'), 'changed native')
    expect((await readPackagedHubBuildIdentity(join(root, 'app.asar'), root)).hostBuildDigest).not.toBe(sealed.hostBuildDigest)
    sealed = await generateHubBuildManifest(root); writeFileSync(join(root, 'app.asar.unpacked', 'injected.js'), 'extra')
    expect((await readPackagedHubBuildIdentity(join(root, 'app.asar'), root)).hostBuildDigest).not.toBe(sealed.hostBuildDigest)
  }))
  it('refuses directory development targets and linked base payloads', async () => fixture(async root => {
    await generateHubBuildManifest(root)
    await expect(readPackagedHubBuildIdentity(root, root)).rejects.toThrow('sealed ASAR')
    symlinkSync(join(root, 'app.asar'), join(root, 'app.asar.unpacked', 'link'))
    await expect(calculateHubBuildManifest(root)).rejects.toThrow('symlink')
  }))
})
