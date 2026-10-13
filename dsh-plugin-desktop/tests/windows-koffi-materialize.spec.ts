import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  dereferencePlatformPackageLinks,
  ensureHoistedPlatformPackage,
} from '../scripts/windows-koffi-runtime.ts'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'koffi-materialize-'))
  temporaryRoots.push(root)
  mkdirSync(join(root, 'node_modules', '.pnpm'), { recursive: true })
  return root
}

function writePackage(dir: string, manifest: Record<string, unknown>): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
  writeFileSync(join(dir, 'marker.txt'), 'content')
  return dir
}

function seedJunction(root: string, relativeLink: string, target: string): string {
  const link = join(root, relativeLink)
  mkdirSync(join(link, '..'), { recursive: true })
  symlinkSync(target, link, 'junction')
  return link
}

describe('platform package link dereference', () => {
  it('dereferences platform-gated junctions into real copies on win32', () => {
    const root = fixture()
    const store = join(root, 'node_modules', '.pnpm', '@img+sharp-win32-x64@0.35.3', 'node_modules', '@img', 'sharp-win32-x64')
    writePackage(store, { name: '@img/sharp-win32-x64', version: '0.35.3', os: ['win32'], cpu: ['x64'] })
    const link = seedJunction(root, 'node_modules/@img/sharp-win32-x64', store)

    const count = dereferencePlatformPackageLinks({ modulesRoot: join(root, 'node_modules'), platform: 'win32' })

    expect(count).toBe(1)
    expect(lstatSync(link).isSymbolicLink()).toBe(false)
    expect(lstatSync(link).isDirectory()).toBe(true)
    expect(existsSync(join(link, 'marker.txt'))).toBe(true)
  })

  it('descends through regular package links to reach nested platform junctions', () => {
    const root = fixture()
    // 模拟 workspace 包 fs-local：常规链接（无 os/cpu），内嵌 koffi 平台 junction。
    const fsLocal = writePackage(join(root, 'harness-fs-local'), { name: '@deepseek-ai/dsh-fs-local', version: '0.2.0' })
    const store = join(root, 'node_modules', '.pnpm', '@koromix+koffi-win32-x64@3.1.1', 'node_modules', '@koromix', 'koffi-win32-x64')
    writePackage(store, { name: '@koromix/koffi-win32-x64', version: '3.1.1', os: ['win32'], cpu: ['x64'] })
    const nested = seedJunction(root, 'node_modules/@deepseek-ai/dsh-fs-local', fsLocal)
    const nestedPlatform = seedJunction(root, 'node_modules/@deepseek-ai/dsh-fs-local/node_modules/@koromix/koffi-win32-x64', store)

    const count = dereferencePlatformPackageLinks({ modulesRoot: join(root, 'node_modules'), platform: 'win32' })

    expect(count).toBe(1)
    expect(lstatSync(nested).isSymbolicLink()).toBe(true)
    expect(lstatSync(nestedPlatform).isSymbolicLink()).toBe(false)
    expect(existsSync(join(nestedPlatform, 'marker.txt'))).toBe(true)
  })

  it('leaves links inside the .pnpm store and non-platform links untouched', () => {
    const root = fixture()
    const inStore = writePackage(join(root, 'node_modules', '.pnpm', 'koffi@3.1.5', 'node_modules', 'koffi'), { name: 'koffi', version: '3.1.5', os: ['win32'] })
    const storeLink = seedJunction(root, 'node_modules/.pnpm/other/node_modules/koffi', inStore)
    const regular = writePackage(join(root, 'node_modules', '.pnpm', 'got@14.6.6', 'node_modules', 'got'), { name: 'got', version: '14.6.6' })
    const regularLink = seedJunction(root, 'node_modules/got', regular)

    const count = dereferencePlatformPackageLinks({ modulesRoot: join(root, 'node_modules'), platform: 'win32' })

    expect(count).toBe(0)
    expect(lstatSync(storeLink).isSymbolicLink()).toBe(true)
    expect(lstatSync(regularLink).isSymbolicLink()).toBe(true)
  })

  it('is a no-op off Windows', () => {
    const root = fixture()
    const store = join(root, 'node_modules', '.pnpm', 'pkg', 'node_modules', 'pkg')
    writePackage(store, { name: 'pkg', os: ['win32'] })
    seedJunction(root, 'node_modules/pkg', store)

    expect(dereferencePlatformPackageLinks({ modulesRoot: join(root, 'node_modules'), platform: 'darwin' })).toBe(0)
  })
})

describe('hoisted platform package materialization', () => {
  it('copies the store instance to the hoisted top-level path when absent', async () => {
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

  it('reports source-missing when the virtual store has no matching package', () => {
    const root = fixture()
    expect(ensureHoistedPlatformPackage({
      desktopRoot: root,
      packageName: '@deepseek-ai/libreoffice-kit-win32-x64',
    })).toBe('source-missing')
  })
})
