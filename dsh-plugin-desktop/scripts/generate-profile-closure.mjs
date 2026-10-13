/**
 * Freeze the first-party dependency closure into `lib/profile-closure.json`.
 *
 * The manifest is the boot-time contract for the zero-pnpm startup path:
 * `src/profile-closure.ts` compares the Profile dependency tree against this
 * snapshot and defers mismatches to the repair surface instead of installing
 * in the boot critical path. Generation is deterministic; `--check` verifies
 * the committed artifact without writing.
 */
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCHEMA_VERSION = 1
const FIRST_PARTY_PREFIX = '@deepseek-ai/'
const checkOnly = process.argv.includes('--check')
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = resolve(packageRoot, 'lib/profile-closure.json')

function loadInstalled(name, parentManifestPath) {
  const require = createRequire(parentManifestPath)
  const path = require.resolve(`${name}/package.json`)
  return { manifest: require(path), path }
}

function closureFrom(manifest, rootManifestPath) {
  const packages = new Map()
  const queue = Object.keys(manifest.dependencies ?? {})
    .filter(name => name.startsWith(FIRST_PARTY_PREFIX))
    .sort()
  const seen = new Set()
  /** Manifest path whose dependency edge owns each queued package. */
  const parentPaths = new Map()
  for (const name of queue) {
    seen.add(name)
    parentPaths.set(name, rootManifestPath)
  }
  for (let index = 0; index < queue.length; index += 1) {
    const name = queue[index]
    const current = loadInstalled(name, parentPaths.get(name) ?? rootManifestPath)
    packages.set(name, current.manifest.version)
    for (const dependency of Object.keys(current.manifest.dependencies ?? {})
      .filter(candidate => candidate.startsWith(FIRST_PARTY_PREFIX))
      .sort()) {
      if (seen.has(dependency)) continue
      seen.add(dependency)
      parentPaths.set(dependency, current.path)
      queue.push(dependency)
    }
  }
  // The sealed runtime verifies these packages at top-level node_modules.
  // Declare every required first-party node at the deploy root so the physical
  // collector cannot omit a transitive bundle hidden behind a workspace link.
  const missing = [...packages.keys()].filter(name => manifest.dependencies?.[name] === undefined)
  if (missing.length > 0) {
    throw new Error(`profile closure packages must be direct desktop dependencies: ${missing.sort().join(', ')}`)
  }
  const dshVersion = packages.get('@deepseek-ai/dsh')
  if (dshVersion === undefined) throw new Error('profile closure requires @deepseek-ai/dsh in the first-party closure')
  const orderedPackages = Object.fromEntries([...packages.entries()].sort(([a], [b]) => a.localeCompare(b)))
  return {
    schemaVersion: SCHEMA_VERSION,
    desktopVersion: manifest.version,
    dshVersion,
    packages: orderedPackages,
  }
}

const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'))
const closure = closureFrom(manifest, resolve(packageRoot, 'package.json'))
const rendered = `${JSON.stringify(closure, null, 2)}\n`

if (checkOnly) {
  let committed
  try {
    committed = readFileSync(outputPath, 'utf8')
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') {
      console.error(`profile closure manifest missing at ${outputPath}; run the build to generate it`)
      process.exit(1)
    }
    throw cause
  }
  if (committed !== rendered) {
    console.error(`profile closure manifest is stale at ${outputPath}; re-run the build`)
    process.exit(1)
  }
  console.log(`profile closure manifest is current (${Object.keys(closure.packages).length} first-party packages)`)
} else {
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, rendered)
  console.log(`profile closure manifest written: ${outputPath} (${Object.keys(closure.packages).length} first-party packages)`)
}
