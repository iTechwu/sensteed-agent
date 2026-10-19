/** Local transaction bookkeeping only: callers must verify Hub authorization and payloads first. */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { hubPackageIsHostOwned } from './hub-base-ownership.ts'

export const HUB_GENERATION_ORIGIN = 'https://ai.hozonauto.com/plugins/api' as const
const HASH = /^[a-f0-9]{64}$/u
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/u
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u
const MAX_METADATA = 1024 * 1024
const MAX_FILES = 20_000
const MAX_FILE_BYTES = 256 * 1024 * 1024
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024

export interface HubGenerationIdentity {
  readonly origin: typeof HUB_GENERATION_ORIGIN
  readonly tenantId: string
  readonly actorRef: string
  readonly deviceId: string
  readonly profileId: string
}
export interface HubGenerationPackage {
  readonly name: string
  /** Generation-relative package.json; its digest is separately listed in files. */
  readonly manifest: string
  readonly releaseId: string
  /** Signed payload/closure evidence reference, not a manifest-only integrity claim. */
  readonly payloadDigest: string
}
export interface HubVerifiedComposition {
  readonly entries: readonly { readonly id: string; readonly packageName: string; readonly config: Readonly<Record<string, unknown>> }[]
  readonly skills: readonly { readonly name: string; readonly path: string; readonly sha256: string }[]
}
export interface HubGenerationDescriptor {
  readonly schemaVersion: 1 | 2
  readonly verifiedComposition?: HubVerifiedComposition
  /** Signed-plan-derived tombstones used to suppress sealed bundled fallbacks. */
  readonly suppressedPackages?: readonly string[]
  readonly suppressedSkills?: readonly string[]
  readonly identity: HubGenerationIdentity
  readonly generationId: string
  readonly packages: readonly HubGenerationPackage[]
  readonly skillsRoot: string
  /** Exact regular-file set beneath this generation, excluding descriptor.json. */
  readonly files: Readonly<Record<string, string>>
}
interface Pointer { readonly generationId: string; readonly descriptorDigest: string }
export interface HubGenerationState {
  readonly schemaVersion: 1
  readonly scope: string
  readonly revision: number
  readonly phase: 'stable' | 'prepared' | 'verifying'
  readonly active: Pointer | null
  readonly pending: Pointer | null
  /** Durable prior checkpoint, retained until a later activation replaces it. */
  readonly previous: Pointer | null
}
declare const managedSelectionBrand: unique symbol
/** Opaque runtime capability. Only a revalidated active store can mint one. */
export interface HubManagedPackageSelection { readonly [managedSelectionBrand]: true }
const selections = new WeakMap<HubManagedPackageSelection, { store: HubGenerationStore; generationId: string; descriptorDigest: string; profileDirectory: string }>()
/** Validates scope and active contents before returning an exact managed manifest. */
export function hubManagedPackageManifest(selection: HubManagedPackageSelection, name: string, profileDirectory: string): string | undefined {
  const authority = selections.get(selection)
  if (authority === undefined) fail('invalid managed resolution capability')
  const state = authority.store.readState()
  if (state.active?.generationId !== authority.generationId || state.active.descriptorDigest !== authority.descriptorDigest) fail('stale managed resolution capability')
  const value = authority.store.activeDescriptor()
  if (value === undefined) fail('missing active generation')
  const generation = authority.store.generationDirectory(value.generationId)
  if (resolve(profileDirectory) !== authority.profileDirectory) fail('managed Profile anchor mismatch')
  const pkg = value.packages.find(item => item.name === name)
  return pkg === undefined ? undefined : join(generation, pkg.manifest)
}
/** Package-manager layout anchor for exact managed payload exports, distinct from logical settings ownership. */
export function hubManagedResolutionAnchor(selection: HubManagedPackageSelection, name: string, profileDirectory: string): string | undefined {
  const manifest = hubManagedPackageManifest(selection, name, profileDirectory)
  if (manifest === undefined) return undefined
  const authority = selections.get(selection)!
  return join(authority.store.generationDirectory(authority.generationId), 'profile', 'package.json')
}
function fail(message: string): never { throw new Error(`Hub generation: ${message}`) }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected an object')
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, expected: readonly string[]): void {
  if (Object.keys(value).sort().join('\0') !== [...expected].sort().join('\0')) fail('unexpected metadata fields')
}
function token(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !ID.test(value)) fail('invalid identity or generation token')
}
function digest(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !HASH.test(value)) fail('invalid digest')
}
function identity(value: unknown): HubGenerationIdentity {
  const item = record(value)
  keys(item, ['origin', 'tenantId', 'actorRef', 'deviceId', 'profileId'])
  if (item.origin !== HUB_GENERATION_ORIGIN) fail('wrong Hub origin')
  for (const key of ['tenantId', 'deviceId', 'profileId']) if (typeof item[key] !== 'string' || !UUID.test(item[key])) fail('invalid identity UUID')
  if (typeof item.actorRef !== 'string' || !item.actorRef.length || item.actorRef.length > 128 || /[\x00-\x1f\x7f]/u.test(item.actorRef)) fail('invalid actor reference')
  return item as unknown as HubGenerationIdentity
}
export function hubGenerationScope(value: HubGenerationIdentity): string {
  const valid = identity(value)
  return hash(JSON.stringify([valid.origin, valid.tenantId, valid.actorRef, valid.deviceId, valid.profileId]))
}
function hash(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex') }
function safeRelative(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 1024 || value.includes('\\') || value.includes('\0') || isAbsolute(value)
    || value.split('/').some(part => !part || part === '.' || part === '..' || /[:\x00-\x1f]/u.test(part)
      || /[. ]$/u.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) fail('unsafe relative path')
}
function present(path: string): boolean {
  try { lstatSync(path); return true } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false; throw cause }
}
function privateStat(path: string, directory: boolean): void {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) fail('symlink or wrong filesystem type')
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) fail('foreign filesystem owner')
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) fail('filesystem entry is not private')
  if (!directory && stat.nlink !== 1) fail('hardlinked metadata or payload')
}
/** Never traverses an existing link, including ancestors of the private data root. */
function safeAncestors(path: string): void {
  const parent = dirname(path)
  if (parent !== path) safeAncestors(parent)
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe ancestor')
}
function privateDirectory(path: string): void {
  if (!present(path)) mkdirSync(path, { mode: 0o700 })
  privateStat(path, true)
}
function boundedRead(path: string): Buffer {
  privateStat(path, false)
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > MAX_METADATA || stat.nlink !== 1) fail('metadata is oversized or not regular')
    const bytes = readFileSync(fd)
    if (bytes.length > MAX_METADATA) fail('oversized metadata')
    return bytes
  } finally { closeSync(fd) }
}
function durableWrite(path: string, value: unknown): void {
  const bytes = `${JSON.stringify(value)}\n`
  if (Buffer.byteLength(bytes) > MAX_METADATA) fail('oversized metadata')
  if (present(path)) privateStat(path, false)
  const temp = `${path}.${randomUUID()}.tmp`
  const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
  try {
    try { writeFileSync(fd, bytes); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(temp, path)
    if (process.platform !== 'win32') {
      const parent = openSync(dirname(path), constants.O_RDONLY)
      try { fsyncSync(parent) } finally { closeSync(parent) }
    }
  } finally { if (present(temp)) unlinkSync(temp) }
}
function pointer(value: unknown): Pointer | null {
  if (value === null) return null
  const item = record(value); keys(item, ['generationId', 'descriptorDigest'])
  token(item.generationId); digest(item.descriptorDigest)
  return item as unknown as Pointer
}
function descriptor(value: unknown, expected: HubGenerationIdentity): HubGenerationDescriptor {
  const item = record(value)
  keys(item, ['schemaVersion', 'identity', 'generationId', 'packages', 'skillsRoot', 'files', ...(item.schemaVersion === 2 ? ['verifiedComposition'] : []), ...(item.schemaVersion === 2 && Object.hasOwn(item, 'suppressedPackages') ? ['suppressedPackages'] : []), ...(item.schemaVersion === 2 && Object.hasOwn(item, 'suppressedSkills') ? ['suppressedSkills'] : [])])
  if (![1, 2].includes(item.schemaVersion as number) || hubGenerationScope(identity(item.identity)) !== hubGenerationScope(expected)) fail('cross-profile or identity mismatch')
  token(item.generationId); safeRelative(item.skillsRoot)
  if (!Array.isArray(item.packages) || item.packages.length > 1024) fail('invalid package list')
  const names = new Set<string>()
  for (const raw of item.packages) {
    const pkg = record(raw); keys(pkg, ['name', 'manifest', 'releaseId', 'payloadDigest'])
    if (typeof pkg.name !== 'string' || !PACKAGE.test(pkg.name) || names.has(pkg.name)) fail('invalid or duplicate package name')
    if (hubPackageIsHostOwned(pkg.name)) fail('managed package cannot replace Host-owned core')
    names.add(pkg.name); safeRelative(pkg.manifest); token(pkg.releaseId); digest(pkg.payloadDigest)
    if (!pkg.manifest.startsWith('profile/node_modules/') || !pkg.manifest.endsWith('/package.json')) fail('package manifest path required')
  }
  const files = record(item.files), paths = Object.keys(files)
  if (paths.length > MAX_FILES) fail('too many files')
  const folded = new Set<string>()
  for (const path of paths) {
    safeRelative(path); digest(files[path])
    if (path === 'descriptor.json' || path !== path.normalize('NFC') || folded.has(path.toLowerCase())) fail('reserved or colliding path')
    folded.add(path.toLowerCase())
  }
  for (const raw of item.packages) if (!Object.hasOwn(files, record(raw).manifest as string)) fail('package manifest missing from file set')
  if (item.schemaVersion === 2) {
    for (const [field, pattern] of [['suppressedPackages', PACKAGE], ['suppressedSkills', /^[a-z0-9]+(?:-[a-z0-9]+)*$/u]] as const) {
      const values = item[field]
      if (values === undefined) continue
      if (!Array.isArray(values) || values.length > 1024 || values.some(value => typeof value !== 'string' || !pattern.test(value))) fail(`invalid ${field}`)
      if (new Set(values).size !== values.length) fail(`duplicate ${field}`)
    }
    const composition = record(item.verifiedComposition); keys(composition, ['entries', 'skills'])
    if (!Array.isArray(composition.entries) || composition.entries.length > 1024 || !Array.isArray(composition.skills) || composition.skills.length > 1024) fail('invalid verified composition')
    const ids = new Set<string>(), skills = new Set<string>()
    for (const raw of composition.entries) {
      const entry = record(raw); keys(entry, ['id', 'packageName', 'config']); token(entry.id)
      if (ids.has(entry.id)) fail('duplicate composition entry'); ids.add(entry.id)
      if (typeof entry.packageName !== 'string' || !PACKAGE.test(entry.packageName) || !names.has(entry.packageName)) fail('composition package outside managed set')
      const config = record(entry.config)
      const check = (value: unknown, depth = 0): void => {
        if (depth > 32) fail('composition depth limit')
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return
        if (typeof value === 'number' && Number.isFinite(value)) return
        if (Array.isArray(value)) { for (const child of value) check(child, depth + 1); return }
        if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
          for (const [key, child] of Object.entries(value)) {
            if (['__proto__', 'prototype', 'constructor', '__jsExpr'].includes(key)) fail('unsafe composition key')
            check(child, depth + 1)
          }
          return
        }
        fail('non-JSON composition')
      }
      check(config)
      if (Buffer.byteLength(JSON.stringify(config)) > 64 * 1024) fail('composition config limit')
    }
    for (const raw of composition.skills) {
      const skill = record(raw); keys(skill, ['name', 'path', 'sha256'])
      if (typeof skill.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(skill.name) || skills.has(skill.name)) fail('invalid composition skill')
      skills.add(skill.name); safeRelative(skill.path); digest(skill.sha256)
      if (!skill.path.startsWith(`${item.skillsRoot as string}/`) || !skill.path.endsWith('/SKILL.md') || files[skill.path] !== skill.sha256) fail('composition skill outside verified file set')
    }
  }
  return JSON.parse(JSON.stringify(item)) as HubGenerationDescriptor
}

/** Durable local state, not an authorization, signature, stager or loaded-health verifier. */
export class HubGenerationStore {
  readonly directory: string
  readonly scope: string
  readonly identity: HubGenerationIdentity
  readonly root: string
  constructor(root: string, owner: HubGenerationIdentity) {
    if (!isAbsolute(root) || resolve(root) !== root) fail('absolute normalized root required')
    safeAncestors(root); privateStat(root, true)
    this.root = root
    this.identity = Object.freeze({ ...identity(owner) })
    this.scope = hubGenerationScope(owner)
    privateDirectory(join(root, 'hub-managed'))
    this.directory = join(root, 'hub-managed', this.scope)
    privateDirectory(this.directory); privateDirectory(join(this.directory, 'generations'))
  }
  /** Caller stages files privately here before prepare; never stage into active generations. */
  generationDirectory(generationId: string): string {
    token(generationId)
    return join(this.directory, 'generations', generationId)
  }
  private checkDirectories(): void {
    safeAncestors(this.directory); privateStat(this.directory, true)
    privateStat(dirname(this.directory), true); privateStat(join(this.directory, 'generations'), true)
  }
  readState(): HubGenerationState {
    this.checkDirectories()
    const path = join(this.directory, 'state.json')
    if (!present(path)) return { schemaVersion: 1, scope: this.scope, revision: 0, phase: 'stable', active: null, pending: null, previous: null }
    const item = record(JSON.parse(boundedRead(path).toString('utf8')))
    keys(item, ['schemaVersion', 'scope', 'revision', 'phase', 'active', 'pending', 'previous'])
    if (item.schemaVersion !== 1 || item.scope !== this.scope || !Number.isSafeInteger(item.revision) || (item.revision as number) < 1) fail('invalid state identity/revision')
    const active = pointer(item.active), pending = pointer(item.pending), previous = pointer(item.previous)
    if (item.phase === 'stable' ? pending !== null
      : item.phase === 'prepared' ? pending === null
      : item.phase === 'verifying' ? active === null || pending !== null
      : true) fail('invalid state transition record')
    if (active !== null && (active.generationId === pending?.generationId || active.generationId === previous?.generationId)) fail('generation pointers collide')
    if(previous!==null&&active===null)fail('previous checkpoint requires an active generation')
    return { schemaVersion: 1, scope: this.scope, revision: item.revision as number, phase: item.phase as HubGenerationState['phase'], active, pending, previous }
  }
  private verifyFiles(value: HubGenerationDescriptor): void {
    this.checkDirectories()
    const root = this.generationDirectory(value.generationId)
    privateStat(root, true)
    const actual: string[] = []; let total = 0; let entries = 0
    const walk = (directory: string, depth = 0): void => {
      if (depth > 64) fail('directory depth limit')
      for (const name of readdirSync(directory)) {
        if (++entries > MAX_FILES * 2) fail('directory entry limit')
        const path = join(directory, name), offset = relative(root, path).split(sep).join('/')
        safeRelative(offset)
        const stat = lstatSync(path)
        if (stat.isDirectory() && !stat.isSymbolicLink()) { privateStat(path, true); walk(path, depth + 1); continue }
        if (offset === 'descriptor.json') { privateStat(path, false); continue }
        privateStat(path, false)
        if (stat.size > MAX_FILE_BYTES || (total += stat.size) > MAX_TOTAL_BYTES || actual.length >= MAX_FILES) fail('payload size limit')
        if (hash(readFileSync(path)) !== value.files[offset]) fail('payload digest mismatch')
        actual.push(offset)
      }
    }
    walk(root)
    if (actual.sort().join('\0') !== Object.keys(value.files).sort().join('\0')) fail('payload file set mismatch')
    const skills = join(root, value.skillsRoot)
    privateStat(skills, true)
    for (const pkg of value.packages) {
      const manifest = JSON.parse(boundedRead(join(root, pkg.manifest)).toString('utf8')) as { name?: unknown }
      if (manifest.name !== pkg.name) fail('package identity mismatch')
    }
    if (realpathSync(root) !== root) fail('generation escaped its directory')
  }
  private load(ref: Pointer): HubGenerationDescriptor {
    this.checkDirectories()
    privateStat(this.generationDirectory(ref.generationId), true)
    const bytes = boundedRead(join(this.generationDirectory(ref.generationId), 'descriptor.json'))
    if (hash(bytes) !== ref.descriptorDigest) fail('descriptor tampering')
    const value = descriptor(JSON.parse(bytes.toString('utf8')), this.identity)
    if (value.generationId !== ref.generationId) fail('generation mismatch')
    this.verifyFiles(value)
    return value
  }
  /** Revalidates descriptor and all declared files; returns detached data, never a live mutable store object. */
  activeDescriptor(): HubGenerationDescriptor | undefined {
    const state = this.readState()
    return state.active === null ? undefined : this.load(state.active)
  }
  /** Scope-bound exact-selection authority; no authorization or loaded-health claim. */
  managedSelection(profileDirectory?: string): HubManagedPackageSelection {
    const state = this.readState()
    if (state.active === null) fail('no active managed generation')
    this.load(state.active)
    const capability = Object.freeze({}) as HubManagedPackageSelection
    const anchor = profileDirectory ?? join(this.generationDirectory(state.active.generationId), 'profile')
    if (!isAbsolute(anchor) || resolve(anchor) !== anchor) fail('invalid logical Profile directory')
    safeAncestors(anchor)
    selections.set(capability, { store: this, generationId: state.active.generationId, descriptorDigest: state.active.descriptorDigest, profileDirectory: anchor })
    return capability
  }
  private async update(action: (state: HubGenerationState) => Omit<HubGenerationState, 'revision'>): Promise<HubGenerationState> {
    this.checkDirectories()
    const path = join(this.directory, 'state.json')
    if (present(`${path}.lock`)) privateStat(`${path}.lock`, false)
    return await withFileLock(path, async () => {
      this.checkDirectories()
      const state = this.readState(), next = { ...action(state), revision: state.revision + 1 }
      durableWrite(path, next)
      return next
    })
  }
  /** Caller asserts external release, closure, target and authorization checks already succeeded. */
  async prepare(validatedDescriptor: HubGenerationDescriptor): Promise<HubGenerationState> {
    const value = descriptor(validatedDescriptor, this.identity)
    return await this.update(state => {
      if (state.phase !== 'stable') fail('another generation transaction is pending')
      this.verifyFiles(value)
      const path = join(this.generationDirectory(value.generationId), 'descriptor.json')
      if (present(path)) fail('generation is already sealed')
      durableWrite(path, value)
      const pending = { generationId: value.generationId, descriptorDigest: hash(boundedRead(path)) }
      return { ...state, phase: 'prepared', pending }
    })
  }
  /** Must run only after old writers/processes have stopped, and after fresh external authorization checks. */
  async discardPrepared(expectedRevision: number, descriptorDigest: string): Promise<HubGenerationState> {
    return await this.update(state => {
      if(state.revision!==expectedRevision || state.phase!=='prepared' || state.pending?.descriptorDigest!==descriptorDigest) fail('prepared recovery state changed')
      return {...state,phase:'stable',pending:null}
    })
  }
  /** Must run only after old writers/processes have stopped, and after fresh external authorization checks. */
  async activate(): Promise<HubGenerationState> {
    return await this.update(state => {
      if (state.phase !== 'prepared' || state.pending === null) fail('no prepared generation')
      this.load(state.pending)
      if (state.active !== null) this.load(state.active)
      return { ...state, phase: 'verifying', active: state.pending, pending: null, previous: state.active }
    })
  }
  /** Caller supplies actual Host/plugin/renderer/skill health evidence; this method does not infer loaded status. */
  async markHealthy(generationId: string): Promise<HubGenerationState> {
    return await this.update(state => {
      if (state.phase !== 'verifying' || state.active?.generationId !== generationId) fail('health does not match activating generation')
      this.load(state.active)
      // The execution journal and offline lease are committed after this file.
      // Keep the prior checkpoint so a crash between those commits is recoverable.
      return { ...state, phase: 'stable' }
    })
  }
  /** Startup crash recovery is explicit: an unconfirmed activation returns to the last healthy generation. */
  async rollback(expectedRevision?: number): Promise<HubGenerationState> {
    return await this.update(state => {
      if (state.phase !== 'verifying' && !(state.phase === 'stable' && state.previous !== null)) fail('no unconfirmed activation to roll back')
      if (expectedRevision !== undefined && state.revision !== expectedRevision) fail('recovery state changed')
      if (state.previous !== null) this.load(state.previous)
      return { ...state, phase: 'stable', active: state.previous, previous: null, pending: null }
    })
  }
  async recover(): Promise<HubGenerationState> {
    const state = this.readState()
    return state.phase === 'verifying' ? await this.rollback(state.revision) : state
  }
}
