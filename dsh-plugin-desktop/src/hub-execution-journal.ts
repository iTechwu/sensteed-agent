/** Durable local bookkeeping, never proof of Hub authorization. No bearer or execution grant is persisted. */
import { z } from 'zod'
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { HubGenerationStore } from './hub-generation-store.ts'
import { generationPlanData, type VerifiedHubGenerationPlan } from './hub-generation-verifier.ts'
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
const recordSchema = z.strictObject({
  schemaVersion: z.literal(1), scope: digest, planId: z.uuid(), planDigest: digest, operationId: z.uuid(),
  previousGenerationDigest: digest.nullable(), generationDigest: digest,
  phase: z.enum(['DOWNLOADING', 'CONSUMING', 'AUTHORIZED', 'STAGED', 'COMMITTED', 'ACTIVATED', 'ROLLED_BACK', 'NEEDS_ATTENTION']),
  revision: z.number().int().nonnegative(), receiptSeq: z.number().int().nonnegative(),
  executionGeneration: z.string().regex(/^[1-9][0-9]*$/u).nullable(), executionExpiresAt: z.iso.datetime().nullable(),
  descriptorDigest: digest.nullable(),
})
export type HubExecutionRecord = Readonly<z.infer<typeof recordSchema>>
const transitions: Record<HubExecutionRecord['phase'], readonly HubExecutionRecord['phase'][]> = {
  DOWNLOADING: ['CONSUMING', 'NEEDS_ATTENTION'], CONSUMING: ['AUTHORIZED', 'NEEDS_ATTENTION'],
  AUTHORIZED: ['STAGED', 'NEEDS_ATTENTION', 'ROLLED_BACK'], STAGED: ['COMMITTED', 'NEEDS_ATTENTION', 'ROLLED_BACK'],
  COMMITTED: ['ACTIVATED', 'NEEDS_ATTENTION', 'ROLLED_BACK'], NEEDS_ATTENTION: ['NEEDS_ATTENTION', 'ROLLED_BACK'],
  ACTIVATED: [], ROLLED_BACK: [],
}
function privateEntry(path: string, directory: boolean): void {
  const s = lstatSync(path)
  if (s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile() || s.nlink !== 1)
    || typeof process.getuid === 'function' && s.uid !== process.getuid()
    || process.platform !== 'win32' && (s.mode & 0o077) !== 0) throw new Error('Unsafe Hub execution journal')
}
export class HubExecutionJournal {
  private readonly path: string
  constructor(private readonly store: HubGenerationStore) { this.path = join(store.directory, 'execution.json'); this.check() }
  private check(): void {
    if (realpathSync(this.store.directory) !== this.store.directory) throw new Error('Unsafe Hub execution journal root')
    privateEntry(this.store.directory, true)
    if (existsSync(this.path)) privateEntry(this.path, false)
    if (existsSync(`${this.path}.lock`)) privateEntry(`${this.path}.lock`, false)
  }
  read(): HubExecutionRecord | undefined {
    this.check(); if (!existsSync(this.path)) return undefined
    const fd = openSync(this.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      if (fstatSync(fd).size > 8192) throw new Error('Oversized Hub execution journal')
      const value = recordSchema.parse(JSON.parse(readFileSync(fd, 'utf8')))
      if (value.scope !== this.store.scope) throw new Error('Hub execution journal identity mismatch')
      return Object.freeze(value)
    } finally { closeSync(fd) }
  }
  private write(value: HubExecutionRecord): void {
    const temp = `${this.path}.${randomUUID()}.tmp`
    const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
    try { writeFileSync(fd, JSON.stringify(recordSchema.parse(value))); fsyncSync(fd) } finally { closeSync(fd) }
    try {
      this.check(); renameSync(temp, this.path)
      if (process.platform !== 'win32') { const dir = openSync(this.store.directory, constants.O_RDONLY); try { fsyncSync(dir) } finally { closeSync(dir) } }
    } finally { if (existsSync(temp)) unlinkSync(temp) }
  }
  async begin(cap: VerifiedHubGenerationPlan, operationId = randomUUID()): Promise<HubExecutionRecord> {
    this.check()
    const plan = generationPlanData(cap)
    for (const key of ['origin', 'tenantId', 'actorRef', 'deviceId', 'profileId'] as const) {
      if (plan[key] !== this.store.identity[key]) throw new Error('Hub execution plan identity mismatch')
    }
    return await withFileLock(this.path, async () => {
      const old = this.read()
      if (old && old.phase !== 'ACTIVATED' && old.phase !== 'ROLLED_BACK') throw new Error('Hub execution is already pending')
      const value = recordSchema.parse({ schemaVersion: 1, scope: this.store.scope, planId: plan.planId, planDigest: plan.planDigest,
        operationId, previousGenerationDigest: plan.expectedActiveGenerationDigest, generationDigest: plan.proposedGenerationDigest,
        phase: 'DOWNLOADING', revision: (old?.revision ?? -1) + 1, receiptSeq: 0, executionGeneration: null, executionExpiresAt: null, descriptorDigest: null })
      this.write(value); return Object.freeze(value)
    })
  }
  /** Revision compare prevents stale workers from committing a different operation or phase. */
  async advance(expected: Pick<HubExecutionRecord, 'operationId' | 'revision'>, phase: HubExecutionRecord['phase'], update: {
    readonly executionGeneration?: string; readonly executionExpiresAt?: string; readonly descriptorDigest?: string; readonly receiptSeq?: number
  } = {}): Promise<HubExecutionRecord> {
    this.check()
    return await withFileLock(this.path, async () => {
      const old = this.read()
      if (!old || old.operationId !== expected.operationId || old.revision !== expected.revision) throw new Error('Stale Hub execution worker')
      if (!transitions[old.phase].includes(phase)) throw new Error('Invalid Hub execution phase transition')
      const value = recordSchema.parse({ ...old, ...update, phase, revision: old.revision + 1 })
      if (value.receiptSeq < old.receiptSeq || value.receiptSeq > old.receiptSeq + 1) throw new Error('Invalid Hub receipt sequence')
      if (old.executionGeneration !== null && value.executionGeneration !== old.executionGeneration) throw new Error('Hub execution generation changed')
      if (phase === 'AUTHORIZED' && (!value.executionGeneration || !value.executionExpiresAt || Date.parse(value.executionExpiresAt) <= Date.now())) throw new Error('Hub execution authorization missing')
      this.write(value); return Object.freeze(value)
    })
  }
}
