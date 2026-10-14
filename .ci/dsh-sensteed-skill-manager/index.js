import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { access, cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { parse as parseYaml } from 'yaml'

const execFileAsync = promisify(execFile)
const ROUTE = '/api/desktop/sensteed/skills'
const MAX_BODY_BYTES = 16 * 1024
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const inject = ['webServer', 'skills']

export function skillRoot(environment = process.env, home = homedir()) {
  return resolve(environment.DSH_HOME || join(home, '.dsh'), 'skills')
}

export function parseSkillFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text)
  if (!match) throw new Error('SKILL.md must start with YAML frontmatter.')
  const fields = parseYaml(match[1])
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('Skill frontmatter must be a YAML mapping.')
  const name = fields.name
  const description = fields.description
  if (!SKILL_NAME.test(name || '')) throw new Error('Skill name must use lowercase letters, numbers, and hyphens.')
  if (typeof description !== 'string' || !description.trim()) throw new Error('SKILL.md frontmatter must include a description.')
  return { name, description: description.trim() }
}

function safeGitHubUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('Enter a public GitHub repository URL.') }
  const parts = url.pathname.split('/').filter(Boolean)
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password
    || url.search || url.hash || parts.length !== 2) {
    throw new Error('Only public https://github.com/owner/repository URLs are supported.')
  }
  const repository = parts[1].replace(/\.git$/u, '')
  if (!/^[A-Za-z0-9_.-]+$/u.test(parts[0]) || !/^[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error('The GitHub repository URL is invalid.')
  }
  return `https://github.com/${parts[0]}/${repository}.git`
}

async function exists(path) {
  try { await access(path); return true } catch { return false }
}

async function skillSource(repositoryDir) {
  const rootFile = join(repositoryDir, 'SKILL.md')
  if (await exists(rootFile)) {
    const entry = await lstat(rootFile)
    if (entry.isFile() && !entry.isSymbolicLink()) return repositoryDir
    throw new Error('SKILL.md must be a regular file, not a symbolic link.')
  }
  const candidates = []
  for (const folder of ['skills', '.']) {
    const parent = join(repositoryDir, folder)
    let entries
    try { entries = await readdir(parent, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue
      const candidate = join(parent, entry.name)
      const skillFile = join(candidate, 'SKILL.md')
      if (await exists(skillFile)) {
        const skillStat = await lstat(skillFile)
        if (!skillStat.isFile() || skillStat.isSymbolicLink()) {
          throw new Error('SKILL.md must be a regular file, not a symbolic link.')
        }
        candidates.push(candidate)
      }
    }
    if (folder === 'skills' && candidates.length > 0) break
  }
  if (candidates.length !== 1) {
    throw new Error(candidates.length > 1
      ? 'This repository contains multiple skills. Install a repository with a single skill.'
      : 'No SKILL.md was found at the repository root or in its skills/ directory.')
  }
  return candidates[0]
}

async function installSkill(url, options = {}) {
  const repository = safeGitHubUrl(url)
  const root = options.root || skillRoot()
  const temporaryRoot = await mkdtemp(join(options.tempRoot || tmpdir(), 'sensteed-skill-'))
  const checkout = join(temporaryRoot, 'repo')
  let staging
  try {
    await execFileAsync('git', ['clone', '--depth', '1', '--', repository, checkout], {
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
    })
    const source = await skillSource(checkout)
    const metadata = parseSkillFrontmatter(await readFile(join(source, 'SKILL.md'), 'utf8'))
    await mkdir(root, { recursive: true, mode: 0o700 })
    const rootStat = await lstat(root)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('The local skill directory is not a regular directory.')
    const destination = join(root, metadata.name)
    if (await exists(destination)) throw new Error(`The skill "${metadata.name}" is already installed.`)
    staging = join(root, `.${metadata.name}.${randomUUID()}.tmp`)
    await cp(source, staging, {
      recursive: true,
      filter: path => {
        try { return !lstatSync(path).isSymbolicLink() } catch { return false }
      },
    })
    await rename(staging, destination)
    staging = undefined
    return metadata
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true })
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('Request body is too large.')
    chunks.push(chunk)
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('Request body must be an object.')
  return body
}

function respond(res, status, value) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

function isSameOrigin(req, port) {
  const address = req.socket?.remoteAddress ?? ''
  if (!(address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.'))) return false
  const origin = `http://127.0.0.1:${String(port)}`
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return false
  if (req.method === 'POST') {
    return req.headers.origin === origin
      && req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
  }
  return req.headers.origin === undefined || req.headers.origin === origin
}

export async function listSkills(ctx) {
  const skills = await ctx.skills.list()
  return skills.map(skill => ({
    name: skill.name,
    description: skill.description,
    source: skill.source,
    provider: skill.provider,
    path: skill.path,
  }))
}

export function apply(ctx, overrides = {}) {
  if (overrides.registerHostRoute === false) return undefined
  const route = ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE,
    async handler(req, res) {
      if (!isSameOrigin(req, ctx.webServer.port)) return respond(res, 403, { error: 'Local same-origin access is required.' })
      if (req.method === 'GET' && req.url?.split('?', 1)[0] === ROUTE) {
        try { return respond(res, 200, { skills: await listSkills(ctx) }) }
        catch { return respond(res, 503, { error: 'Skills are temporarily unavailable.' }) }
      }
      if (req.method !== 'POST' || req.url?.split('?', 1)[0] !== `${ROUTE}/install`) {
        return respond(res, 404, { error: 'Route not found.' })
      }
      try {
        const body = await readJsonBody(req)
        if (typeof body.repository !== 'string') return respond(res, 400, { error: 'A GitHub repository URL is required.' })
        const skill = await installSkill(body.repository, overrides.installOptions)
        return respond(res, 201, { skill })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Skill installation failed.'
        return respond(res, 400, { error: message.slice(0, 300) })
      }
    },
  })
  return () => route?.()
}

export const __test = { safeGitHubUrl, skillSource, installSkill }
