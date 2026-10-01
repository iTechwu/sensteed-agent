import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readDesktopProfileClosure,
  verifyDesktopProfileClosure,
  type DesktopProfileClosure,
} from '../src/profile-closure.ts'

const dirs: string[] = []

function sealedAnchor(body: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-profile-closure-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'lib', 'profile-closure.json'), JSON.stringify(body))
  return join(dir, 'package.json')
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

const CLOSURE: DesktopProfileClosure = {
  schemaVersion: 1,
  desktopVersion: '2.0.11-beta.18',
  dshVersion: '0.2.0-rc.2',
  packages: { '@deepseek-ai/dsh': '0.2.0-rc.2', '@deepseek-ai/dsh-agent': '0.2.0-rc.2' },
}

describe('desktop profile closure manifest', () => {
  it('degrades to undefined for a missing or malformed manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-profile-closure-'))
    dirs.push(dir)
    expect(readDesktopProfileClosure(join(dir, 'package.json'))).toBeUndefined()
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'lib', 'profile-closure.json'), '{"schemaVersion":1}')
    expect(readDesktopProfileClosure(join(dir, 'package.json'))).toBeUndefined()
    writeFileSync(join(dir, 'lib', 'profile-closure.json'), 'not json')
    expect(readDesktopProfileClosure(join(dir, 'package.json'))).toBeUndefined()
  })

  it('reads a well-formed manifest', () => {
    const anchor = sealedAnchor(CLOSURE)
    expect(readDesktopProfileClosure(anchor)).toEqual(CLOSURE)
  })

  it('reports missing and drifted packages without spawning pnpm', () => {
    const violations = verifyDesktopProfileClosure(CLOSURE, name => name === '@deepseek-ai/dsh-agent'
      ? '0.1.7-rc.2'
      : '0.2.0-rc.2')
    expect(violations).toEqual([
      '@deepseek-ai/dsh-agent resolves to 0.1.7-rc.2 but the packaged closure pinned 0.2.0-rc.2',
    ])
  })

  it('reports a package missing from the tree entirely', () => {
    const violations = verifyDesktopProfileClosure(CLOSURE, name => {
      if (name === '@deepseek-ai/dsh-agent') throw new Error('MODULE_NOT_FOUND')
      return '0.2.0-rc.2'
    })
    expect(violations).toEqual([
      '@deepseek-ai/dsh-agent@0.2.0-rc.2 is missing from the packaged dependency tree',
    ])
  })

  it('accepts a fully consistent tree', () => {
    expect(verifyDesktopProfileClosure(CLOSURE, () => '0.2.0-rc.2')).toEqual([])
  })
})
