import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { desktopPnpmStoreDir, ensureDesktopPnpmStoreDir } from '../src/profile-store-dir.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'desktop-profile-store-'))
  roots.push(home)
  const profile = join(home, 'profiles', 'desktop')
  mkdirSync(join(profile, 'node_modules'), { recursive: true })
  const metadata = join(profile, 'node_modules', '.modules.yaml')
  return { home, profile, metadata }
}

it('uses the app-local store when there is no installed store metadata', () => {
  const { home, profile } = fixture()
  expect(desktopPnpmStoreDir(home, profile)).toBe(join(home, 'pnpm-store'))
})

it.each(['yaml', 'json'])('preserves an existing store from %s metadata and rechecks it on every call', format => {
  const { home, profile, metadata } = fixture()
  const encode = format === 'json' ? JSON.stringify : stringify
  const oldStore = join(home, "用户's previous store", 'v11')
  writeFileSync(metadata, encode({ storeDir: oldStore }))
  expect(ensureDesktopPnpmStoreDir(home, profile)).toBe(oldStore)
  const newStore = join(home, 'pnpm-store', 'v11')
  writeFileSync(metadata, encode({ storeDir: newStore }))
  expect(desktopPnpmStoreDir(home, profile)).toBe(newStore)
})

it.each(['{}', 'storeDir: ./relative-store\n', 'storeDir: 123\n', 'storeDir: [broken\n', '[]', 'null', '{"storeDir":"/bad\\u0000store"}'])('falls back for missing or invalid metadata: %s', contents => {
  const { home, profile, metadata } = fixture()
  writeFileSync(metadata, contents)
  expect(desktopPnpmStoreDir(home, profile)).toBe(join(home, 'pnpm-store'))
})
