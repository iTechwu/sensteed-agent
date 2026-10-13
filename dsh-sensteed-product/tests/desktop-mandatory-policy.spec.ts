import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DesktopMandatoryUpdatePolicyClient,
  DESKTOP_MANDATORY_POLICY_STATE_FILENAME,
  evaluateDesktopMandatoryUpdate,
  parseDesktopMandatoryDirective,
  type DesktopMandatoryUpdateDirective,
} from '../src/desktop-mandatory-policy.ts'

const NOW = Date.parse('2026-10-01T12:00:00Z')
const DIRECTIVE: DesktopMandatoryUpdateDirective = {
  minVersion: '2.1.0',
  notice: { title: '需要更新', zh: '请尽快升级' },
  deadline: '2026-10-15T00:00:00Z',
}

const homes: string[] = []

afterEach(() => {
  while (homes.length > 0) {
    const home = homes.pop()
    if (home !== undefined) rmSync(home, { recursive: true, force: true })
  }
})

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('mandatory update directive parsing', () => {
  it('accepts a well-formed directive', () => {
    expect(parseDesktopMandatoryDirective(DIRECTIVE)).toEqual(DIRECTIVE)
  })

  it('rejects malformed minVersion, deadline, notice shapes, and non-objects', () => {
    expect(parseDesktopMandatoryDirective({ minVersion: 'not-semver' })).toBeUndefined()
    expect(parseDesktopMandatoryDirective({ minVersion: '2.1.0', deadline: 'tomorrow' })).toBeUndefined()
    expect(parseDesktopMandatoryDirective({ minVersion: '2.1.0', notice: 'text' })).toBeUndefined()
    expect(parseDesktopMandatoryDirective({ minVersion: '2.1.0', notice: { title: 'x'.repeat(257) } })).toBeUndefined()
    expect(parseDesktopMandatoryDirective('nope')).toBeUndefined()
  })
})

describe('mandatory update phase evaluation', () => {
  it('is none without a directive or when the build meets the floor', () => {
    expect(evaluateDesktopMandatoryUpdate({ directive: undefined, currentVersion: '2.0.0', now: NOW }).phase).toBe('none')
    expect(evaluateDesktopMandatoryUpdate({ directive: DIRECTIVE, currentVersion: '2.1.0', now: NOW }).phase).toBe('none')
  })

  it('is notice before the deadline and blocking after it', () => {
    expect(evaluateDesktopMandatoryUpdate({ directive: DIRECTIVE, currentVersion: '2.0.0', now: NOW }).phase).toBe('notice')
    expect(evaluateDesktopMandatoryUpdate({ directive: DIRECTIVE, currentVersion: '2.0.0', now: Date.parse('2026-10-16T00:00:00Z') }).phase).toBe('blocking')
  })

  it('fails closed for an unparseable current version', () => {
    expect(evaluateDesktopMandatoryUpdate({ directive: DIRECTIVE, currentVersion: 'garbage', now: NOW }).phase).toBe('notice')
  })

  it('treats a directive without a deadline as permanently noticed', () => {
    const noDeadline = { minVersion: '2.1.0' }
    expect(evaluateDesktopMandatoryUpdate({ directive: noDeadline, currentVersion: '2.0.0', now: NOW }).phase).toBe('notice')
    expect(evaluateDesktopMandatoryUpdate({ directive: noDeadline, currentVersion: '2.0.0', now: NOW }).minVersion).toBe('2.1.0')
  })
})

describe('mandatory update policy client', () => {
  function policyHome(): string {
    const home = mkdtempSync(join(tmpdir(), 'dsh-mandatory-policy-'))
    homes.push(home)
    return home
  }

  function client(home: string, body: unknown, onSnapshot: (phase: string) => void, requestOverride?: (url: string, init: RequestInit) => Promise<Response>) {
    return new DesktopMandatoryUpdatePolicyClient({
      endpoint: 'https://ai.hozonauto.com/api/desktop/version',
      currentVersion: '2.0.0',
      request: requestOverride ?? vi.fn(async () => response(body)),
      onSnapshot: snapshot => onSnapshot(snapshot.phase),
      statePath: join(home, DESKTOP_MANDATORY_POLICY_STATE_FILENAME),
      onState: async (path, snapshot) => {
        const { writeDesktopMandatoryPolicyState } = await import('../src/desktop-mandatory-policy.ts')
        await writeDesktopMandatoryPolicyState(path, snapshot)
      },
      now: () => NOW,
    })
  }

  it('keeps the previous block when the policy service fails', async () => {
    const home = policyHome()
    let failNext = false
    const phases: string[] = []
    const target = client(home, DIRECTIVE, phase => phases.push(phase), async () => {
      if (failNext) throw new Error('network down')
      return response({ version: '2.1.0', mandatory: DIRECTIVE })
    })
    await target.check()
    expect(target.snapshot.phase).toBe('notice')
    failNext = true
    await target.check()
    // 失败保留既有 block：绝不能因为服务抖动而解除限制。
    expect(target.snapshot.phase).toBe('notice')
    expect(phases.filter(phase => phase === 'notice').length).toBeGreaterThanOrEqual(2)
  })

  it('clears the block only on a valid response without mandatory', async () => {
    const home = policyHome()
    const phases: string[] = []
    const target = client(home, { version: '2.1.0', mandatory: DIRECTIVE }, phase => phases.push(phase))
    await target.check()
    expect(target.snapshot.phase).toBe('notice')
    await target.check()
    void phases
  })

  it('persists the snapshot atomically for the pre-Host recovery window', async () => {
    const home = policyHome()
    const target = client(home, { version: '2.1.0', mandatory: DIRECTIVE }, () => {})
    await target.check()
    const file = JSON.parse(readFileSync(join(home, DESKTOP_MANDATORY_POLICY_STATE_FILENAME), 'utf8')) as {
      version: number
      snapshot: { phase: string }
    }
    expect(file.version).toBe(1)
    expect(file.snapshot.phase).toBe('notice')
  })
})
