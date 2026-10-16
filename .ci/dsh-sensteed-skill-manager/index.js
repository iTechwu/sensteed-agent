import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { access, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { parse as parseYaml } from 'yaml'
import { unzipSync, zipSync } from 'fflate'
import { HUB_API_BASE, HUB_WEB_BASE, HubCatalogClient, callHubCatalog, hubSession } from './hub-client.js'

const execFileAsync = promisify(execFile)
const ROUTE = '/api/desktop/sensteed/skills'
const SHARED_SKILLS_URL = 'https://knowledge.hozonauto.com/api/plugin/v1/shared-agent-skills'
// 企业技能/插件管理 Hub（skill.dofe.ai）：目录浏览走 /skillhub/v1 契约，
// 认证复用桌面端 SSO 会话（dofeAuth 注入；Hub 校验同 issuer 的用户 token）。
const MAX_BODY_BYTES = 16 * 1024
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024
const MAX_UNPACKED_BYTES = 25 * 1024 * 1024
const MAX_ARCHIVE_FILES = 500
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SHARED_INSTALL_MARKER = '.sensteed-shared-skill.json'

export const inject = ['webServer', 'skills', 'credentials', 'dofeAuth', 'connection']

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

async function inspectGitSkill(checkout, requestedPath) {
  const { stdout } = await execFileAsync('git', ['-C', checkout, 'ls-tree', '--full-tree', '-r', '-l', '-z', 'HEAD'], {
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  })
  const entries = stdout.toString().split('\0').filter(Boolean).map(entry => {
    const [metadata, path] = entry.split('\t', 2)
    const fields = metadata.split(' ')
    return { path, size: fields[3] === '-' ? 0 : Number(fields[3]), type: fields[1] }
  }).filter(entry => entry.type === 'blob')
  const files = new Set(entries.map(entry => entry.path))
  let sourcePath = requestedPath
  if (!sourcePath) {
    if (files.has('SKILL.md')) sourcePath = ''
    else {
      const candidates = entries.map(entry => entry.path).filter(path => /^skills\/(?!\.)[^/]+\/SKILL\.md$/u.test(path))
      const selected = candidates.length > 0
        ? candidates
        : entries.map(entry => entry.path).filter(path => /^(?!\.)[^/]+\/SKILL\.md$/u.test(path))
      if (selected.length !== 1) {
        throw new Error(selected.length > 1
          ? 'This repository contains multiple skills. Install a repository with a single skill.'
          : 'No SKILL.md was found at the repository root or in its skills/ directory.')
      }
      sourcePath = dirname(selected[0])
    }
  }
  if (!files.has([sourcePath, 'SKILL.md'].filter(Boolean).join('/'))) {
    throw new Error('No regular SKILL.md was found in the selected GitHub directory.')
  }
  const selectedEntries = entries.filter(entry =>
    sourcePath ? entry.path.startsWith(`${sourcePath}/`) : true,
  )
  const totalSize = selectedEntries.reduce((sum, entry) => sum + entry.size, 0)
  if (selectedEntries.length > MAX_ARCHIVE_FILES || totalSize > MAX_UNPACKED_BYTES) {
    throw new Error('Skill contains too many files or exceeds the 25 MiB limit.')
  }
  return sourcePath
}

async function installSkill(url, options = {}) {
  const sourceSpec = safeGitHubUrl(url)
  const root = options.root || skillRoot()
  const temporaryRoot = await mkdtemp(join(options.tempRoot || tmpdir(), 'sensteed-skill-'))
  const checkout = join(temporaryRoot, 'repo')
  let staging
  try {
    const cloneArgs = ['clone', '--depth', '1', '--filter=blob:none', '--no-checkout']
    if (sourceSpec.ref) cloneArgs.push('--branch', sourceSpec.ref)
    cloneArgs.push('--', sourceSpec.repository, checkout)
    try {
      await execFileAsync('git', cloneArgs, {
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
      })
    } catch (error) {
      throw Object.assign(new Error('GitHub repository could not be downloaded.'), { statusCode: 502, cause: error })
    }
    let sourcePath
    try {
      sourcePath = await inspectGitSkill(checkout, sourceSpec.path)
      await execFileAsync('git', ['-C', checkout, 'checkout', 'HEAD', '--', sourcePath || '.'], { timeout: 60_000 })
    } catch (error) {
      if (Number.isInteger(error?.statusCode)) throw error
      if (error instanceof Error && /No SKILL\.md|multiple skills|selected GitHub directory|25 MiB/u.test(error.message)) throw error
      throw Object.assign(new Error('GitHub skill files could not be downloaded.'), { statusCode: 502, cause: error })
    }
    const source = await skillSource(checkout, sourcePath || undefined)
    const metadata = parseSkillFrontmatter(await readFile(join(source, 'SKILL.md'), 'utf8'))
    await validateSkillTree(source)
    await mkdir(root, { recursive: true, mode: 0o700 })
    const rootStat = await lstat(root)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('The local skill directory is not a regular directory.')
    const destination = join(root, metadata.name)
    if (await exists(destination)) throw new Error(`The skill "${metadata.name}" is already installed.`)
    staging = join(root, `.${metadata.name}.${randomUUID()}.tmp`)
    await cp(source, staging, {
      recursive: true,
      filter: path => {
        if (basename(path) === '.git' || basename(path) === 'node_modules') return false
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

async function validateSkillTree(root) {
  let count = 0
  let totalSize = 0
  const visit = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const path = join(directory, entry.name)
      const info = await lstat(path)
      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) await visit(path)
      else if (info.isFile()) {
        count += 1
        totalSize += info.size
        if (count > MAX_ARCHIVE_FILES || totalSize > MAX_UNPACKED_BYTES) {
          throw new Error('Skill contains too many files or exceeds the 25 MiB limit.')
        }
      }
    }
  }
  await visit(root)
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
  const files = new Set()
  const directories = new Set()
  const portableNames = new Set()
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
    const pathName = name.endsWith('/') ? name.slice(0, -1) : name
    const segments = pathName.split('/')
    const portableName = pathName.normalize('NFC').toLocaleLowerCase('en-US')
    const fileType = (externalAttributes >>> 16) & 0o170000
    if (
      !name || name.includes('\\') || name.includes('\0') || name.includes(':') || name.startsWith('/') || /^[A-Za-z]:/u.test(name) ||
      segments.some(part => part === '..' || part === '.' || part.endsWith('.') || part.endsWith(' ')) ||
      segments.some(part => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(part)) ||
      portableName === SHARED_INSTALL_MARKER.toLocaleLowerCase('en-US') || portableNames.has(portableName) || names.has(name) ||
      flags & 1 || ![0, 8].includes(method) || fileType === 0o120000 ||
      compressedSize === 0xffffffff || uncompressedSize === 0xffffffff
    ) throw new Error('Skill archive contains an unsafe or unsupported entry.')
    let parent = ''
    for (const rawSegment of segments.slice(0, -1)) {
      const segment = rawSegment.normalize('NFC').toLocaleLowerCase('en-US')
      parent = parent ? `${parent}/${segment}` : segment
      if (files.has(parent)) throw new Error('Skill archive contains conflicting file and directory paths.')
      directories.add(parent)
    }
    const isDirectory = name.endsWith('/')
    if ((isDirectory && files.has(portableName)) || (!isDirectory && directories.has(portableName))) {
      throw new Error('Skill archive contains conflicting file and directory paths.')
    }
    if (isDirectory) directories.add(portableName)
    else files.add(portableName)
    portableNames.add(portableName)
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

async function installArchive(root, expectedName, archive, expectedSha256, version = 1) {
  if (createHash('sha256').update(archive).digest('hex') !== expectedSha256) throw new Error('Skill archive checksum does not match.')
  const names = validateZipArchive(archive)
  const entries = unzipSync(archive)
  const metadata = parseSkillFrontmatter(Buffer.from(entries['SKILL.md']).toString('utf8'))
  if (metadata.name !== expectedName) throw new Error('Skill archive name does not match the shared listing.')
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('Shared skill version is invalid.')
  await mkdir(root, { recursive: true, mode: 0o700 })
  const rootStat = await lstat(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('The local skill directory is not a regular directory.')
  const destination = join(root, expectedName)
  let backup
  const destinationStat = await lstat(destination).catch(() => undefined)
  if (destinationStat) {
    if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()) throw new Error('The existing skill path is not a regular directory.')
    let marker
    try { marker = JSON.parse(await readFile(join(destination, SHARED_INSTALL_MARKER), 'utf8')) } catch {}
    if (marker?.name !== expectedName || !/^[a-f0-9]{64}$/u.test(marker?.sha256 || '')) {
      throw new Error(`The skill "${expectedName}" is already installed and is not managed by the company library.`)
    }
    backup = join(root, `.${expectedName}.${randomUUID()}.bak`)
  }
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
    await writeFile(join(staging, SHARED_INSTALL_MARKER), JSON.stringify({ name: expectedName, sha256: expectedSha256, version }), { mode: 0o600, flag: 'wx' })
    if (backup) await rename(destination, backup)
    try {
      await rename(staging, destination)
    } catch (error) {
      if (backup) {
        await rename(backup, destination)
        backup = undefined
      }
      throw error
    }
    if (backup) {
      await rm(backup, { recursive: true, force: true })
      backup = undefined
    }
    return metadata
  } finally {
    await rm(staging, { recursive: true, force: true })
    if (backup) {
      if (!await exists(destination)) await rename(backup, destination)
      else await rm(backup, { recursive: true, force: true })
    }
  }
}

async function readSharedInstallMarker(skill) {
  if (skill.source === 'bundled' || typeof skill.path !== 'string') return undefined
  try {
    const root = await realpath(skillRoot())
    const directory = await realpath(dirname(skill.path))
    if (relative(root, directory) !== skill.name) return undefined
    const marker = JSON.parse(await readFile(join(directory, SHARED_INSTALL_MARKER), 'utf8'))
    if (marker?.name !== skill.name || !/^[a-f0-9]{64}$/u.test(marker?.sha256 || '') || !Number.isSafeInteger(marker.version)) return undefined
    return { sha256: marker.sha256, version: marker.version }
  } catch {
    return undefined
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

// 「在 Hub 查看」的免登录跳转:用桌面 SSO Bearer 向 Nest 换一次性短票,
// 网页端消费票据引导登录态,不再要求用户在网页重复登录(一次桌面登录,
// 全部企业服务无感)。服务端未上线或任何一步失败都回退直开网页,行为与
// 此前一致;契约见 docs/skillhub-ticket-auth.md。
async function hubViewUrl(ctx, target, overrides = {}) {
  if (!/^(skills|plugins)(\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/iu.test(target)) throw new Error('Invalid Hub target.')
  const workspaceId = overrides.workspaceId
  if (workspaceId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(workspaceId)) throw new Error('Invalid Hub workspace.')
  const next = `/${target}${workspaceId ? `?workspace=${workspaceId}` : ''}`
  const fallback = { url: `${HUB_WEB_BASE}${next}` }
  const session = hubSession(ctx)
  if (!session) return fallback
  try {
    const response = await (overrides.fetch || globalThis.fetch)(`${HUB_API_BASE}/auth/ticket`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify({ next }),
    })
    if (!response.ok) return fallback
    const payload = await response.json().catch(() => null)
    const ticket = typeof payload?.data?.ticket === 'string' ? payload.data.ticket : undefined
    if (!ticket || !/^[A-Za-z0-9._-]{16,256}$/u.test(ticket)) return fallback
    return { url: `${HUB_WEB_BASE}?tt=${encodeURIComponent(ticket)}&next=${encodeURIComponent(next)}` }
  }
  catch { return fallback }
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
  return Promise.all(skills.map(async skill => {
    const shared = await readSharedInstallMarker(skill)
    return {
      name: skill.name,
      description: skill.description,
      source: skill.source,
      provider: skill.provider,
      path: skill.path,
      ...(shared ? { shared } : {}),
    }
  }))
}

export function apply(ctx, overrides = {}) {
  if (overrides.registerHostRoute === false) return undefined
  const hub = new HubCatalogClient(ctx, { fetch: overrides.fetch })
  const route = ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE,
    async handler(req, res) {
      // Prefix handlers bypass Connection's /api bridge; admit before any body,
      // remote identity lookup or disk operation, including read-only listings.
      let admission
      try { admission = ctx.connection?.admit(req) } catch { /* fail closed */ }
      if (!admission || 'rejection' in admission) {
        const status = admission?.rejection === 403 ? 403 : 401
        return respond(res, status, { error: status === 401 ? 'Host authentication is required.' : 'Host access is forbidden.' })
      }
      if (admission.peer?.principal?.kind !== 'owner') return respond(res, 403, { error: 'Host owner access is required.' })
      if (!isSameOrigin(req, ctx.webServer.port)) return respond(res, 403, { error: 'Local same-origin access is required.' })
      if (req.method === 'GET' && req.url?.split('?', 1)[0] === ROUTE) {
        try {
          const source = new URL(req.url, 'http://localhost').searchParams.get('source')
          if (source === 'local') return respond(res, 200, { skills: await listSkills(ctx) })
          if (source === 'shared') {
            const result = await callSharedSkills(ctx, '?page=1&limit=200', { fetch: overrides.fetch })
              .catch(error => ({ unavailable: error instanceof Error ? error.message : 'Company skills are unavailable.', list: [] }))
            return respond(res, 200, { sharedSkills: result.list || [], sharedTotal: result.total || 0, sharedError: result.unavailable || null })
          }
          const hubView = async () => {
            const result = await hub.catalog()
            return {
              hubSkills: result.skills.list, hubSkillsTotal: result.skills.total,
              hubPlugins: result.plugins.list, hubPluginsTotal: result.plugins.total,
              hubSkillsError: result.skills.error || null, hubPluginsError: result.plugins.error || null,
              hubSkillsErrorCode: result.skills.code || null, hubPluginsErrorCode: result.plugins.code || null,
              hubWorkspace: result.workspace, hubWorkspaceId: result.workspaceId || null,
              hubWorkspaces: result.workspaces, hubWorkspaceError: result.workspaceError || null,
              hubPermissions: result.permissions || [],
              hubError: result.workspaceError || result.skills.error || result.plugins.error || null,
              hubErrorCode: [result.workspaceErrorCode, result.skills.code, result.plugins.code].includes('HUB_SSO_REQUIRED') ? 'HUB_SSO_REQUIRED' : null,
            }
          }
          if (source === 'hub') return respond(res, 200, await hubView())
          const [skills, shared, hubSkills] = await Promise.all([
            listSkills(ctx),
            callSharedSkills(ctx, '?page=1&limit=200', { fetch: overrides.fetch }).catch(error => ({ unavailable: error instanceof Error ? error.message : 'Company skills are unavailable.', list: [] })),
            hubView(),
          ])
          return respond(res, 200, {
            skills,
            sharedSkills: shared.list || [],
            sharedTotal: shared.total || 0,
            sharedError: shared.unavailable || null,
            ...hubSkills,
          })
        }
        catch { return respond(res, 503, { error: 'Skills are temporarily unavailable.' }) }
      }
      const requestPath = req.url?.split('?', 1)[0]
      const sharedName = safeRouteName(requestPath)
      try {
        if (req.method === 'POST' && requestPath === `${ROUTE}/hub/view-url`) {
          const body = await readJsonBody(req)
          const id = body.id
          if (id !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id)) return respond(res, 400, { error: 'Invalid Hub resource.' })
          const target = `${body.kind === 'plugin' ? 'plugins' : 'skills'}${id ? `/${id}` : ''}`
          const context = await hub.context()
          return respond(res, 200, await hubViewUrl(ctx, target, { ...overrides, workspaceId: context.me.workspace.ssoTeam.id }))
        }
        if (req.method === 'POST' && requestPath === `${ROUTE}/hub/workspace`) {
          const body = await readJsonBody(req)
          return respond(res, 200, await hub.select(body.workspaceId))
        }
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
          const skill = await installArchive(skillRoot(), sharedName, archive, result.sha256, result.version)
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

export const __test = { safeGitHubUrl, skillSource, inspectGitSkill, installSkill, validateSkillTree, validateZipArchive, installArchive, packLocalSkill, SHARED_SKILLS_URL, HUB_API_BASE, callHubCatalog, hubSession, hubViewUrl }
