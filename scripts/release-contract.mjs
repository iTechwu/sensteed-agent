/** Enforce the main -> version commit -> exact tag -> package contract. */
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const NUMBER = '(0|[1-9][0-9]*)'
const SOURCE = new RegExp(`^${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`, 'u')

export function assertHarnessReleaseManifest(manifest, sourceVersion) {
  if (manifest?.name !== '@deepseek-ai/dsh-root' || manifest.version !== sourceVersion) {
    throw new Error(`Pinned Harness package version must equal sourceVersion ${sourceVersion}`)
  }
}

export function packagingVersion(sourceVersion, date = new Date()) {
  if (!SOURCE.test(sourceVersion) || sourceVersion.split('-')[1]?.split('.').some(p => /^0[0-9]+$/u.test(p))) {
    throw new Error('Invalid Harness sourceVersion')
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(p => [p.type, p.value]))
  return `${sourceVersion}-beta.${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`
}

export function assertPackagingVersion(version, sourceVersion) {
  const prefix = sourceVersion + '-beta.'
  const stamp = version.startsWith(prefix) ? version.slice(prefix.length) : ''
  if (!/^[1-9][0-9]{11}$/u.test(stamp)) throw new Error('Package version must be sourceVersion-beta.YYYYMMDDHHmm')
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:00+08:00`
  if (!Number.isFinite(Date.parse(iso)) || packagingVersion(sourceVersion, new Date(iso)) !== version) {
    throw new Error('Invalid packaging timestamp')
  }
}

export function assertPackagingRelease(root = resolve(import.meta.dirname, '..')) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const read = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
  const upstream = read('upstream.json')
  const version = read('dsh-plugin-desktop/package.json').version
  assertPackagingVersion(version, upstream.sourceVersion)
  if (read('package.json').version !== version) throw new Error('Root and Desktop versions must agree')
  git('merge-base', '--is-ancestor', 'HEAD', 'origin/main')
  if (git('rev-parse', `refs/tags/${version}^{commit}`) !== git('rev-parse', 'HEAD')) {
    throw new Error('Exact package version tag must point to HEAD on main')
  }
  const ref = process.env.GITHUB_REF
  if (ref && ref !== 'refs/heads/main' && ref !== `refs/tags/${version}`) {
    throw new Error('Packaging must run on main or its exact version tag')
  }
  if (!ref && git('branch', '--show-current') !== 'main') throw new Error('Local packaging must run on main')
  for (const path of ['package.json', 'dsh-plugin-desktop/package.json', 'upstream.json', 'release-source.json']) {
    if (git('show', `HEAD:${path}`) !== readFileSync(resolve(root, path), 'utf8').trim()) {
      throw new Error(`Packaging input differs from tagged commit: ${path}`)
    }
  }
  // License notices and icons are generated from the installed platform
  // closure. Every other tracked source/build input must still match the tag.
  const generated = new Set([
    'dsh-plugin-desktop/THIRD_PARTY_NOTICES.md',
    'dsh-plugin-desktop/build/app-icon.ico',
    'dsh-plugin-desktop/build/app-icon.icns',
  ])
  const changes = git('diff', '--name-only', '-z', 'HEAD', '--').split('\0').filter(Boolean)
  const unexpected = changes.filter(path => {
    if (generated.has(path)) return false
    if (path === 'deepseek-harness' && process.platform === 'win32') {
      return realpathSync(resolve(root, path)) !== realpathSync(resolve(root, upstream.localCheckout))
    }
    return true
  })
  if (unexpected.length) throw new Error(`Tracked packaging inputs differ from tag: ${unexpected.join(', ')}`)
  const source = read('release-source.json')
  const repository = /^git@github\.com:([\w.-]+\/[\w.-]+)\.git$/u.exec(upstream.repository)?.[1]
  if (!repository || source.version !== version || source.sourceVersion !== upstream.sourceVersion || source.repository !== repository || !/^[a-f0-9]{40}$/u.test(source.commit)) {
    throw new Error('Release Harness commit must be pinned for this package version')
  }
  return { version, source }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assertPackagingRelease()
}
