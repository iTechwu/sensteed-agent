import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPackageWithOptions } from '@electron/asar'
import { describe, expect, it } from 'vitest'
import {
  assertPackageSize, payloadPackageRoot, pruneHydratedSourceMaps,
  summarizePackageSize, writePackageSizeReport,
} from '../scripts/package-size.ts'

const report = (bytes: number, arch = 'x64') => summarizePackageSize([], bytes, 'win32', arch)

describe('packaged runtime size contract', () => {
  it('counts physical native payload once and keeps nested versions visible', () => {
    const result = summarizePackageSize([
      { path: 'node_modules/example/lib/index.js', bytes: 5, unpacked: false },
      { path: 'node_modules/example/bin/tool', bytes: 20, unpacked: true },
      { path: 'node_modules/other/node_modules/example/bin/tool', bytes: 30, unpacked: true },
    ], 100, 'darwin', 'arm64')
    expect(result.payloadBytes).toBe(150)
    expect(result.unpackedBytes).toBe(50)
    expect(result.largestPackages).toContainEqual({ path: 'node_modules/example', bytes: 25 })
    expect(payloadPackageRoot('node_modules/@scope/a/node_modules/@scope/b/lib/index.js'))
      .toBe('node_modules/@scope/a/node_modules/@scope/b')
  })

  it('rejects debug maps and oversized payloads while allowing two-CPU budgets', () => {
    expect(() => assertPackageSize(report(1.5 * 1024 ** 3))).not.toThrow()
    expect(() => assertPackageSize(report(1.5 * 1024 ** 3 + 1))).toThrow('budget')
    expect(() => assertPackageSize(report(2 * 1024 ** 3, 'universal'))).not.toThrow()
    expect(() => assertPackageSize(summarizePackageSize([
      { path: 'node_modules/fixture/dist/index.js.map', bytes: 30, unpacked: false },
    ], 100, 'linux', 'x64'))).toThrow('debug source maps')
  })

  it('removes hydrated source maps while retaining code, type declarations and data maps', () => {
    const root = mkdtempSync(join(tmpdir(), 'sensteed-debug-prune-'))
    try {
      for (const path of ['tool.cjs.map', 'index.d.ts.map', 'tool.cjs', 'index.d.ts', 'geography.map']) {
        writeFileSync(join(root, path), 'keep runtime')
      }
      pruneHydratedSourceMaps(root)
      expect(() => readFileSync(join(root, 'tool.cjs.map'))).toThrow()
      expect(() => readFileSync(join(root, 'index.d.ts.map'))).toThrow()
      for (const path of ['tool.cjs', 'index.d.ts', 'geography.map']) {
        expect(readFileSync(join(root, path), 'utf8')).toBe('keep runtime')
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('inventories an actual ASAR plus hydrated files without duplicating native bytes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sensteed-size-asar-'))
    try {
      const source = join(root, 'source')
      const archive = join(root, 'app.asar')
      mkdirSync(join(source, 'node_modules/fixture/bin'), { recursive: true })
      writeFileSync(join(source, 'main.js'), 'export const runtime = true')
      writeFileSync(join(source, 'node_modules/fixture/bin/tool'), 'native bytes')
      await createPackageWithOptions(source, archive, { unpack: '**/bin/tool' })
      writeFileSync(join(root, 'app.asar.unpacked/node_modules/fixture', 'hydrated.cjs'), 'added')
      const outputPath = join(root, 'size.json')
      const result = writePackageSizeReport({ archive, unpackedRoot: archive + '.unpacked',
        platform: 'darwin', arch: 'arm64', outputPath })
      expect(result.unpackedBytes).toBe(Buffer.byteLength('native bytesadded'))
      expect(result.fileCount).toBe(3)
      expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual(result)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
