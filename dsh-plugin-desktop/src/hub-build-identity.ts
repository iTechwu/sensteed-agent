/** Identity of the immutable installed base. Hub generations live outside this seal. */
import { createHash } from 'node:crypto'
import { createReadStream, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { hubSyncDigest } from './hub-sync-verifier.ts'

const fileSchema = z.strictObject({ path: z.string().min(1).max(1024), bytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/u) })
const manifestSchema = z.strictObject({ schemaVersion: z.literal('hub-sealed-base-v1'), archive: fileSchema, unpacked: z.array(fileSchema).max(300000), hostBuildDigest: z.string().regex(/^[a-f0-9]{64}$/u) })
export type HubBuildManifest = z.infer<typeof manifestSchema>
/** Used by both afterPack and startup; reads original-fs under Electron to avoid ASAR virtualization. */
export interface HubBuildFileAccess {
  lstat: typeof lstatSync
  readdir: typeof readdirSync
  readFile: typeof readFileSync
  createReadStream: typeof createReadStream
}
const nativeFiles: HubBuildFileAccess = { lstat: lstatSync, readdir: readdirSync, readFile: readFileSync, createReadStream }
function fail(message: string): never { throw new Error(`Hub base identity: ${message}`) }
async function file(root: string, path: string, fs: HubBuildFileAccess) {
  const absolute = join(root, path), stat = fs.lstat(absolute)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail('base entry is not an independent regular file')
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of fs.createReadStream(absolute)) {
    const content = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += content.length
    if (bytes > stat.size) fail('base entry changed while hashing')
    hash.update(content)
  }
  const after = fs.lstat(absolute)
  if (bytes !== stat.size || after.ino !== stat.ino || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) fail('base entry changed while hashing')
  return { path, bytes, sha256: hash.digest('hex') }
}
export async function calculateHubBuildManifest(resourcesPath: string, fs: HubBuildFileAccess = nativeFiles): Promise<HubBuildManifest> {
  const root = resolve(resourcesPath), archive = await file(root, 'app.asar', fs), paths: string[] = []
  const walk = (path: string): void => {
    const stat = fs.lstat(join(root, path))
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe base directory')
    for (const name of fs.readdir(join(root, path)) as string[]) {
      if (!name || name === '.' || name === '..' || /[\\/:\x00-\x1f]/u.test(name)) fail('unsafe base path')
      const child = `${path}/${name}`, childStat = fs.lstat(join(root, child))
      if (childStat.isSymbolicLink()) fail('base symlink is unsupported')
      if (childStat.isDirectory()) walk(child)
      else { if (!childStat.isFile()) fail('unsupported base entry'); paths.push(child) }
      if (paths.length > 300000) fail('base file budget exceeded')
    }
  }
  walk('app.asar.unpacked')
  const unpacked = []
  for (const path of paths.sort()) unpacked.push(await file(root, path, fs))
  const payload = { schemaVersion: 'hub-sealed-base-v1' as const, archive, unpacked }
  return { ...payload, hostBuildDigest: hubSyncDigest(payload) }
}
/** Recompute the installed base; the Hub's trusted runner pins this exact digest. */
export async function readPackagedHubBuildIdentity(appPath: string, resourcesPath: string, fs: HubBuildFileAccess = nativeFiles): Promise<Readonly<HubBuildManifest>> {
  if (resolve(appPath) !== join(resolve(resourcesPath), 'app.asar')) fail('enterprise proof requires the sealed ASAR base')
  const actual = manifestSchema.parse(await calculateHubBuildManifest(resourcesPath, fs))
  for (const item of actual.unpacked) Object.freeze(item)
  Object.freeze(actual.archive); Object.freeze(actual.unpacked)
  return Object.freeze(actual)
}
