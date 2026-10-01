/** Mandatory update policy: contract parsing, phase evaluation, and the polling client. */

import { readFileSync } from 'node:fs'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { compareSemVerVersions, parseSemVer } from './desktop-version-semver.ts'

/** Product-owned state file, persisted next to the shell's update state. */
export const DESKTOP_MANDATORY_POLICY_STATE_FILENAME = 'mandatory-policy-state.json'

const MAX_NOTICE_TITLE = 256
const MAX_NOTICE_DETAIL = 16_384
const MAX_NOTICE_LOCALE = 512
const MAX_POLICY_BODY_BYTES = 64 * 1024

/** Localized notice copy shipped with a directive. */
export interface DesktopMandatoryUpdateNotice {
  readonly title?: string
  readonly detail?: string
  readonly zh?: string
  readonly en?: string
}

/** Server-pushed directive from the version endpoint's optional `mandatory` field. */
export interface DesktopMandatoryUpdateDirective {
  readonly minVersion: string
  readonly notice?: DesktopMandatoryUpdateNotice
  readonly deadline?: string
}

export type DesktopMandatoryUpdatePhase = 'none' | 'notice' | 'blocking'

/** What the policy row reports to the launcher for the current generation. */
export interface DesktopMandatoryUpdateSnapshot {
  readonly phase: DesktopMandatoryUpdatePhase
  readonly minVersion?: string
  readonly notice?: DesktopMandatoryUpdateNotice
  readonly deadline?: string
  readonly observedAt: string
}

/**
 * Parse and validate the endpoint's optional `mandatory` object.
 * Anything malformed means "no directive" — the shell keeps booting and the
 * next poll retries; only a valid directive can ever restrict the app.
 */
export function parseDesktopMandatoryDirective(value: unknown): DesktopMandatoryUpdateDirective | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  if (typeof candidate.minVersion !== 'string' || parseSemVer(candidate.minVersion) === null) return undefined
  if (candidate.deadline !== undefined && (typeof candidate.deadline !== 'string' || Number.isNaN(Date.parse(candidate.deadline)))) {
    return undefined
  }
  let notice: DesktopMandatoryUpdateNotice | undefined
  if (candidate.notice !== undefined) {
    if (candidate.notice === null || typeof candidate.notice !== 'object' || Array.isArray(candidate.notice)) return undefined
    const raw = candidate.notice as Record<string, unknown>
    const bounded = (input: unknown, max: number): string | undefined => {
      if (input === undefined) return undefined
      if (typeof input !== 'string' || input.length === 0 || input.length > max) return undefined
      return input
    }
    const title = bounded(raw.title, MAX_NOTICE_TITLE)
    const detail = bounded(raw.detail, MAX_NOTICE_DETAIL)
    const zh = bounded(raw.zh, MAX_NOTICE_LOCALE)
    const en = bounded(raw.en, MAX_NOTICE_LOCALE)
    notice = {
      ...(title === undefined ? {} : { title }),
      ...(detail === undefined ? {} : { detail }),
      ...(zh === undefined ? {} : { zh }),
      ...(en === undefined ? {} : { en }),
    }
  }
  return {
    minVersion: candidate.minVersion,
    ...(notice === undefined ? {} : { notice }),
    ...(candidate.deadline === undefined ? {} : { deadline: candidate.deadline }),
  }
}

/**
 * Evaluate the phase for the running build.
 *
 * An unparseable current version fails closed (it counts as below the floor):
 * the app cannot prove it satisfies the policy, so the notice/blocking
 * surface stays visible until a real upgrade resolves the comparison.
 */
export function evaluateDesktopMandatoryUpdate(options: {
  directive: DesktopMandatoryUpdateDirective | undefined
  currentVersion: string
  now?: number
}): DesktopMandatoryUpdateSnapshot {
  const observedAt = new Date(options.now ?? Date.now()).toISOString()
  const directive = options.directive
  if (directive === undefined) return { phase: 'none', observedAt }
  const comparison = compareSemVerVersions(options.currentVersion, directive.minVersion)
  if (comparison !== null && comparison >= 0) return { phase: 'none', observedAt }
  const deadlineAt = directive.deadline === undefined ? undefined : Date.parse(directive.deadline)
  const past = deadlineAt !== undefined && !Number.isNaN(deadlineAt) && (options.now ?? Date.now()) >= deadlineAt
  const base = {
    ...(directive.notice === undefined ? {} : { notice: directive.notice }),
    ...(directive.deadline === undefined ? {} : { deadline: directive.deadline }),
  }
  return past
    ? { phase: 'blocking', minVersion: directive.minVersion, observedAt, ...base }
    : { phase: 'notice', minVersion: directive.minVersion, observedAt, ...base }
}

/** Persistence shape for {@link DESKTOP_MANDATORY_POLICY_STATE_FILENAME}. */
export interface DesktopMandatoryPolicyStateFile {
  readonly version: 1
  readonly snapshot: DesktopMandatoryUpdateSnapshot
}

/** Persist the last observed snapshot (crash-safe atomic write). */
export async function writeDesktopMandatoryPolicyState(
  statePath: string,
  snapshot: DesktopMandatoryUpdateSnapshot,
): Promise<void> {
  const file: DesktopMandatoryPolicyStateFile = { version: 1, snapshot }
  await writeFileAtomic(statePath, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
}

/** Read a persisted snapshot; a missing or malformed file means no block. */
export function readDesktopMandatoryPolicyState(statePath: string): DesktopMandatoryUpdateSnapshot | undefined {
  let content: string
  try {
    content = readFileSync(statePath, 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(content)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const file = parsed as DesktopMandatoryPolicyStateFile
    if (file.version !== 1 || file.snapshot === undefined || typeof file.snapshot.phase !== 'string') return undefined
    return file.snapshot
  } catch {
    return undefined
  }
}

/** Minimal fetch surface for the polling client (node fetch or an injected stub). */
export type DesktopPolicyRequest = (url: string, init: RequestInit) => Promise<Response>

/** One periodic policy check result, delivered to the row's reporting seam. */
export interface DesktopPolicyCheckOutcome {
  readonly snapshot: DesktopMandatoryUpdateSnapshot
  /** The raw parsed directive, when this response carried one. */
  readonly directive: DesktopMandatoryUpdateDirective | undefined
}

/**
 * Polling client: concurrent checks merge, failures back off exponentially and
 * KEEP the last blocking/notice snapshot, and only a valid response without a
 * `mandatory` field clears it. Semantics ported from the upstream
 * `apps/desktop/src/mandatory-update-policy.ts` (source commit noted in the
 * roadmap); the wire contract is Sensteed's own `mandatory` field.
 */
export class DesktopMandatoryUpdatePolicyClient {
  private pending: Promise<DesktopPolicyCheckOutcome> | undefined
  private failures = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private lastSnapshot: DesktopMandatoryUpdateSnapshot = { phase: 'none', observedAt: new Date(0).toISOString() }

  constructor(private readonly options: {
    readonly endpoint: string
    readonly currentVersion: string
    readonly request: DesktopPolicyRequest
    readonly onSnapshot: (snapshot: DesktopMandatoryUpdateSnapshot) => void
    readonly onState?: (statePath: string, snapshot: DesktopMandatoryUpdateSnapshot) => void | Promise<void>
    readonly statePath?: string
    readonly initialDelayMs?: number
    readonly intervalMs?: number
    readonly maxBackoffMs?: number
    readonly timeoutMs?: number
    readonly now?: () => number
    readonly signal?: AbortSignal
  }) {}

  get snapshot(): DesktopMandatoryUpdateSnapshot {
    return this.lastSnapshot
  }

  start(): void {
    if (this.disposed) return
    const initial = this.options.initialDelayMs ?? 60_000
    this.timer = setTimeout(() => { void this.runCheck() }, initial)
    this.timer.unref?.()
  }

  dispose(): void {
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
  }

  /** Run one check immediately; concurrent callers share the same flight. */
  check(): Promise<DesktopPolicyCheckOutcome> {
    this.pending ??= this.runOne().finally(() => { this.pending = undefined })
    return this.pending
  }

  private runCheck(): void {
    void this.check().catch(() => {})
  }

  private scheduleNext(): void {
    if (this.disposed) return
    const intervalMs = this.options.intervalMs ?? 6 * 60 * 60 * 1000
    const maxBackoffMs = this.options.maxBackoffMs ?? 30 * 60 * 1000
    const delay = this.failures === 0
      ? intervalMs
      : Math.min(maxBackoffMs, intervalMs * 2 ** Math.min(this.failures, 20))
    this.timer = setTimeout(() => { void this.runCheck() }, delay)
    this.timer.unref?.()
  }

  private async runOne(): Promise<DesktopPolicyCheckOutcome> {
    let directive: DesktopMandatoryUpdateDirective | undefined
    try {
      directive = await this.fetchDirective()
      const snapshot = evaluateDesktopMandatoryUpdate({
        directive,
        currentVersion: this.options.currentVersion,
        ...(this.options.now === undefined ? {} : { now: this.options.now() }),
      })
      this.failures = 0
      this.lastSnapshot = snapshot
      this.options.onSnapshot(snapshot)
      if (this.options.statePath !== undefined) await this.options.onState?.(this.options.statePath, snapshot)
      this.scheduleNext()
      return { snapshot, directive }
    } catch (cause) {
      // Network/parser failure: keep the last restrictive snapshot (never
      // clear a block because the policy service blinked), then back off.
      this.failures += 1
      if (this.lastSnapshot.phase !== 'none') this.options.onSnapshot(this.lastSnapshot)
      void cause
      this.scheduleNext()
      return { snapshot: this.lastSnapshot, directive }
    }
  }

  private async fetchDirective(): Promise<DesktopMandatoryUpdateDirective | undefined> {
    const timeoutMs = this.options.timeoutMs ?? 15_000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    timer.unref?.()
    this.options.signal?.addEventListener('abort', () => controller.abort(), { once: true })
    const response = await this.options.request(this.options.endpoint, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`mandatory policy endpoint returned ${String(response.status)}`)
    const length = Number(response.headers.get('content-length') ?? '0')
    if (length > MAX_POLICY_BODY_BYTES) throw new Error('mandatory policy response exceeded the body budget')
    const body = (await response.text()).slice(0, MAX_POLICY_BODY_BYTES)
    const parsed: unknown = JSON.parse(body)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('mandatory policy response is not an object')
    }
    const directive = parseDesktopMandatoryDirective((parsed as Record<string, unknown>).mandatory)
    return directive
  }
}
