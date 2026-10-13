/** Preview by default; --execute merges dev, prepares the version on main, tags, then pushes atomically. */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { assertHarnessReleaseManifest, packagingVersion } from './release-contract.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const run = (...args) => execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' })
const args = process.argv.slice(2)
if (args.some(arg => !['--execute'].includes(arg))) throw new Error('Usage: pnpm release:prepare [--execute]')
const upstream = JSON.parse(readFileSync(new URL('../upstream.json', import.meta.url)))
const version = packagingVersion(upstream.sourceVersion)
console.log(`dev -> main -> ${version} version commit -> exact tag -> origin main/tag -> CI packaging`)
if (!args.includes('--execute')) {
  console.log('Preview only. Run pnpm release:prepare --execute from a clean, pushed dev branch to prepare packaging.')
} else {
  if (git('branch', '--show-current') !== 'dev' || git('status', '--porcelain')) throw new Error('Requires a clean dev checkout')
  git('fetch', 'origin', 'main', 'dev', '--tags')
  if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/dev')) throw new Error('Push dev to origin before preparing a release')
  if (git('tag', '--list', version)) throw new Error('This minute already has a release tag; retry in a later minute')
  const main = git('branch', '--list', 'main')
  if (main && git('rev-parse', 'main') !== git('rev-parse', 'origin/main')) throw new Error('Local main must equal origin/main')
  const repository = /^git@github\.com:([\w.-]+\/[\w.-]+)\.git$/u.exec(upstream.repository)?.[1]
  if (!repository) throw new Error('Invalid Harness repository')
  const commit = git('ls-remote', '--exit-code', upstream.repository, `refs/heads/${upstream.branch}`).split(/\s+/u)[0]
  if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error('Could not pin Harness commit')
  // Validate source and mergeability before any branch or manifest mutation.
  const response = await fetch(`https://raw.githubusercontent.com/${repository}/${commit}/package.json`, {
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Could not read pinned Harness manifest: HTTP ${response.status}`)
  assertHarnessReleaseManifest(await response.json(), upstream.sourceVersion)
  git('merge-tree', '--write-tree', 'origin/main', 'dev')
  if (main) git('checkout', 'main')
  else git('checkout', '-b', 'main', 'origin/main')
  git('merge', '--no-ff', 'dev', '-m', 'chore: 合并开发分支准备发布')
  run('scripts/bump-version.mjs', version)
  writeFileSync(new URL('../release-source.json', import.meta.url), JSON.stringify({ version, sourceVersion: upstream.sourceVersion, repository, commit }, null, 2) + '\n')
  execFileSync('corepack', ['pnpm', 'check:layout'], { cwd: root, stdio: 'inherit' })
  git('add', '-u')
  git('add', 'release-source.json')
  git('commit', '-m', `chore: 准备桌面发布 ${version}`)
  git('tag', '-a', version, '-m', `桌面发布 ${version}`)
  git('push', '--atomic', 'origin', 'main', `refs/tags/${version}`)
}
