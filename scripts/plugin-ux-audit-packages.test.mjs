import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { readCiPackageManifests } from './plugin-ux-audit-packages.mjs'
import { boundedFetchCount, localApiPaths } from './plugin-request-policy.mjs'
import { readFile } from 'node:fs/promises'

test('recognizes skill-manager authentication deadlines without inventing a route from prose', async () => {
  const source = await readFile(new URL('../.ci/dsh-sensteed-skill-manager/src/client.js', import.meta.url), 'utf8')
  assert.equal(boundedFetchCount(source), 3)
  const paths = localApiPaths(source)
  assert(paths.has('/api/desktop/auth/feishu/session'))
  assert(paths.has('/api/desktop/auth/feishu/status'))
  assert(!paths.has('/api/desktop/auth/feishu'))
})

test('accepts bounded deadline spellings and rejects missing or unsupported deadlines', () => {
  for (const deadline of ['REQUEST_TIMEOUT_MS', 'REQUEST_TIMEOUT_MS2', '30000', '30_000', '3e4']) {
    assert.equal(boundedFetchCount(`fetch(path, { signal: AbortSignal.timeout(${deadline}) })`), 1)
  }
  assert.equal(boundedFetchCount('fetch(path, { signal: AbortSignal.any([AbortSignal.timeout(30_000), caller]) })'), 1)
  for (const options of ['', 'signal: caller', 'signal: AbortSignal.timeout(0)', 'signal: AbortSignal.timeout(Infinity)', 'signal: AbortSignal.timeout(300000)']) {
    assert.equal(boundedFetchCount(`fetch(path, { ${options} })`), 0)
  }
})

test('keeps unknown literal API endpoints visible to the capability audit', () => {
  assert.deepEqual([...localApiPaths("// product /api/desktop/auth/feishu routes\nfetch('/api/desktop/auth/feishu/unknown')")], ['/api/desktop/auth/feishu/unknown'])
})

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-ux-audit-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, url: pathToFileURL(`${root}${sep}`) }
}

test('reads package manifests and skips CI resource directories', async t => {
  const { root, url } = await fixture(t)
  await mkdir(join(root, 'brand'))
  await writeFile(join(root, 'brand', 'defaults.json'), '{}')
  await mkdir(join(root, 'dsh-plugin'))
  await writeFile(join(root, 'dsh-plugin', 'package.json'), JSON.stringify({ name: 'dsh-plugin' }))

  assert.deepEqual(await readCiPackageManifests(url, ['brand', 'dsh-plugin']), [
    { name: 'dsh-plugin', manifest: { name: 'dsh-plugin' } },
  ])
})

test('rejects malformed package manifests', async t => {
  const { root, url } = await fixture(t)
  await mkdir(join(root, 'dsh-broken'))
  await writeFile(join(root, 'dsh-broken', 'package.json'), '{')

  await assert.rejects(readCiPackageManifests(url, ['dsh-broken']), SyntaxError)
})
