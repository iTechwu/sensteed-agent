import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { materializeNestedKoffiPlatformPackages } from '../scripts/windows-koffi-runtime.ts'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'koffi-materialize-'))
  temporaryRoots.push(root)
  const modules = join(root, 'node_modules')
  // Canonical 3.1.1 platform copy: the root alias dependency.
  const alias = join(modules, 'koffi-win32-x64-3-1-1')
  mkdirSync(join(alias, 'prebuilds'), { recursive: true })
  writeFileSync(join(alias, 'package.json'), JSON.stringify({ name: '@koromix/koffi-win32-x64', version: '3.1.1' }))
  writeFileSync(join(alias, 'index.js'), 'module.exports = {}')
  writeFileSync(join(alias, 'prebuilds', 'koffi.node'), 'native')
  return root
}

function seedNestedJunction(root: string, pkg: string, target: string): string {
  const nested = join(root, 'node_modules', '@deepseek-ai', pkg, 'node_modules', '@koromix', 'koffi-win32-x64')
  mkdirSync(join(nested, '..'), { recursive: true })
  symlinkSync(target, nested, 'junction')
  return nested
}

describe('nested koffi platform materialization', () => {
  it('replaces nested junctions with dereferenced alias copies on win32', () => {
    const root = fixture()
    const store = join(root, 'store-3-1-1')
    mkdirSync(store, { recursive: true })
    writeFileSync(join(store, 'stale.js'), 'from store')
    const nested = seedNestedJunction(root, 'dsh-fs-local', store)

    const count = materializeNestedKoffiPlatformPackages({ desktopRoot: root, platform: 'win32' })

    expect(count).toBe(1)
    expect(lstatSync(nested).isSymbolicLink()).toBe(false)
    expect(lstatSync(nested).isDirectory()).toBe(true)
    // Content comes from the root alias copy, not the junction target.
    expect(require(join(nested, 'package.json')).version).toBe('3.1.1')
    expect(require('node:fs').existsSync(join(nested, 'prebuilds', 'koffi.node'))).toBe(true)
    expect(require('node:fs').existsSync(join(nested, 'stale.js'))).toBe(false)
  })

  it('materializes every workspace consumer and skips real directories', () => {
    const root = fixture()
    const store = join(root, 'store')
    mkdirSync(store, { recursive: true })
    seedNestedJunction(root, 'dsh-fs-local', store)
    seedNestedJunction(root, 'dsh-subprocess-local', store)
    // A real nested directory must survive untouched.
    const realNested = join(root, 'node_modules', '@deepseek-ai', 'dsh-win32-process', 'node_modules', '@koromix', 'koffi-win32-x64')
    mkdirSync(realNested, { recursive: true })
    writeFileSync(join(realNested, 'real.txt'), 'keep')

    const count = materializeNestedKoffiPlatformPackages({ desktopRoot: root, platform: 'win32' })

    expect(count).toBe(2)
    expect(require('node:fs').existsSync(join(realNested, 'real.txt'))).toBe(true)
    expect(lstatSync(realNested).isSymbolicLink()).toBe(false)
  })

  it('is a no-op off Windows and when no scoped packages nest the platform package', () => {
    const root = fixture()
    const store = join(root, 'store')
    mkdirSync(store, { recursive: true })
    seedNestedJunction(root, 'dsh-fs-local', store)

    expect(materializeNestedKoffiPlatformPackages({ desktopRoot: root, platform: 'darwin' })).toBe(0)
    expect(lstatSync(join(root, 'node_modules', '@deepseek-ai', 'dsh-fs-local', 'node_modules', '@koromix', 'koffi-win32-x64')).isSymbolicLink()).toBe(true)

    const empty = mkdtempSync(join(tmpdir(), 'koffi-empty-'))
    temporaryRoots.push(empty)
    expect(materializeNestedKoffiPlatformPackages({ desktopRoot: empty, platform: 'win32' })).toBe(0)
  })
})

describe('hoisted platform package materialization', () => {
  it('copies the store instance to the hoisted top-level path when absent', async () => {
    const { ensureHoistedPlatformPackage } = await import('../scripts/windows-koffi-runtime.ts')
    const root = fixture()
    const storePackage = join(root, 'node_modules', '.pnpm', '@deepseek-ai+libreoffice-kit-win32-x64@0.1.5', 'node_modules', '@deepseek-ai', 'libreoffice-kit-win32-x64')
    mkdirSync(storePackage, { recursive: true })
    writeFileSync(join(storePackage, 'package.json'), '{"name":"@deepseek-ai/libreoffice-kit-win32-x64","version":"0.1.5"}')
    writeFileSync(join(storePackage, 'build-identity.mjs'), 'identity')

    const outcome = ensureHoistedPlatformPackage({
      desktopRoot: root,
      packageName: '@deepseek-ai/libreoffice-kit-win32-x64',
    })

    expect(outcome).toBe('materialized')
    const hoisted = join(root, 'node_modules', '@deepseek-ai', 'libreoffice-kit-win32-x64')
    expect(existsSync(join(hoisted, 'build-identity.mjs'))).toBe(true)
    // Idempotent: a second run finds the hoisted copy already present.
    expect(ensureHoistedPlatformPackage({
      desktopRoot: root,
      packageName: '@deepseek-ai/libreoffice-kit-win32-x64',
    })).toBe('present')
  })

  it('reports source-missing when the virtual store has no matching package', async () => {
    const { ensureHoistedPlatformPackage } = await import('../scripts/windows-koffi-runtime.ts')
    const root = fixture()
    mkdirSync(join(root, 'node_modules', '.pnpm'), { recursive: true })
    expect(ensureHoistedPlatformPackage({
      desktopRoot: root,
      packageName: '@deepseek-ai/libreoffice-kit-win32-x64',
    })).toBe('source-missing')
  })
})
