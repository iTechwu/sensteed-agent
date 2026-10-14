/** Temporary materialized payloads for Next descriptor and file policy tests. */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DESKTOP_RUNTIME_FILE, physicalPayload, sealPayload, type DesktopRuntimeDescriptor, type NextRelease, type NextRuntimeTarget } from '../src/runtime-tree.ts'

/**
 * Write a package fixture with explicit runtime exports.
 * @param modules - Owning node_modules directory.
 * @param name - Package name.
 * @param fields - Manifest fields.
 * @param source - ESM entry contents.
 * @returns Installed package directory.
 */
export function writePackage(modules: string, name: string, fields: Record<string, unknown> = {}, source = 'export const identity = {}\n'): string {
  const path = join(modules, name)
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', exports: './index.js', ...fields }))
  writeFileSync(join(path, 'index.js'), source)
  return path
}

/** Release facts every fixture payload declares. */
export const FIXTURE_RELEASE: NextRelease = { schemaVersion: 1, version: '2.0.0-next', dshVersion: '1.0.0', electronVersion: '44.0.0', pnpmVersion: '11.8.0' }

/** Target every fixture payload declares. */
export const FIXTURE_TARGET: NextRuntimeTarget = { platform: process.platform, archs: [process.arch] }

/** Shared packages every fixture payload carries. */
export const FIXTURE_SHARED = ['@deepseek-ai/dsh', '@deepseek-ai/cordis', '@deepseek-ai/dsh-base', 'pnpm']

/**
 * Write a minimal Next application: the manifest, shell code and shared packages.
 * @param root - New application directory.
 * @param release - Release facts; the dsh package takes `dshVersion`.
 */
export function writeApplication(root: string, release = FIXTURE_RELEASE): void {
  const modules = join(root, 'node_modules')
  for (const name of FIXTURE_SHARED) {
    writePackage(modules, name, { version: name === '@deepseek-ai/dsh' ? release.dshVersion : name === 'pnpm' ? release.pnpmVersion : '1.0.0' })
  }
  mkdirSync(join(root, 'lib'), { recursive: true })
  writeFileSync(join(root, 'lib', 'main.js'), 'export {}\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-desktop-next', version: release.version, type: 'module',
    dependencies: Object.fromEntries(FIXTURE_SHARED.map(name => [name, '*'])) }) + '\n')
}

/**
 * Seal a minimal unpacked Next application with its descriptor inside the directory.
 * @param root - New application directory.
 * @param release - Release facts; the dsh package takes `dshVersion`.
 * @param target - Platform and architectures recorded in the descriptor.
 * @returns Sealed descriptor.
 */
export function runtimeFixture(root: string, release = FIXTURE_RELEASE, target = FIXTURE_TARGET): DesktopRuntimeDescriptor {
  writeApplication(root, release)
  return sealPayload(physicalPayload(root), join(root, DESKTOP_RUNTIME_FILE), release, FIXTURE_SHARED, target)
}
