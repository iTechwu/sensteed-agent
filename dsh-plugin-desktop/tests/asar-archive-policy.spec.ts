import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { disableAsarArchiveView, normalizeAsarBigIntStats, type AsarArchiveProcess } from '../src/asar-archive-policy.ts'

const root = join(tmpdir(), 'DSH Desktop', 'resources')
const moduleIn = (...segments: string[]): string => pathToFileURL(join(root, ...segments)).href

describe('Electron asar archive view', () => {
  it('normalizes virtual archive bigint metadata without breaking Stats predicates', () => {
    const stats = statSync(tmpdir())
    stats.mtimeMs = 10.125
    const normalized = normalizeAsarBigIntStats(join(root, 'app.asar', 'skills'), { bigint: true }, stats)
    expect(normalized.mode).toBe(BigInt(stats.mode))
    expect((normalized.mode as bigint) & 0o777n).toBe(BigInt(stats.mode) & 0o777n)
    expect(normalized.isDirectory()).toBe(true)
    expect(normalized.isFile()).toBe(false)
    expect(Reflect.get(normalized, 'mtimeNs')).toBe(10_125_000n)
    expect(normalized.mtime).toEqual(stats.mtime)
    expect(stats.mode).toEqual(expect.any(Number))
  })

  it('keeps native bigint stats, ordinary paths, and numeric requests unchanged', () => {
    const numeric = statSync(tmpdir())
    const bigint = statSync(tmpdir(), { bigint: true })
    const archivePath = join(root, 'app.asar', 'skills')
    expect(normalizeAsarBigIntStats(archivePath, { bigint: true }, bigint)).toBe(bigint)
    expect(normalizeAsarBigIntStats(tmpdir(), { bigint: true }, numeric)).toBe(numeric)
    expect(normalizeAsarBigIntStats(archivePath, undefined, numeric)).toBe(numeric)
    expect(normalizeAsarBigIntStats(pathToFileURL(archivePath), { bigint: true }, numeric).isDirectory()).toBe(true)
  })

  it('turns the archive view off for code shipped unpacked', () => {
    const proc: AsarArchiveProcess = {}
    expect(disableAsarArchiveView(moduleIn('app', 'lib', 'host-process-entry.js'), proc)).toBe(true)
    expect(proc.noAsar).toBe(true)
  })

  it('treats a directory that merely mentions asar as unpacked code', () => {
    const proc: AsarArchiveProcess = {}
    expect(disableAsarArchiveView(moduleIn('app', 'node_modules', 'asar-helper', 'lib', 'index.js'), proc)).toBe(true)
    expect(proc.noAsar).toBe(true)
  })

  it.each([
    ['app.asar', 'lib', 'host-process-entry.js'],
    ['app.asar.unpacked', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'],
    ['APP.ASAR', 'lib', 'desktop-cli.js'],
  ])('keeps the archive view for code loaded from %s', (...segments) => {
    const proc: AsarArchiveProcess = {}
    expect(disableAsarArchiveView(moduleIn(...segments), proc)).toBe(false)
    expect(proc.noAsar).toBeUndefined()
  })
})
