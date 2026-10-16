import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { diffSnapshotTrees } from './snapshot-tree.mjs'

test('detects newly added source files, removed files and content drift in both directions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'snapshot-tree-'))
  const source = join(root, 'source'), snapshot = join(root, 'snapshot')
  try {
    await Promise.all([mkdir(source), mkdir(snapshot)])
    await writeFile(join(source, 'host.js'), 'new Host dependency')
    await writeFile(join(snapshot, 'removed.js'), 'stale')
    await writeFile(join(source, 'index.js'), 'new')
    await writeFile(join(snapshot, 'index.js'), 'old')
    await mkdir(join(source, 'node_modules'))
    await writeFile(join(source, 'node_modules', 'ignored.js'), 'dependency')
    await mkdir(join(source, '.git'))
    assert.deepEqual(await diffSnapshotTrees(source, snapshot), [
      'content differs: index.js', 'snapshot-only file: removed.js', 'source-only file: host.js',
    ])
    await symlink(join(root, 'outside'), join(source, 'unsafe'))
    await assert.rejects(diffSnapshotTrees(source, snapshot), /symbolic link/u)
  } finally { await rm(root, { recursive: true, force: true }) }
})
