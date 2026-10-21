/** Installation lock precedes every Profile/store lock. A dead installer PID never clears handoff. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
const BuildSchema = z.strictObject({ hostBuildDigest: digest, sensteedVersion: z.string().min(1).max(120) })
type Build = z.infer<typeof BuildSchema>
const OperationSchema = z.strictObject({
  id: z.uuid(), kind: z.enum(['hub-generation', 'hub-stage', 'profile-switch', 'installer']),
  pid: z.number().int().positive(), phase: z.enum(['running', 'completed', 'interrupted', 'handoff']),
  startedAt: z.iso.datetime(), installerPid: z.number().int().positive().optional(),
  sourceBuild: BuildSchema.optional(), targetVersion: z.string().min(1).max(120).optional(),
  completion: z.enum(['installed', 'cancelled']).optional(),
})
const JournalSchema = z.strictObject({ schemaVersion: z.literal(1), installDigest: digest,
  hubRoots: z.array(z.string()).max(256), operation: OperationSchema, recoveredOperation: OperationSchema.optional() })
type Journal = z.infer<typeof JournalSchema>
export type DesktopMaintenanceKind = z.infer<typeof OperationSchema>['kind']
type Held = { path: string; active: boolean; journal: Journal; build: Build | undefined; save(): Promise<void> }
const held = new AsyncLocalStorage<Held>()
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' }
}
async function privateFile(path: string) {
  const stat = await lstat(path)
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024
    || typeof process.getuid === 'function' && stat.uid !== process.getuid()
    || process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw Error('Unsafe maintenance metadata')
}
async function json(path: string): Promise<unknown | undefined> {
  try { await privateFile(path); return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}
async function quiescent(roots: readonly string[]) {
  for (const root of roots) {
    let entries: import('node:fs').Dirent[]
    try { entries = await readdir(join(root, 'hub-managed'), { withFileTypes: true }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/u.test(entry.name)) throw Error('Unsafe Hub maintenance scope')
      const path = join(root, 'hub-managed', entry.name)
      const state = await json(join(path, 'state.json')) as { phase?: unknown } | undefined
      const record = await json(join(path, 'execution.json')) as { phase?: unknown; pendingReceipt?: unknown; consumptionStarted?: unknown } | undefined
      if (state && state.phase !== 'stable' || record && (record.pendingReceipt !== null
        || !['ACTIVATED', 'ROLLED_BACK'].includes(String(record.phase))
        && !(record.phase === 'NEEDS_ATTENTION' && record.consumptionStarted === false))) throw Error('DESKTOP_HUB_RECOVERY_REQUIRED')
    }
  }
}
export class DesktopMaintenanceCoordinator {
  readonly installRoot: string
  readonly stateRoot: string
  private build: Build | undefined
  constructor(installRoot: string, stateRoot: string) { this.installRoot = installRoot; this.stateRoot = stateRoot }
  private async location() {
    const install = await realpath(this.installRoot)
    const installDigest = createHash('sha256').update(process.platform === 'win32' ? install.toLowerCase() : install).digest('hex')
    await mkdir(this.stateRoot, { recursive: true, mode: 0o700 })
    const directory = join(await realpath(this.stateRoot), installDigest), path = join(directory, 'journal.json')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const stat = await lstat(directory)
    if (await realpath(directory) !== directory || stat.isSymbolicLink()
      || typeof process.getuid === 'function' && stat.uid !== process.getuid()
      || process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw Error('Unsafe maintenance directory')
    return { directory, path, installDigest }
  }
  private async save(path: string, journal: Journal) {
    await writeFileAtomic(path, JSON.stringify(JournalSchema.parse(journal)), { mode: 0o600, dirMode: 0o700 })
    const file = await open(path, 'r'); try { await file.sync() } finally { await file.close() }
    if (process.platform !== 'win32') { const dir = await open(dirname(path), 'r'); try { await dir.sync() } finally { await dir.close() } }
  }
  /** Called only with the launcher's recomputed sealed build, never a renderer value. */
  async confirmBuild(value: Build): Promise<void> {
    const build = BuildSchema.parse(value), { path, installDigest } = await this.location()
    this.build = build
    await withFileLock(path, async () => {
      const input = await json(path); if (input === undefined) return
      const previous = JournalSchema.parse(input)
      if (previous.installDigest !== installDigest) throw Error('Maintenance installation mismatch')
      if (previous.operation.phase !== 'handoff') return
      const operation = previous.operation
      if (!operation.sourceBuild || operation.sourceBuild.hostBuildDigest === build.hostBuildDigest
        || operation.targetVersion !== build.sensteedVersion) throw Error('DESKTOP_INSTALLATION_RECOVERY_REQUIRED')
      previous.operation = { ...operation, phase: 'completed', completion: 'installed' }
      previous.recoveredOperation = operation
      await this.save(path, previous)
    }, { waitMs: 30_000 })
  }
  /** Explicit native user recovery after cancelling installation; process exit alone never calls this. */
  async recoverCancelledInstallation(): Promise<void> {
    const { path } = await this.location()
    await withFileLock(path, async () => {
      const input = await json(path); if (input === undefined) return
      const previous = JournalSchema.parse(input), operation = previous.operation
      if (operation.phase !== 'handoff') return
      if (!this.build || operation.sourceBuild?.hostBuildDigest !== this.build.hostBuildDigest
        || operation.installerPid && alive(operation.installerPid)) throw Error('DESKTOP_INSTALLATION_RECOVERY_REQUIRED')
      previous.operation = { ...operation, phase: 'completed', completion: 'cancelled' }
      previous.recoveredOperation = operation
      await this.save(path, previous)
    }, { waitMs: 30_000 })
  }
  async run<T>(kind: DesktopMaintenanceKind, action: () => Promise<T>, hubRoot?: string): Promise<T> {
    const { path, installDigest } = await this.location(), nested = held.getStore()
    if (nested?.active && nested.path === path) {
      if (hubRoot) { const root = await realpath(hubRoot); if (!nested.journal.hubRoots.includes(root)) { nested.journal.hubRoots.push(root); await nested.save() } }
      return await action()
    }
    return await withFileLock(path, async () => {
      const input = await json(path), previous = input === undefined ? undefined : JournalSchema.parse(input)
      if (previous && previous.installDigest !== installDigest) throw Error('Maintenance installation mismatch')
      if (previous?.operation.phase === 'handoff') throw Error('DESKTOP_INSTALLATION_RECOVERY_REQUIRED')
      const roots = [...new Set([...(previous?.hubRoots ?? []), ...(hubRoot ? [await realpath(hubRoot)] : [])])]
      if (kind === 'installer') await quiescent(roots)
      const interrupted = previous && previous.operation.phase !== 'completed' ? previous.operation : undefined
      const journal: Journal = { schemaVersion: 1, installDigest, hubRoots: roots,
        operation: { id: randomUUID(), kind, pid: process.pid, phase: 'running', startedAt: new Date().toISOString() },
        ...(interrupted ? { recoveredOperation: interrupted } : {}) }
      const context: Held = { path, active: true, journal, build: this.build, save: () => this.save(path, journal) }
      await context.save()
      try { return await held.run(context, action) }
      catch (error) { if (journal.operation.phase !== 'handoff') journal.operation.phase = 'interrupted'; throw error }
      finally { context.active = false; if (journal.operation.phase === 'running') journal.operation.phase = 'completed'; await context.save() }
    }, { waitMs: 30_000 })
  }
}
/** Created on first use: module import must stay side-effect-free for unit tests (vitest serves a web-style import.meta.url). */
let defaultCoordinator: DesktopMaintenanceCoordinator | undefined
function coordinator(): DesktopMaintenanceCoordinator {
  return defaultCoordinator ??= new DesktopMaintenanceCoordinator(dirname(fileURLToPath(new URL('../package.json', import.meta.url))), join(homedir(), '.sensteed', 'maintenance'))
}
export function withDesktopMaintenance<T>(kind: DesktopMaintenanceKind, action: () => Promise<T>, hubRoot?: string) { return coordinator().run(kind, action, hubRoot) }
export function confirmDesktopMaintenanceBuild(build: Build) { return coordinator().confirmBuild(build) }
export function recoverCancelledDesktopInstallation() { return coordinator().recoverCancelledInstallation() }
/** Persist handoff before the launcher exits; only verified new-build startup or explicit cancellation clears it. */
export async function recordDesktopInstallerHandoff(targetVersion: string, installerPid?: number): Promise<void> {
  const context = held.getStore()
  if (!context?.active || context.journal.operation.kind !== 'installer' || !context.build
    || installerPid !== undefined && (!Number.isSafeInteger(installerPid) || installerPid <= 0)) throw Error('Invalid installer handoff')
  context.journal.operation = OperationSchema.parse({ ...context.journal.operation, phase: 'handoff',
    sourceBuild: context.build, targetVersion, ...(installerPid === undefined ? {} : { installerPid }) })
  await context.save()
}
