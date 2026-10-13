import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { assertPackagingRelease, assertPackagingVersion, packagingVersion } from './release-contract.mjs'

test('version uses Harness release and Shanghai packaging minute', () => {
  assert.equal(packagingVersion('0.2.1-alpha.2', new Date('2026-10-13T08:00:00Z')), '0.2.1-alpha.2-beta.202610131600')
  assertPackagingVersion('0.2.1-alpha.2-beta.202610131600', '0.2.1-alpha.2')
  for (const version of ['2.0.11-beta.21', '0.2.1-alpha.2-beta.202602301600', '0.2.1-alpha.2-beta.202610132460']) {
    assert.throws(() => assertPackagingVersion(version, '0.2.1-alpha.2'))
  }
})

test('packaging requires main ancestry, exact tag and unchanged version inputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'sensteed-release-'))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const version = '0.2.1-alpha.2-beta.202610131600'
  const environmentRef = process.env.GITHUB_REF
  delete process.env.GITHUB_REF
  try {
    git('init', '-b', 'main')
    git('config', 'user.name', 'release-test')
    git('config', 'user.email', 'test@localhost')
    mkdirSync(join(root, 'dsh-plugin-desktop'))
    for (const path of ['package.json', 'dsh-plugin-desktop/package.json']) writeFileSync(join(root, path), JSON.stringify({ version }) + '\n')
    writeFileSync(join(root, 'upstream.json'), JSON.stringify({ sourceVersion: '0.2.1-alpha.2', repository: 'git@github.com:test/harness.git' }) + '\n')
    writeFileSync(join(root, 'release-source.json'), JSON.stringify({ version, sourceVersion: '0.2.1-alpha.2', repository: 'test/harness', commit: 'a'.repeat(40) }) + '\n')
    git('add', '.')
    git('commit', '-m', 'test')
    git('update-ref', 'refs/remotes/origin/main', 'HEAD')
    assert.throws(() => assertPackagingRelease(root))
    git('tag', version)
    assert.equal(assertPackagingRelease(root).version, version)
    git('checkout', '-b', 'dev')
    assert.throws(() => assertPackagingRelease(root), /main/)
    git('checkout', 'main')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version, modified: true }))
    assert.throws(() => assertPackagingRelease(root), /differs/)
  } finally {
    if (environmentRef !== undefined) process.env.GITHUB_REF = environmentRef
    rmSync(root, { recursive: true, force: true })
  }
})
