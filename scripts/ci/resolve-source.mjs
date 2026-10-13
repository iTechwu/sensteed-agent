import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertPackagingRelease } from '../release-contract.mjs'

export function publication(version, ref, kind, event = 'push') {
  const tagged = ref?.startsWith('refs/tags/') === true
  if (tagged && ref !== `refs/tags/${version}`) throw new Error('Tag must match package version exactly, without v prefix')
  const packaging = tagged || (ref === 'refs/heads/main' && event === 'workflow_dispatch')
  if (kind === 'release' && !packaging) throw new Error('Manual releases must use tagged main')
  return { version, packaging, release: packaging && kind === 'release', channel: 'beta' }
}

function main() {
  const upstream = JSON.parse(readFileSync('upstream.json', 'utf8'))
  const repository = /^git@github\.com:([\w.-]+\/[\w.-]+)\.git$/u.exec(upstream.repository)?.[1]
  if (!repository || !/^[\w./-]+$/u.test(upstream.branch)) throw new Error('Invalid upstream repository or branch')
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version
  const info = publication(version, process.env.GITHUB_REF, process.env.PUBLISH_KIND, process.env.GITHUB_EVENT_NAME)
  const packaged = info.packaging ? assertPackagingRelease() : undefined
  const sha = packaged?.source.commit ?? execFileSync('git', ['ls-remote', '--exit-code', `https://github.com/${repository}.git`, `refs/heads/${upstream.branch}`], {
    encoding: 'utf8',
  }).trim().split(/\s+/u)[0]
  if (!/^[a-f0-9]{40}$/u.test(sha)) throw new Error('Upstream did not resolve to a commit')
  appendFileSync(process.env.GITHUB_OUTPUT, [
    `upstream_sha=${sha}`, `upstream_repository=${repository}`, `version=${version}`,
    `release=${info.release}`, `packaging=${info.packaging}`, `channel=${info.channel}`, '',
  ].join('\n'))
  console.log(`Harness source: ${repository}@${sha}; desktop: ${version}; ${info.release ? 'release' : 'candidate'}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
