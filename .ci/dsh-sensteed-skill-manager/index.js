import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { access, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { parse as parseYaml } from 'yaml'
import { unzipSync, zipSync } from 'fflate'

const execFileAsync = promisify(execFile)
const ROUTE = '/api/desktop/sensteed/skills'
const SHARED_SKILLS_URL = 'https://knowledge.hozonauto.com/api/plugin/v1/shared-agent-skills'
const MAX_BODY_BYTES = 16 * 1024
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024
const MAX_UNPACKED_BYTES = 25 * 1024 * 1024
const MAX_ARCHIVE_FILES = 500
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const inject = ['webServer', 'skills', 'credentials']

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
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.search || url.hash) {
    throw new Error('Use a public GitHub repository or skill-directory URL.')
  }
  const repository = parts[1].replace(/\.git$/u, '')
  if (!parts[0] || !repository || !/^[A-Za-z0-9_.-]+$/u.test(parts[0]) || !/^[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error('The GitHub repository URL is invalid.')
  }
  if (parts.length === 2) return { repository: `https://github.com/${parts[0]}/${repository}.git` }
  const kind = parts[2]
  if ((kind !== 'tree' && kind !== 'blob') || parts.length < 5) {
    throw new Error('Use a GitHub /tree/<branch>/<skill-path> URL or a repository root URL.')
  }
  const ref = parts[3]
  const path = parts.slice(4).map(segment => {
    let decoded
    try { decoded = decodeURIComponent(segment) } catch { throw new Error('The GitHub skill path is invalid.') }
    if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) {
      throw new Error('The GitHub skill path is invalid.')
    }
    return decoded
  })
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(ref)) throw new Error('The GitHub branch name is invalid.')
  if (kind === 'blob') {
    if (path.at(-1) !== 'SKILL.md') throw new Error('A GitHub file URL must point to SKILL.md.')
    path.pop()
  }
  if (path.length === 0) throw new Error('Select a skill directory, not the repository root.')
  return { repository: `https://github.com/${parts[0]}/${repository}.git`, ref, path: path.join('/') }
}

async function exists(path) {
  try { await access(path); return true } catch { return false }
}

async function skillSource(repositoryDir, requestedPath) {
  if (requestedPath) {
    const source = resolve(repositoryDir, requestedPath)
    const relativePath = relative(repositoryDir, source)
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw new Error('The GitHub skill path is invalid.')
    }
    let current = repositoryDir
    for (const segment of requestedPath.split('/')) {
      current = join(current, segment)
      const entry = await lstat(current).catch(() => undefined)
      if (!entry?.isDirectory() || entry.isSymbolicLink()) throw new Error('The selected GitHub path is not a skill directory.')
    }
    const skillFile = join(source, 'SKILL.md')
    const skillStat = await lstat(skillFile).catch(() => undefined)
    if (!skillStat?.isFile() || skillStat.isSymbolicLink()) throw new Error('No regular SKILL.md was found in the selected GitHub directory.')
    return source
  }
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
  const sourceSpec = safeGitHubUrl(url)
  const root = options.root || skillRoot()
  const temporaryRoot = await mkdtemp(join(options.tempRoot || tmpdir(), 'sensteed-skill-'))
  const checkout = join(temporaryRoot, 'repo')
  let staging
  try {
    const cloneArgs = ['clone', '--depth', '1']
    if (sourceSpec.path) cloneArgs.push('--filter=blob:none', '--sparse')
    if (sourceSpec.ref) cloneArgs.push('--branch', sourceSpec.ref)
    cloneArgs.push('--', sourceSpec.repository, checkout)
    await execFileAsync('git', cloneArgs, {
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
    })
    if (sourceSpec.path) {
      await execFileAsync('git', ['-C', checkout, 'sparse-checkout', 'set', '--', sourceSpec.path], { timeout: 30_000 })
    }
    const source = await skillSource(checkout, sourceSpec.path)
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

async function readArchiveBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > Math.ceil(MAX_ARCHIVE_BYTES * 1.4) + 1024 * 1024) throw new Error('Skill archive is too large.')
    chunks.push(chunk)
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Request body must be an object.')
  return body
}

function validateZipArchive(archive) {
  if (archive.length < 22 || archive.length > MAX_ARCHIVE_BYTES) throw new Error('Skill archive exceeds the 10 MiB limit.')
  let eocd = -1
  for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 65_557); offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break }
  }
  if (eocd < 0) throw new Error('Skill archive is invalid.')
  const count = archive.readUInt16LE(eocd + 10)
  const directorySize = archive.readUInt32LE(eocd + 12)
  const directoryOffset = archive.readUInt32LE(eocd + 16)
  if (!count || count > MAX_ARCHIVE_FILES || directoryOffset + directorySize > eocd) throw new Error('Skill archive directory is invalid.')
  const names = new Set()
  let totalSize = 0
  let offset = directoryOffset
  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) throw new Error('Skill archive directory is invalid.')
    const flags = archive.readUInt16LE(offset + 8)
    const method = archive.readUInt16LE(offset + 10)
    const compressedSize = archive.readUInt32LE(offset + 20)
    const uncompressedSize = archive.readUInt32LE(offset + 24)
    const nameLength = archive.readUInt16LE(offset + 28)
    const extraLength = archive.readUInt16LE(offset + 30)
    const commentLength = archive.readUInt16LE(offset + 32)
    const externalAttributes = archive.readUInt32LE(offset + 38)
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    const fileType = (externalAttributes >>> 16) & 0o170000
    if (
      !name || name.includes('\\') || name.includes('\0') || name.includes(':') || name.startsWith('/') || /^[A-Za-z]:/u.test(name) ||
      name.split('/').some(part => part === '..' || part === '.' || part.endsWith('.') || part.endsWith(' ')) || names.has(name) ||
      flags & 1 || ![0, 8].includes(method) || fileType === 0o120000 ||
      compressedSize === 0xffffffff || uncompressedSize === 0xffffffff
    ) throw new Error('Skill archive contains an unsafe or unsupported entry.')
    names.add(name)
    totalSize += uncompressedSize
    if (totalSize > MAX_UNPACKED_BYTES || (compressedSize > 0 && uncompressedSize / compressedSize > 200)) {
      throw new Error('Skill archive expands beyond the 25 MiB limit.')
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  if (offset !== directoryOffset + directorySize || ![...names].some(name => name === 'SKILL.md')) {
    throw new Error('Skill archive must contain SKILL.md at its root.')
  }
  return names
}

async function packLocalSkill(ctx, name) {
  if (!SKILL_NAME.test(name || '')) throw new Error('Skill name is invalid.')
  const listed = (await listSkills(ctx)).find(skill => skill.name === name && skill.source !== 'bundled')
  if (!listed?.path) throw new Error('Only local skills can be published.')
  const root = await realpath(skillRoot())
  const skillFile = await realpath(listed.path)
  const directory = await realpath(dirname(skillFile))
  const relativeDirectory = relative(root, directory)
  if (!relativeDirectory || relativeDirectory.startsWith(`..${sep}`) || isAbsolute(relativeDirectory) || relativeDirectory.includes(sep)) {
    throw new Error('The selected skill is outside the local skills directory.')
  }
  if (basename(skillFile) !== 'SKILL.md') throw new Error('The selected skill has no regular SKILL.md.')
  const metadata = parseSkillFrontmatter(await readFile(skillFile, 'utf8'))
  if (metadata.name !== name) throw new Error('Skill folder and SKILL.md names must match.')
  const files = Object.create(null)
  let totalSize = 0
  let count = 0
  const walk = async (directoryPath, prefix = '') => {
    for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const fullPath = join(directoryPath, entry.name)
      const info = await lstat(fullPath)
      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) { await walk(fullPath, `${prefix}${entry.name}/`); continue }
      if (!info.isFile()) continue
      count += 1
      totalSize += info.size
      if (count > MAX_ARCHIVE_FILES || totalSize > MAX_UNPACKED_BYTES) throw new Error('Skill contains too many or too-large files.')
      files[`${prefix}${entry.name}`] = new Uint8Array(await readFile(fullPath))
    }
  }
  await walk(directory)
  const archive = Buffer.from(zipSync(files, { level: 6 }))
  validateZipArchive(archive)
  return { metadata, archive, sha256: createHash('sha256').update(archive).digest('hex') }
}

async function installArchive(root, expectedName, archive, expectedSha256) {
  if (createHash('sha256').update(archive).digest('hex') !== expectedSha256) throw new Error('Skill archive checksum does not match.')
  const names = validateZipArchive(archive)
  const entries = unzipSync(archive)
  const metadata = parseSkillFrontmatter(Buffer.from(entries['SKILL.md']).toString('utf8'))
  if (metadata.name !== expectedName) throw new Error('Skill archive name does not match the shared listing.')
  await mkdir(root, { recursive: true, mode: 0o700 })
  const rootStat = await lstat(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('The local skill directory is not a regular directory.')
  const destination = join(root, expectedName)
  if (await exists(destination)) throw new Error(`The skill "${expectedName}" is already installed.`)
  const staging = join(root, `.${expectedName}.${randomUUID()}.tmp`)
  try {
    for (const name of names) {
      if (name.endsWith('/')) continue
      const target = resolve(staging, name)
      const relativePath = relative(staging, target)
      if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
        throw new Error('Skill archive contains an unsafe path.')
      }
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await writeFile(target, entries[name], { mode: 0o600, flag: 'wx' })
    }
    await rename(staging, destination)
    return metadata
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

async function resolveModelsKey(ctx) {
  const result = await ctx.credentials.resolve('MODELS_API_KEY')
  const value = typeof result === 'string' ? result : result?.value
  if (typeof value !== 'string' || !value.trim()) throw new Error('MODELS_API_KEY is unavailable.')
  return value.trim()
}

async function callSharedSkills(ctx, path = '', options = {}) {
  const key = await resolveModelsKey(ctx)
  const response = await (options.fetch || globalThis.fetch)(`${SHARED_SKILLS_URL}${path}`, {
    ...options.request,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: { Accept: 'application/json', Authorization: `Bearer ${key}`, ...(options.request?.headers || {}) },
  })
  const envelope = await response.json().catch(() => null)
  if (!response.ok || !envelope?.data) {
    const message = typeof envelope?.msg === 'string' ? envelope.msg : `Knowledge request failed (${response.status}).`
    throw new Error(message.slice(0, 300))
  }
  return envelope.data
}

function safeRouteName(path) {
  const match = /^\/api\/desktop\/sensteed\/skills\/shared\/([a-z0-9]+(?:-[a-z0-9]+)*)$/u.exec(path || '')
  return match?.[1]
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
        try {
          const [skills, shared] = await Promise.all([
            listSkills(ctx),
            callSharedSkills(ctx, '?page=1&limit=200').catch(error => ({ unavailable: error instanceof Error ? error.message : 'Company skills are unavailable.', list: [] })),
          ])
          return respond(res, 200, { skills, sharedSkills: shared.list || [], sharedTotal: shared.total || 0, sharedError: shared.unavailable || null })
        }
        catch { return respond(res, 503, { error: 'Skills are temporarily unavailable.' }) }
      }
      const requestPath = req.url?.split('?', 1)[0]
      const sharedName = safeRouteName(requestPath)
      try {
        if (req.method === 'POST' && requestPath === `${ROUTE}/install`) {
          const body = await readJsonBody(req)
          if (typeof body.repository !== 'string') return respond(res, 400, { error: 'A GitHub repository URL is required.' })
          const skill = await installSkill(body.repository, overrides.installOptions)
          return respond(res, 201, { skill })
        }
        if (req.method === 'POST' && requestPath === `${ROUTE}/publish`) {
          const body = await readArchiveBody(req)
          if (typeof body.name !== 'string') return respond(res, 400, { error: 'A local skill name is required.' })
          const { metadata, archive, sha256 } = await packLocalSkill(ctx, body.name)
          const result = await callSharedSkills(ctx, '', { fetch: overrides.fetch, request: {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: metadata.name, description: metadata.description, sha256, archiveBase64: archive.toString('base64') }),
          } })
          return respond(res, 201, { skill: result.skill })
        }
        if (req.method === 'POST' && sharedName && requestPath === `${ROUTE}/shared/${sharedName}`) {
          const result = await callSharedSkills(ctx, `/${encodeURIComponent(sharedName)}/archive`, { fetch: overrides.fetch })
          const archive = Buffer.from(result.archiveBase64, 'base64')
          const skill = await installArchive(skillRoot(), sharedName, archive, result.sha256)
          return respond(res, 201, { skill })
        }
        if (req.method === 'DELETE' && sharedName && requestPath === `${ROUTE}/shared/${sharedName}`) {
          await callSharedSkills(ctx, `/${encodeURIComponent(sharedName)}`, { fetch: overrides.fetch, request: { method: 'DELETE' } })
          return respond(res, 200, { deleted: true })
        }
        return respond(res, 404, { error: 'Route not found.' })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Skill installation failed.'
        const status = /MODELS_API_KEY|scope|unauthorized/iu.test(message) ? 403 : 400
        return respond(res, status, { error: message.slice(0, 300) })
      }
    },
  })
  return () => route?.()
}

export const __test = { safeGitHubUrl, skillSource, installSkill, validateZipArchive, installArchive, packLocalSkill, SHARED_SKILLS_URL }
