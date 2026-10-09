import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function publication(version, ref, kind) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.(0|[1-9]\d*))?$/u.test(version)) {
    throw new Error('Unsupported release version')
  }
  const tagged = ref?.startsWith('refs/tags/') === true
  const release = tagged || kind === 'release'
  if (tagged && ref !== `refs/tags/v${version}`) throw new Error('Tag must match package version')
  if (release && !tagged && !['refs/heads/dev', 'refs/heads/master'].includes(ref)) {
    throw new Error('Manual releases must use dev or master')
  }
  return { version, release, channel: version.includes('-beta.') ? 'beta' : 'stable' }
}

function main() {
  const upstream = JSON.parse(readFileSync('upstream.json', 'utf8'))
  const repository = /^git@github\.com:([\w.-]+\/[\w.-]+)\.git$/u.exec(upstream.repository)?.[1]
  if (!repository || !/^[\w./-]+$/u.test(upstream.branch)) throw new Error('Invalid upstream repository or branch')
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version
  const info = publication(version, process.env.GITHUB_REF, process.env.PUBLISH_KIND)
  const sha = execFileSync('git', ['ls-remote', '--exit-code', `https://github.com/${repository}.git`, `refs/heads/${upstream.branch}`], {
    encoding: 'utf8',
  }).trim().split(/\s+/u)[0]
  if (!/^[a-f0-9]{40}$/u.test(sha)) throw new Error('Upstream did not resolve to a commit')
  appendFileSync(process.env.GITHUB_OUTPUT, [
    `upstream_sha=${sha}`, `upstream_repository=${repository}`, `version=${version}`,
    `release=${info.release}`, `channel=${info.channel}`, '',
  ].join('\n'))
  console.log(`Harness source: ${repository}@${sha}; desktop: ${version}; ${info.release ? 'release' : 'candidate'}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
