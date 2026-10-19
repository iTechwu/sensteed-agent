import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertProofSecretsOutsideReadRoots } from './hub-target-proof-sandbox.mjs'

test('both token and key are denied in every sandbox read root', () => {
  const roots = ['/usr', '/private/etc', '/private/var/db/dyld', '/app/Contents/Resources', '/app/Contents/MacOS', '/scratch']
  for (const root of roots) {
    for (const secret of [root, `${root}/credential`]) {
      assert.throws(() => assertProofSecretsOutsideReadRoots([secret, '/ci/private/key'], roots), /credentials overlap/)
      assert.throws(() => assertProofSecretsOutsideReadRoots(['/ci/private/token', secret], roots), /credentials overlap/)
    }
  }
})

test('separate private CI credentials and sibling prefix directories remain supported', () => {
  assert.doesNotThrow(() => assertProofSecretsOutsideReadRoots(
    ['/ci/private/token', '/ci/private/key', '/scratch-private/token'], ['/app', '/scratch', '/usr'],
  ))
})
