import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { publication } from './resolve-source.mjs'

test('branch pushes and PRs run checks without producing packages', () => {
  for (const ref of ['refs/heads/dev', 'refs/heads/main', 'refs/pull/12/merge']) {
    assert.deepEqual(publication('2.0.11-beta.18', ref, 'candidate'), {
      version: '2.0.11-beta.18', channel: 'beta', release: false, packaging: false,
    })
  }
})
test('exact tags package candidates; signed releases require an explicit main dispatch', () => {
  const version = '0.2.1-alpha.2-beta.202610131600'
  assert.equal(publication(version, `refs/tags/${version}`, 'candidate').packaging, true)
  assert.equal(publication(version, `refs/tags/${version}`, 'candidate').release, false)
  assert.equal(publication(version, 'refs/heads/main', 'release', 'workflow_dispatch').release, true)
})
test('mismatched tags, unsupported versions, and untrusted manual release refs fail', () => {
  assert.throws(() => publication('2.0.11', 'refs/tags/v2.0.12', 'candidate'), /Tag/)
  assert.throws(() => publication('2.0.11', 'refs/heads/feature', 'release'), /Manual/)
  assert.throws(() => publication('2.0.11', 'refs/heads/dev', 'release'), /Manual/)
})
test('TOS publication requires all gates and isolates credentials from PR builds', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const publish = workflow.slice(workflow.indexOf('  publish-tos:'))
  assert.match(publish, /needs: \[changes, publish-config, check, desktop-windows, desktop-linux, desktop-macos, upstream-command-windows\]/)
  assert.match(publish, /github.event_name != 'pull_request'/)
  assert.doesNotMatch(publish, /always\(\)|continue-on-error/)
  assert.match(publish, /cancel-in-progress: false/)
  assert.match(publish, /needs.changes.outputs.packaging == 'true'/)
  assert.doesNotMatch(workflow, /refs\/heads\/master|refs\/tags\/v/)
  assert.match(publish, /timeout-minutes: 120/)
  assert.match(publish, /name: Publish installers and checksum manifest to TOS\s+timeout-minutes: 120/)
  assert.equal((workflow.match(/archive\/\$UPSTREAM_SHA\.tar\.gz/g) || []).length, 5)
  assert.doesNotMatch(workflow, /archive\/refs\/heads\/dev/)
  const builds = workflow.slice(workflow.indexOf('  check:'), workflow.indexOf('  publish-tos:'))
  assert.doesNotMatch(builds, /secrets\.TOS_/)
  assert.match(builds, /release == 'true' && github.event_name != 'pull_request'/)
  const upstreamCommand = workflow.slice(workflow.indexOf('  upstream-command-windows:'), workflow.indexOf('  publish-tos:'))
  assert.match(upstreamCommand, /node scripts\/verify-layout\.mjs/)
  assert.doesNotMatch(upstreamCommand, /pnpm install|upstream:build|inspector-compat/)
})

test('all CI packaging entries require the shared packaging decision', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const entries = workflow.split('      - name: ').filter(step => /run: pnpm --filter dsh-plugin-desktop dist:/u.test(step))
  assert.equal(entries.length, 6)
  for (const step of entries) assert.match(step, /if: needs.changes.outputs.packaging == 'true'/u)
  assert.match(workflow, /tags: \['\*-beta\.\*'\]/u)
})
