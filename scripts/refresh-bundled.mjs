/**
 * Refresh/verify the bundled skills and plugins declared in `bundled.json`.
 *
 * Contract:
 * - `bundled.json` (repository root) is the manifest of built-in content;
 * - skill snapshots are committed at `dsh-plugin-desktop/bundled/skills/` and
 *   are produced ONLY by this script — every packaging entry refreshes (or
 *   verifies) them before its check gate, so packaged content is always the
 *   latest snapshot;
 * - `source: "github"` plugin entries are written back into their sibling
 *   checkout (source of truth stays the sibling repository), then the existing
 *   `scripts/sync-dofe-plugin-snapshot.mjs` re-syncs the `.ci` snapshot;
 * - network failures never fail a packaging build: the run degrades to the
 *   committed snapshot with a loud warning.
 *
 * Usage:
 *   node scripts/refresh-bundled.mjs                 # refresh all (network)
 *   node scripts/refresh-bundled.mjs --offline       # verify only, no network
 *   node scripts/refresh-bundled.mjs --verify        # verify only (CI default)
 *   node scripts/refresh-bundled.mjs --force         # allow sibling write-back over a dirty tree
 *   node scripts/refresh-bundled.mjs --skill <name>  # filter to one skill (repeatable)
 *   node scripts/refresh-bundled.mjs --plugin <name> # filter to one plugin (repeatable)
 *
 * Environment:
 *   DSH_BUNDLED_OFFLINE=1  force verify-only behavior (no network refresh)
 */
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Skills snapshot root inside the desktop package (enters the app via `files` globs). */
export const BUNDLED_SKILLS_ROOT = 'dsh-plugin-desktop/bundled/skills'
/** Derived in-package manifest consumed by the packaged runtime smoke. */
export const BUNDLED_MANIFEST = 'dsh-plugin-desktop/bundled/manifest.json'
const CACHE_ROOT = '.build/bundled-skill-cache'
const SYNC_SNAPSHOT_SCRIPT = 'scripts/sync-dofe-plugin-snapshot.mjs'
const DEFAULT_SIBLING_REPOSITORY = '../docker-helm.dofe.ai'
/** Root-level documentation files that must never become flat skills. */
const FLAT_MD_EXCLUSIONS = /^(?:README|CONTRIBUTING|LICENSE|AGENTS|CHANGELOG|CODE_OF_CONDUCT)(?:\..*)?$/i
/** Directories copied verbatim except for VCS/build noise. */
const COPY_EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.github'])

const log = (...lines) => {
  for (const line of lines) console.log(`dsh-bundled: ${line}`)
}
const warn = (...lines) => {
  for (const line of lines) console.error(`dsh-bundled: ${line}`)
}

/** Parse and shape-check `bundled.json`; throws on unknown shape. */
export async function loadManifest(root, manifestPath = 'bundled.json') {
  const path = join(root, manifestPath)
  if (!existsSync(path)) throw new Error(`bundled manifest missing at ${path}`)
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  if (manifest.version !== 1) throw new Error(`bundled.json: unsupported version ${manifest.version}`)
  if (!Array.isArray(manifest.skills)) throw new Error('bundled.json: missing skills[]')
  if (!Array.isArray(manifest.plugins)) throw new Error('bundled.json: missing plugins[]')
  for (const skill of manifest.skills) {
    for (const field of ['name', 'repository', 'snapshotDir']) {
      if (typeof skill[field] !== 'string' || skill[field].length === 0) {
        throw new Error(`bundled.json: skill ${skill.name ?? '?'} misses string field ${field}`)
      }
    }
  }
  for (const plugin of manifest.plugins) {
    for (const field of ['name', 'package', 'source', 'snapshotDir']) {
      if (typeof plugin[field] !== 'string' || plugin[field].length === 0) {
        throw new Error(`bundled.json: plugin ${plugin.name ?? '?'} misses string field ${field}`)
      }
    }
    if (plugin.source !== 'sibling' && plugin.source !== 'github') {
      throw new Error(`bundled.json: plugin ${plugin.name} has unknown source ${plugin.source}`)
    }
    if (plugin.source === 'github' && (typeof plugin.upstream !== 'string' || typeof plugin.siblingDir !== 'string')) {
      throw new Error(`bundled.json: github plugin ${plugin.name} needs upstream + siblingDir`)
    }
  }
  return manifest
}

/** Kebab-case a candidate skill name the way the harness skill loader expects. */
export function normalizeSkillName(raw) {
  const name = String(raw).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (name.length === 0) throw new Error(`skill name ${JSON.stringify(raw)} normalizes to empty`)
  return name
}

/** Repository URL -> cache directory name (`<owner>--<repo>`). */
function cacheDirName(repository) {
  const tail = new URL(repository).pathname.replace(/\.git$/, '').split('/').filter(Boolean)
  if (tail.length < 2) throw new Error(`cannot derive cache directory from repository ${repository}`)
  return `${tail[tail.length - 2]}--${tail[tail.length - 1]}`
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`)
  }
  return result.stdout.trim()
}

/** Shallow clone (or refresh) the repository into the cache; returns HEAD sha. */
export function fetchRepository(root, repository, ref) {
  const cache = resolve(root, CACHE_ROOT, cacheDirName(repository))
  if (existsSync(join(cache, '.git'))) {
    git(root, ['-C', cache, 'fetch', '--depth', '1', 'origin', ref ?? 'HEAD'])
    git(root, ['-C', cache, 'reset', '--hard', 'FETCH_HEAD'])
  } else {
    mkdirSync(cache, { recursive: true })
    git(root, ['clone', '--depth', '1', ...(ref ? ['--branch', ref] : []), repository, cache])
  }
  const sha = git(root, ['-C', cache, 'rev-parse', 'HEAD'])
  return { cache, sha }
}

/**
 * Detect the skills inside a cloned repository without assuming its layout:
 * root `SKILL.md`, direct child skill dirs, a `skills/<name>/SKILL.md` tree, or
 * (only when no directory strategy matches) root-level flat Markdown excluding
 * docs/license files.
 * @param {string} repoDir cloned repository checkout
 * @param {{ fallbackName?: string }} [options] canonical name for a root-level skill
 * @returns {{ name: string, kind: 'dir'|'flat', from: string }[]}
 */
export function planSkillTargets(repoDir, { fallbackName } = {}) {
  const dirTargets = collectDirTargets(repoDir, fallbackName)
  const targets = dirTargets.length > 0 ? dirTargets : collectFlatTargets(repoDir)
  if (targets.length === 0) throw new Error(`no skill (SKILL.md bundle or flat Markdown) found in ${repoDir}`)
  return targets
}

function collectDirTargets(repoDir, fallbackName) {
  if (existsSync(join(repoDir, 'SKILL.md'))) {
    return [{ name: normalizeSkillName(fallbackName ?? basename(repoDir)), kind: 'dir', from: '.' }]
  }
  const direct = []
  for (const entry of listDir(repoDir)) {
    if (entry.isDirectory() && !entry.name.startsWith('.') && existsSync(join(repoDir, entry.name, 'SKILL.md'))) {
      direct.push({ name: normalizeSkillName(entry.name), kind: 'dir', from: entry.name })
    }
  }
  if (direct.length > 0) return direct
  const skillsDir = join(repoDir, 'skills')
  const nested = []
  for (const entry of listDir(skillsDir)) {
    if (entry.isDirectory() && existsSync(join(skillsDir, entry.name, 'SKILL.md'))) {
      nested.push({ name: normalizeSkillName(entry.name), kind: 'dir', from: join('skills', entry.name) })
    }
  }
  return nested
}

function collectFlatTargets(repoDir) {
  const flats = []
  for (const entry of listDir(repoDir)) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md') && !FLAT_MD_EXCLUSIONS.test(entry.name)) {
      flats.push({ name: normalizeSkillName(entry.name.slice(0, -3)), kind: 'flat', from: entry.name })
    }
  }
  return flats
}

function listDir(dir) {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function copyDir(from, to) {
  await cp(from, to, {
    recursive: true,
    filter: source => !COPY_EXCLUDED_DIRS.has(basename(source)),
  })
}

/**
 * Refresh bundled content.
 *
 * Writes are all-or-nothing: if any selected skill cannot be fetched, nothing
 * on disk changes — the committed snapshot set stays complete and consistent
 * (a partial run must never shrink the derived manifest or prune snapshots).
 *
 * @param {string} root repository root holding `bundled.json`
 * @param {{ write?: boolean, network?: boolean, force?: boolean, select?: (kind: 'skill'|'plugin', name: string) => boolean, log?: (line: string) => void }} options
 * @returns {{ refreshed: string[], degraded: string[], writtenBack: string[], shaByRepository: Map<string, string> }}
 */
export async function refreshBundledContents(root, options = {}) {
  const write = options.write ?? true
  const network = options.network ?? true
  const force = options.force ?? false
  const emit = options.log ?? log
  // Always process against the full manifest: filtered runs must still
  // persist untouched entries back to `bundled.json` unchanged.
  const manifest = await loadManifest(root)
  const select = options.select ?? (() => true)
  const summary = { refreshed: [], degraded: [], writtenBack: [], shaByRepository: new Map() }
  const selectedSkills = manifest.skills.filter(skill => select('skill', skill.name))

  const fetchedSkills = []
  for (const skill of selectedSkills) {
    if (!network) {
      summary.degraded.push(skill.name)
      continue
    }
    try {
      const fetched = fetchRepository(root, skill.repository, skill.ref)
      emit(`fetched ${skill.repository} @ ${fetched.sha}`)
      fetchedSkills.push({ skill, fetched })
    } catch (error) {
      summary.degraded.push(skill.name)
      warn(`network refresh skipped (${firstLine(error)}); using committed snapshot for ${skill.name}`)
    }
  }

  // Phase 2: only a fully fetched selection may touch disk.
  if (write && fetchedSkills.length === selectedSkills.length) {
    const skillsRoot = resolve(root, BUNDLED_SKILLS_ROOT)
    await mkdir(skillsRoot, { recursive: true })
    const skillOutputs = []
    for (const { skill, fetched } of fetchedSkills) {
      const targets = planSkillTargets(fetched.cache, { fallbackName: skill.name })
      const seen = new Set()
      for (const target of targets) {
        if (seen.has(target.name)) throw new Error(`duplicate skill name ${target.name} in ${skill.repository}`)
        seen.add(target.name)
        const dest = target.kind === 'dir'
          ? join(skillsRoot, target.name)
          : join(skillsRoot, `${target.name}.md`)
        await rm(dest, { recursive: true, force: true })
        const from = resolve(fetched.cache, target.from)
        if (target.kind === 'dir') await copyDir(from, dest)
        else await writeFile(dest, await readFile(from, 'utf8'))
        skillOutputs.push({
          name: target.name,
          kind: target.kind,
          path: target.kind === 'dir' ? target.name : `${target.name}.md`,
          repository: skill.repository,
          resolvedSha: fetched.sha,
        })
      }
      skill.snapshotDir = targets.length === 1 && targets[0].kind === 'dir'
        ? `${BUNDLED_SKILLS_ROOT}/${targets[0].name}`
        : BUNDLED_SKILLS_ROOT
      skill.resolvedSha = fetched.sha
      skill.refreshedAt = new Date().toISOString()
      summary.refreshed.push(skill.name)
      summary.shaByRepository.set(skill.repository, fetched.sha)
    }
    await pruneStaleSkills(root, skillOutputs, emit)
    await mkdir(dirname(resolve(root, BUNDLED_MANIFEST)), { recursive: true })
    await writeFile(resolve(root, BUNDLED_MANIFEST), `${JSON.stringify({ schemaVersion: 1, skills: skillOutputs }, null, 2)}\n`)
    await writeFile(resolve(root, 'bundled.json'), `${JSON.stringify(manifest, null, 2)}\n`)

    for (const plugin of manifest.plugins) {
      if (plugin.source !== 'github') continue
      if (!select('plugin', plugin.name)) continue
      const outcome = await writeBackGithubPlugin(root, plugin, { force, emit })
      if (outcome === 'written') summary.writtenBack.push(plugin.name)
    }
  } else if (write && summary.degraded.length > 0) {
    warn(`keeping committed snapshots and write-backs untouched (${summary.degraded.length} skill(s) unfetched)`)
  }
  return summary
}

async function pruneStaleSkills(root, outputs, emit) {
  const skillsRoot = resolve(root, BUNDLED_SKILLS_ROOT)
  if (!existsSync(skillsRoot)) return
  const keep = new Set(outputs.map(output => output.path))
  for (const entry of await readdir(skillsRoot, { withFileTypes: true })) {
    if (keep.has(entry.name)) continue
    await rm(join(skillsRoot, entry.name), { recursive: true, force: true })
    emit(`pruned stale bundled skill ${entry.name}`)
  }
}

function firstLine(error) {
  return String(error?.message ?? error).split('\n')[0]
}

/** Write a github-sourced plugin back into its sibling checkout, then re-sync the `.ci` snapshot. */
async function writeBackGithubPlugin(root, plugin, { force, emit }) {
  const siblingRoot = resolve(root, plugin.siblingRepository ?? DEFAULT_SIBLING_REPOSITORY)
  const siblingDir = resolve(root, plugin.siblingDir)
  if (!existsSync(siblingRoot)) {
    warn(`sibling repository missing at ${siblingRoot}; skipping ${plugin.name} write-back`)
    return 'skipped'
  }
  const fetched = fetchRepository(root, plugin.upstream, plugin.ref)
  emit(`fetched ${plugin.upstream} @ ${fetched.sha}`)
  const relative = siblingDir.startsWith(siblingRoot) ? siblingDir.slice(siblingRoot.length + 1) : plugin.siblingDir
  const dirty = spawnSync('git', ['-C', siblingRoot, 'status', '--porcelain', '--', relative], { encoding: 'utf8' })
  if (dirty.status !== 0) throw new Error(`git status failed in ${siblingRoot}: ${dirty.stderr}`)
  if (dirty.stdout.trim().length > 0 && !force) {
    warn(`sibling ${relative} has uncommitted changes; skipping write-back (use --force to override)`)
    return 'skipped'
  }
  await rm(siblingDir, { recursive: true, force: true })
  await copyDir(fetched.cache, siblingDir)
  if (!existsSync(join(siblingDir, 'package.json'))) {
    throw new Error(`upstream ${plugin.upstream} has no package.json at its root`)
  }
  const sync = spawnSync(process.execPath, [resolve(root, SYNC_SNAPSHOT_SCRIPT), '--write', plugin.name], { cwd: root, encoding: 'utf8' })
  if (sync.status !== 0) throw new Error(`snapshot re-sync failed for ${plugin.name}: ${sync.stdout}${sync.stderr}`)
  emit(`wrote back ${plugin.name} @ ${fetched.sha} into ${relative} and re-synced its .ci snapshot`)
  emit(`reminder: commit ${plugin.siblingRepository ?? DEFAULT_SIBLING_REPOSITORY} inside its own repository; run installs if its version/deps changed`)
  return 'written'
}

/** Offline verification gate: manifest shape plus snapshot presence. */
export async function verifyBundled(root) {
  const manifest = await loadManifest(root)
  const problems = []
  const derivedPath = resolve(root, BUNDLED_MANIFEST)
  if (!existsSync(derivedPath)) {
    problems.push(`derived manifest missing at ${BUNDLED_MANIFEST} (run bundled:refresh once)`)
  } else {
    const derived = JSON.parse(await readFile(derivedPath, 'utf8'))
    for (const skill of derived.skills ?? []) {
      const full = resolve(root, BUNDLED_SKILLS_ROOT, skill.path)
      if (!existsSync(full)) {
        problems.push(`bundled skill output missing: ${skill.path}`)
      } else if (skill.kind === 'dir' && !existsSync(join(full, 'SKILL.md'))) {
        problems.push(`bundled skill ${skill.path} has no SKILL.md`)
      }
    }
    const repositories = new Set(manifest.skills.map(entry => entry.repository))
    for (const skill of derived.skills ?? []) {
      if (!repositories.has(skill.repository)) problems.push(`derived skill ${skill.name} has no bundled.json entry`)
    }
  }
  for (const skill of manifest.skills) {
    if (!existsSync(resolve(root, skill.snapshotDir))) problems.push(`skill snapshotDir missing: ${skill.snapshotDir}`)
  }
  for (const plugin of manifest.plugins) {
    if (!existsSync(resolve(root, plugin.snapshotDir))) problems.push(`plugin snapshotDir missing: ${plugin.snapshotDir}`)
  }
  return problems
}

function collectFilters(argv) {
  const skills = []
  const plugins = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--skill') skills.push(argv[(index += 1)])
    if (argv[index] === '--plugin') plugins.push(argv[(index += 1)])
  }
  return { skills, plugins }
}

function selectFor(filters) {
  if (filters.skills.length === 0 && filters.plugins.length === 0) return undefined
  return (kind, name) => kind === 'skill' ? filters.skills.includes(name) : filters.plugins.includes(name)
}

const isCli = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isCli) {
  const root = resolve(import.meta.dirname, '..')
  const verify = process.argv.includes('--verify')
  const offline = process.argv.includes('--offline') || process.env.DSH_BUNDLED_OFFLINE === '1'
  const force = process.argv.includes('--force')
  if (verify || offline) {
    const problems = await verifyBundled(root)
    for (const problem of problems) console.error(`dsh-bundled: ${problem}`)
    if (problems.length > 0) {
      console.error('dsh-bundled: bundled content verification failed.')
      console.error('dsh-bundled: run `corepack pnpm bundled:refresh` to refresh the committed snapshots.')
      process.exit(1)
    }
    log('bundled content verified (offline)')
  } else {
    const filters = collectFilters(process.argv.slice(2))
    if (filters.skills.length > 0 || filters.plugins.length > 0) {
      const manifest = await loadManifest(root)
      const unknown = [...filters.skills, ...filters.plugins]
        .filter(name => !manifest.skills.some(entry => entry.name === name) && !manifest.plugins.some(entry => entry.name === name))
      if (unknown.length > 0) throw new Error(`unknown filter(s): ${unknown.join(', ')}`)
    }
    const summary = await refreshBundledContents(root, { write: true, network: true, force, select: selectFor(filters) })
    log(
      `refreshed ${summary.refreshed.length} skill(s)${summary.degraded.length > 0 ? `, degraded ${summary.degraded.length} to committed snapshot(s)` : ''}`,
      `write-backs: ${summary.writtenBack.length === 0 ? 'none' : summary.writtenBack.join(', ')}`,
    )
  }
}
