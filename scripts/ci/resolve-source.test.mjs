import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { publication } from './resolve-source.mjs'

test('branch pushes and PRs only produce candidates', () => {
  for (const ref of ['refs/heads/dev', 'refs/heads/master', 'refs/pull/12/merge']) {
    assert.deepEqual(publication('2.0.11-beta.18', ref, 'candidate'), {
      version: '2.0.11-beta.18', channel: 'beta', release: false,
    })
  }
})
test('matching version tags and explicit branch releases publish the appropriate channel', () => {
  assert.equal(publication('2.0.11', 'refs/tags/v2.0.11', 'candidate').channel, 'stable')
  assert.equal(publication('2.0.11', 'refs/tags/v2.0.11', 'candidate').release, true)
  assert.equal(publication('2.0.11-beta.18', 'refs/heads/dev', 'release').release, true)
})
test('mismatched tags, unsupported versions, and untrusted manual release refs fail', () => {
  assert.throws(() => publication('2.0.11', 'refs/tags/v2.0.12', 'candidate'), /Tag/)
  assert.throws(() => publication('2.0.11', 'refs/heads/feature', 'release'), /Manual/)
  for (const version of ['02.0.1', '2.0.1-alpha.1', '2.0.1-beta.01', '../2.0.1']) {
    assert.throws(() => publication(version, 'refs/heads/dev', 'candidate'), /version/)
  }
})
test('TOS publication requires all gates and isolates credentials from PR builds', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const publish = workflow.slice(workflow.indexOf('  publish-tos:'))
  assert.match(publish, /needs: \[changes, publish-config, check, desktop-windows, desktop-linux, desktop-macos, upstream-command-windows\]/)
  assert.match(publish, /github.event_name != 'pull_request'/)
  assert.doesNotMatch(publish, /always\(\)|continue-on-error/)
  assert.match(publish, /cancel-in-progress: false/)
  assert.equal((workflow.match(/archive\/\$UPSTREAM_SHA\.tar\.gz/g) || []).length, 5)
  assert.doesNotMatch(workflow, /archive\/refs\/heads\/dev/)
  const builds = workflow.slice(workflow.indexOf('  check:'), workflow.indexOf('  publish-tos:'))
  assert.doesNotMatch(builds, /secrets\.TOS_/)
  assert.match(builds, /release == 'true' && github.event_name != 'pull_request'/)
})
