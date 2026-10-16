/**
 * Sync/verify the `.ci/<plugin>` build snapshots from the sibling source
 * checkout in docker-helm.dofe.ai.
 *
 * Contract (see docs / dsh-yootun-tos-upload plan):
 * - `docker-helm.dofe.ai/plugins/<name>` is the only source of truth;
 * - `.ci/<name>` is a CI build snapshot for runners without a sibling checkout;
 * - snapshots are produced ONLY by this script, and every build verifies that
 *   the snapshot matches the tracked source before using it.
 *
 * Usage:
 *   node scripts/sync-dofe-plugin-snapshot.mjs                  # verify all (CI default)
 *   node scripts/sync-dofe-plugin-snapshot.mjs --write          # sync source -> snapshot (all)
 *   node scripts/sync-dofe-plugin-snapshot.mjs --write <name>   # sync one plugin
 */
import { readdir, readFile, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { diffSnapshotTrees, includeSnapshotPath } from './snapshot-tree.mjs'

const root = resolve(import.meta.dirname, '..')
const write = process.argv.includes('--write')
const specialSnapshots = new Map([
  ['dsh-knowledge-capture', 'scripts/ci-snapshots/dsh-knowledge-capture'],
])

function snapshotPath(name) {
  return resolve(root, specialSnapshots.get(name) ?? `.ci/${name}`)
}

async function diffSnapshot(name) {
  const source = resolve(root, `../docker-helm.dofe.ai/plugins/${name}`)
  const snapshot = snapshotPath(name)
  if (!existsSync(join(source, 'package.json'))) {
    return [`source package.json missing at ${source}`]
  }
  if (!existsSync(join(snapshot, 'package.json'))) {
    return [`snapshot package.json missing at ${snapshot} (run with --write)`]
  }
  const problems = []
  const sourceManifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  const snapshotManifest = JSON.parse(await readFile(join(snapshot, 'package.json'), 'utf8'))
  if (sourceManifest.name !== snapshotManifest.name) {
    problems.push(`package name mismatch: source ${sourceManifest.name} vs snapshot ${snapshotManifest.name}`)
  }
  if (sourceManifest.version !== snapshotManifest.version) {
    problems.push(`version mismatch: source ${sourceManifest.version} vs snapshot ${snapshotManifest.version}`)
  }
  if (sourceManifest.main !== snapshotManifest.main) {
    problems.push(`main mismatch: source ${sourceManifest.main} vs snapshot ${snapshotManifest.main}`)
  }
  problems.push(...await diffSnapshotTrees(source, snapshot))
  return problems
}

// Keep newly introduced sibling snapshots addressable before their first copy.
const manifest = JSON.parse(await readFile(join(root, 'bundled.json'), 'utf8'))
const snapshotPlugins = (await readdir(resolve(root, '.ci'), { withFileTypes: true }))
  .filter(entry => entry.isDirectory() && existsSync(join(root, '.ci', entry.name, 'package.json')))
  .map(entry => entry.name)
  .concat(manifest.plugins.filter(plugin => plugin.source === 'sibling' && plugin.snapshotDir.startsWith('.ci/')).map(plugin => plugin.name))
  .concat([...specialSnapshots.keys()])
// Optional positional filter: sync/verify only the named plugins.
const requested = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
if (requested.some(name => !snapshotPlugins.includes(name))) {
  console.error(`dofe-snapshot: unknown snapshot name(s): ${requested.filter(name => !snapshotPlugins.includes(name)).join(', ')}`)
  process.exit(1)
}
const targets = [...new Set(requested.length > 0 ? requested : snapshotPlugins)]

let failed = false
for (const name of targets) {
  const problems = await diffSnapshot(name)
  if (problems.length === 0) {
    console.log(`dofe-snapshot: ${name} matches source`)
    continue
  }
  for (const problem of problems) console.error(`dofe-snapshot: ${name}: ${problem}`)
  if (write) {
    const source = resolve(root, `../docker-helm.dofe.ai/plugins/${name}`)
    const snapshot = snapshotPath(name)
    await rm(snapshot, { recursive: true, force: true })
    await mkdir(snapshot, { recursive: true })
    // Copy and comparison share the same dependency/Git exclusion rule.
    await cp(source, snapshot, {
      recursive: true,
      filter: includeSnapshotPath,
    })
    const remaining = await diffSnapshot(name)
    if (remaining.length > 0) throw new Error(`sync failed for ${name}: ${remaining.join('; ')}`)
    console.log(`dofe-snapshot: ${name} re-synced from source`)
  } else failed = true
}

if (failed) {
  console.error('dofe-snapshot: snapshots are out of sync with the sibling source checkout.')
  console.error('dofe-snapshot: run `node scripts/sync-dofe-plugin-snapshot.mjs --write` after changing plugin sources.')
  process.exit(1)
}
