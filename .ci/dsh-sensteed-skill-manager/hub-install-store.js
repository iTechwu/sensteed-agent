// Small Host-only durable ledger; journals/outbox never live under a discovered skills root.
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { dirname, join, parse, resolve, relative } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { fileManifest, fileManifestDigest, jcs, sha256, MAX_UNPACKED_BYTES } from './skill-archive.js'
import { NAME, UUID, requireValue } from './hub-release-verifier.js'
export async function statOptional(path) {
  try { return await lstat(path) } catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
}
export async function safePath(path, create = false) {
  const absolute = resolve(path), root = parse(absolute).root
  let current = root
  for (const part of relative(root,absolute).split(/[\\/]/u).filter(Boolean)) {
    current = join(current,part)
    let info = await statOptional(current)
    if (!info && create) { await mkdir(current,{mode:0o700}).catch(error => { if (error.code !== 'EEXIST') throw error }); await syncDirectory(dirname(current)); info = await lstat(current) }
    requireValue(info?.isDirectory() && !info.isSymbolicLink(), 'HUB_UNSAFE_LOCAL_PATH')
    requireValue(resolve(await realpath(current)) === resolve(current), 'HUB_UNSAFE_LOCAL_PATH')
  }
  return absolute
}
export async function syncDirectory(path) {
  if (process.platform === 'win32') return
  const handle = await open(path,'r')
  try { await handle.sync() } finally { await handle.close() }
}
export async function durableJson(path, value) {
  await safePath(dirname(path))
  const existing = await statOptional(path)
  requireValue(!existing || existing.isFile() && !existing.isSymbolicLink(), 'HUB_UNSAFE_LOCAL_PATH')
  const bytes = Buffer.from(JSON.stringify(value))
  requireValue(bytes.length <= 2 * 1024 * 1024, 'HUB_STATE_LIMIT')
  const temporary = `${path}.${randomUUID()}.tmp`
  const file = await open(temporary,'wx',0o600)
  try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
  await rename(temporary,path); await syncDirectory(dirname(path))
}
export async function readJson(path) {
  const info = await statOptional(path)
  if (!info) return undefined
  requireValue(info.isFile() && !info.isSymbolicLink() && info.size <= 2 * 1024 * 1024, 'HUB_UNSAFE_LOCAL_PATH')
  return JSON.parse(await readFile(path,'utf8'))
}
export async function treeState(root) {
  const info = await statOptional(root)
  if (!info) return { exists:false, digest:null, treeDigest:null }
  requireValue(info.isDirectory() && !info.isSymbolicLink(), 'HUB_LOCAL_CONFLICT')
  await safePath(root)
  const files = Object.create(null), directories = []; let count = 0, total = 0
  const visit = async (folder,prefix = '') => {
    for (const name of (await readdir(folder)).sort()) {
      const path = join(folder,name), rel = `${prefix}${name}`, stat = await lstat(path)
      requireValue(!stat.isSymbolicLink() && (stat.isFile() || stat.isDirectory()) && ++count <= 500
        && rel.length <= 240 && rel.split('/').length <= 12, 'HUB_LOCAL_MODIFIED')
      if (stat.isDirectory()) { directories.push(rel); await visit(path,`${rel}/`) }
      else {
        total += stat.size; requireValue(total <= MAX_UNPACKED_BYTES,'HUB_LOCAL_MODIFIED')
        files[rel] = await readFile(path)
        requireValue(files[rel].length === stat.size,'HUB_LOCAL_MODIFIED')
      }
    }
  }
  await visit(root)
  return { exists:true, digest:fileManifestDigest(files), treeDigest:sha256(jcs({directories:directories.sort(),files:fileManifest(files)})), files }
}
export class HubInstallStore {
  constructor(options = {}) {
    this.home = resolveDshHome(options.home)
    this.root = join(this.home,'skills'); this.directory = join(this.home,'.sensteed-hub')
  }
  async initialize() {
    await safePath(this.home,true); await safePath(this.root,true)
    requireValue(resolve(this.root) !== resolve(process.cwd()) && !this.root.includes('.asar'), 'HUB_UNSAFE_LOCAL_PATH')
    await safePath(this.directory,true)
    requireValue((await lstat(this.root)).dev === (await lstat(this.directory)).dev,'HUB_UNSAFE_LOCAL_PATH')
    for (const part of ['operations','receipts','devices','locks','staging','backups']) {
      await safePath(join(this.directory,part),true)
      requireValue((await lstat(join(this.directory,part))).dev === (await lstat(this.root)).dev,'HUB_UNSAFE_LOCAL_PATH')
    }
    await withFileLock(join(this.directory,'scope'),async () => {
      const scopePath = join(this.directory,'scope.json')
      let scope = await readJson(scopePath)
      if (!scope) { scope = {schemaVersion:1,hostScopeId:randomUUID(),root:this.root}; await durableJson(scopePath,scope) }
      requireValue(scope.schemaVersion === 1 && UUID.test(scope.hostScopeId) && scope.root === this.root,'HUB_UNSAFE_LOCAL_PATH')
      this.scope = scope
    },{waitMs:10_000})
    return this
  }
  target(name) { requireValue(NAME.test(name),'HUB_INVALID_REQUEST'); return join(this.root,name) }
  operationPath(id) { requireValue(UUID.test(id),'HUB_INVALID_REQUEST'); return join(this.directory,'operations',`${id}.json`) }
  receiptPath(name) { requireValue(NAME.test(name),'HUB_INVALID_REQUEST'); return join(this.directory,'receipts',`${name}.json`) }
  async receipt(name) { return readJson(this.receiptPath(name)) }
  async saveReceipt(name,receipt) { await durableJson(this.receiptPath(name),receipt) }
  async removeReceipt(name) { await rm(this.receiptPath(name),{force:true}); await syncDirectory(join(this.directory,'receipts')) }
  async save(operation) { await durableJson(this.operationPath(operation.operationId),operation) }
  async operations() {
    const files = await readdir(join(this.directory,'operations'))
    requireValue(files.length <= 2000,'HUB_STATE_LIMIT')
    const result = []
    for (const file of files.filter(name => /^[0-9a-f-]{36}\.json$/iu.test(name))) {
      const operation = await readJson(join(this.directory,'operations',file))
      requireValue(operation?.schemaVersion === 1 && `${operation.operationId}.json` === file && UUID.test(operation.operationId)
        && NAME.test(operation.plan?.installName) && Array.isArray(operation.events) && operation.events.length <= 10,'HUB_STATE_CORRUPT')
      result.push(operation)
    }
    return result
  }
  async lock(name,operation) {
    await safePath(this.root); await safePath(this.directory)
    const device=(await lstat(this.root)).dev
    for (const part of ['locks','staging','backups','receipts','operations']) {
      await safePath(join(this.directory,part))
      requireValue((await lstat(join(this.directory,part))).dev === device,'HUB_UNSAFE_LOCAL_PATH')
    }
    return withFileLock(join(this.directory,'locks',sha256(`${this.root}/${name}`)), operation,{waitMs:10_000})
  }
  deviceKey(identity) { return sha256(jcs([identity.origin,identity.operator,identity.tenantId,identity.teamId,this.scope.hostScopeId])) }
  async invalidateDevice(identity) {
    const key = this.deviceKey(identity)
    await withFileLock(join(this.directory,'locks',`device-${key}`),async () => {
      const path=join(this.directory,'devices',`${key}.json`), device=await readJson(path)
      if (device?.deviceId === identity.deviceId) { await rm(path); await syncDirectory(dirname(path)) }
    },{waitMs:10_000})
  }
  async device(identity,bind) {
    const key = this.deviceKey(identity)
    const path = join(this.directory,'devices',`${key}.json`)
    return withFileLock(join(this.directory,'locks',`device-${key}`),async () => {
      let device = await readJson(path)
      if (!device) { device = await bind(); requireValue(UUID.test(device.deviceId) && typeof device.ownerRef === 'string' && device.ownerRef.length > 0 && device.ownerRef.length <= 128,'HUB_INVALID_RESPONSE'); await durableJson(path,device) }
      requireValue(UUID.test(device.deviceId) && typeof device.ownerRef === 'string','HUB_STATE_CORRUPT')
      return device
    },{waitMs:20_000})
  }
}
