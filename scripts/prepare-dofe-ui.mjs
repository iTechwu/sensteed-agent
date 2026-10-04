/** Materialize privately owned sibling UI plugins for reproducible builds. */
import { cp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const preinstalledPlugins = [
  'dsh-opencli',
  'dsh-plugin-console',
  'dsh-sensteed-finance',
  'dsh-sensteed-knowledge',
  'dsh-sensteed-supplier-intelligence',
  'dsh-soup',
  'dsh-tools-mcp',
]

const snapshots = [
  ...preinstalledPlugins.map(name => ({
    name,
    sibling: `../docker-helm.dofe.ai/plugins/${name}`,
    snapshot: `.ci/${name}`,
  })),
  {
    name: 'dsh-knowledge-capture',
    sibling: '../docker-helm.dofe.ai/plugins/dsh-knowledge-capture',
    snapshot: 'scripts/ci-snapshots/dsh-knowledge-capture',
  },
  // dsh-knowledge-capture is a host-only plugin backed by a private sibling
  // workspace. Keep its transitive file dependencies available to CI without
  // requiring access to those private repositories from the runner.
  {
    name: '@repo/capture-sdk',
    sibling: '../docker-helm.dofe.ai/knowledge.dofe.ai/packages/capture-sdk',
    snapshot: 'scripts/ci-snapshots/capture-sdk',
  },
  {
    name: '@repo/contracts',
    sibling: '../docker-helm.dofe.ai/knowledge.dofe.ai/packages/contracts',
    snapshot: 'scripts/ci-snapshots/contracts',
  },
  {
    name: '@repo/config',
    sibling: '../docker-helm.dofe.ai/knowledge.dofe.ai/packages/config',
    snapshot: 'scripts/ci-snapshots/config',
  },
]

// Shared non-secret brand inputs used by the plugin build scripts.
const brandTarget = resolve(root, '../docker-helm.dofe.ai/plugins/brand')
if (!existsSync(resolve(brandTarget, 'build.mjs'))) {
  await cp(resolve(root, '.ci/brand'), brandTarget, { recursive: true })
}

for (const { name, sibling: siblingPath, snapshot: snapshotPath } of snapshots) {
  const sibling = resolve(root, siblingPath)
  const snapshot = resolve(root, snapshotPath)
  if (existsSync(resolve(sibling, 'package.json'))) {
    console.log(`dofe-ui: using sibling plugin at ${sibling}`)
  } else {
    await mkdir(dirname(sibling), { recursive: true })
    await rm(sibling, { recursive: true, force: true })
    await cp(snapshot, sibling, { recursive: true })
    console.log(`dofe-ui: materialized build snapshot at ${sibling}`)
  }
}
