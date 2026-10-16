// One ZIP boundary for legacy sharing and signed Hub releases. Never executes files.
import { createHash } from 'node:crypto'
import { Unzip, UnzipInflate } from 'fflate'
export const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024
export const MAX_UNPACKED_BYTES = 25 * 1024 * 1024
const fail = () => { throw Object.assign(new Error('技能 ZIP 结构不安全或超过限制。'), { code: 'HUB_UNSAFE_ARCHIVE' }) }
const utf8 = new TextDecoder('utf-8', { fatal: true })
export const sha256 = value => createHash('sha256').update(value).digest('hex')
// ECMAScript number/string serialization with UTF-16 key ordering is RFC8785 for JSON inputs.
export function jcs(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    if (typeof value === 'string' && /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) fail()
    return JSON.stringify(value)
  }
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`
  if (value && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(key => `${jcs(key)}:${jcs(value[key])}`).join(',')}}`
  fail()
}
export function fileManifest(entries) {
  return Object.keys(entries).sort().map(path => ({ path, bytes: entries[path].length, sha256: sha256(entries[path]) }))
}
export const fileManifestDigest = entries => sha256(jcs(fileManifest(entries)))
function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1))
  }
  return (value ^ 0xffffffff) >>> 0
}
function extraFields(buffer) {
  for (let pos = 0; pos < buffer.length;) {
    if (pos + 4 > buffer.length) fail()
    const tag = buffer.readUInt16LE(pos), size = buffer.readUInt16LE(pos + 2)
    if ([1, 0x7075].includes(tag) || pos + 4 + size > buffer.length) fail()
    pos += 4 + size
  }
}
export function validateZipArchive(input) {
  const archive = Buffer.from(input)
  if (archive.length < 22 || archive.length > MAX_ARCHIVE_BYTES) fail()
  let end = -1
  for (let pos = archive.length - 22; pos >= Math.max(0, archive.length - 65557); pos--) {
    if (archive.readUInt32LE(pos) === 0x06054b50 && pos + 22 + archive.readUInt16LE(pos + 20) === archive.length) { end = pos; break }
  }
  if (end < 0 || archive.readUInt16LE(end + 4) || archive.readUInt16LE(end + 6)) fail()
  const count = archive.readUInt16LE(end + 10), size = archive.readUInt32LE(end + 12), start = archive.readUInt32LE(end + 16)
  if (!count || count > 500 || archive.readUInt16LE(end + 8) !== count || start + size !== end) fail()
  const names = new Set(), portable = new Set(), spellings = new Map(), files = new Set(), dirs = new Set(), records = []
  let cursor = start, total = 0
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || archive.readUInt32LE(cursor) !== 0x02014b50) fail()
    const flags = archive.readUInt16LE(cursor + 8), method = archive.readUInt16LE(cursor + 10)
    const crc = archive.readUInt32LE(cursor + 16), compressed = archive.readUInt32LE(cursor + 20), bytes = archive.readUInt32LE(cursor + 24)
    const nameSize = archive.readUInt16LE(cursor + 28), extraSize = archive.readUInt16LE(cursor + 30), commentSize = archive.readUInt16LE(cursor + 32)
    const local = archive.readUInt32LE(cursor + 42), type = (archive.readUInt32LE(cursor + 38) >>> 16) & 0o170000
    if (cursor + 46 + nameSize + extraSize + commentSize > end || archive.readUInt16LE(cursor + 34)) fail()
    const nameBuffer = archive.subarray(cursor + 46, cursor + 46 + nameSize)
    let name
    try { name = utf8.decode(nameBuffer) } catch { fail() }
    if (!(flags & 0x800) && nameBuffer.some(byte => byte > 127)) fail()
    const isDir = name.endsWith('/'), path = isDir ? name.slice(0, -1) : name, parts = path.split('/')
    const key = path.normalize('NFC').toLowerCase()
    if (!name || path.length > 240 || parts.length > 12 || /[\\\0:\x00-\x1f\x7f]/u.test(name) || name.startsWith('/')
      || parts.some(part => !part || part === '.' || part === '..' || /[. ]$/u.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(part))
      || key === '.sensteed-shared-skill.json' || portable.has(key) || names.has(name)
      || (flags & ~0x080e) || ![0, 8].includes(method) || ![0, isDir ? 0o040000 : 0o100000].includes(type)
      || compressed === 0xffffffff || bytes === 0xffffffff || local >= start || (isDir && (bytes || compressed))
      || (bytes > 0 && (!compressed || bytes / compressed > 200))) fail()
    // Include implicit directories: A/x and a/y alias the same parent on portable filesystems.
    let rawPath = '', parent = ''
    for (let depth = 0; depth < parts.length; depth++) {
      rawPath = rawPath ? `${rawPath}/${parts[depth]}` : parts[depth]
      const portablePath = rawPath.normalize('NFC').toLowerCase()
      if (spellings.has(portablePath) && spellings.get(portablePath) !== rawPath) fail()
      spellings.set(portablePath, rawPath)
      if (depth < parts.length - 1) { parent = portablePath; if (files.has(parent)) fail(); dirs.add(parent) }
    }
    if ((isDir && files.has(key)) || (!isDir && dirs.has(key))) fail()
    ;(isDir ? dirs : files).add(key); portable.add(key); names.add(name)
    total += bytes
    if (total > MAX_UNPACKED_BYTES || local + 30 > start || archive.readUInt32LE(local) !== 0x04034b50) fail()
    const localNameSize = archive.readUInt16LE(local + 26), localExtraSize = archive.readUInt16LE(local + 28)
    const data = local + 30 + localNameSize + localExtraSize
    if (data + compressed > start || archive.readUInt16LE(local + 6) !== flags || archive.readUInt16LE(local + 8) !== method
      || !archive.subarray(local + 30, local + 30 + localNameSize).equals(nameBuffer)) fail()
    extraFields(archive.subarray(cursor + 46 + nameSize, cursor + 46 + nameSize + extraSize))
    extraFields(archive.subarray(local + 30 + localNameSize, data))
    let finish = data + compressed
    if (flags & 8) {
      if (finish + 12 > start) fail()
      if (archive.readUInt32LE(finish) === 0x08074b50) finish += 4
      if (finish + 12 > start || archive.readUInt32LE(finish) !== crc || archive.readUInt32LE(finish + 4) !== compressed || archive.readUInt32LE(finish + 8) !== bytes) fail()
      finish += 12
    } else if (archive.readUInt32LE(local + 14) !== crc || archive.readUInt32LE(local + 18) !== compressed || archive.readUInt32LE(local + 22) !== bytes) fail()
    records.push({ name, bytes, crc, local, finish })
    cursor += 46 + nameSize + extraSize + commentSize
  }
  const ordered = [...records].sort((a, b) => a.local - b.local)
  let expected = 0
  for (const row of ordered) { if (row.local !== expected) fail(); expected = row.finish }
  if (cursor !== end || expected !== start || !names.has('SKILL.md')) fail()
  Object.defineProperty(names, 'records', { value: records })
  return names
}
export function unpackSkillArchive(input) {
  const archive = Buffer.from(input), names = validateZipArchive(archive), records = new Map(names.records.map(row => [row.name, row]))
  const entries = Object.create(null)
  let total = 0, completed = 0
  const unzip = new Unzip(file => {
    const record = records.get(file.name)
    if (!record) fail()
    const chunks = []; let bytes = 0
    file.ondata = (error, chunk, final) => {
      if (error) fail()
      bytes += chunk.length; total += chunk.length
      if (bytes > record.bytes || total > MAX_UNPACKED_BYTES) { file.terminate(); fail() }
      chunks.push(Buffer.from(chunk))
      if (final) {
        const body = Buffer.concat(chunks)
        if (bytes !== record.bytes || crc32(body) !== record.crc) fail()
        if (!file.name.endsWith('/')) entries[file.name] = body
        completed++
      }
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  for (let pos = 0; pos < archive.length; pos += 1024) unzip.push(archive.subarray(pos, pos + 1024), pos + 1024 >= archive.length)
  if (completed !== names.size) fail()
  return entries
}
