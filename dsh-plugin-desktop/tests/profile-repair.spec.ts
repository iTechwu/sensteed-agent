import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  runDesktopProfileRepair,
  scheduleDesktopProfileRepair,
  type DesktopProfileRepairOptions,
} from '../src/profile-repair.ts'
import type { ProfileMaterializerSpawn } from '../src/profile-materializer.ts'

interface FakeChild extends EventEmitter {
  readonly stdout: PassThrough
  readonly stderr: PassThrough
  readonly pid: number
  kill: ReturnType<typeof vi.fn>
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild
  Object.assign(child, {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 7401,
    kill: vi.fn(() => true),
  })
  return child
}

const homes: string[] = []

function temporaryHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-profile-repair-'))
  homes.push(home)
  return home
}

afterEach(() => {
  while (homes.length > 0) {
    const home = homes.pop()
    if (home !== undefined) rmSync(home, { recursive: true, force: true })
  }
})

function repairOptions(spawn: ProfileMaterializerSpawn, home: string): DesktopProfileRepairOptions {
  return {
    homeDir: home,
    profileDir: join(home, 'profiles', 'desktop'),
    platform: process.platform,
    lockDir: home,
    appExecutable: '/Applications/Sensteed-Agent.app/Contents/MacOS/Sensteed-Agent',
    clearEnvironmentPath: '/private/clear-env.mjs',
    pnpmBinPath: '/private/pnpm/bin/pnpm.mjs',
    nodeBinDir: '/private/node-bin',
    nodeShimPath: '/private/node-bin/node',
    electronVersion: '43.4.0',
    spawn,
  }
}

/** Compose a Profile whose metadata misses the current hoisted contract. */
function seedIncompatibleProfile(home: string): void {
  const dir = join(home, 'profiles', 'desktop')
  mkdirSync(join(dir, 'node_modules'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'desktop', private: true })}\n`)
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  writeFileSync(join(dir, 'node_modules', '.modules.yaml'), 'layoutVersion: 5\nnodeLinker: isolated\npackageManager: pnpm@9.12.0\n')
}

describe('desktop profile dependency repair', () => {
  it('reports not-required for a compatible Profile without spawning pnpm', async () => {
    const home = temporaryHome()
    const dir = join(home, 'profiles', 'desktop')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'desktop', private: true })}\n`)
    const spawn = vi.fn()
    const outcome = await runDesktopProfileRepair(repairOptions(spawn as unknown as ProfileMaterializerSpawn, home))
    expect(outcome).toBe('not-required')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('repairs drifted metadata offline-first through the pinned store', async () => {
    const home = temporaryHome()
    seedIncompatibleProfile(home)
    const child = fakeChild()
    const argvs: readonly (readonly string[])[] = []
    const spawn = vi.fn((_command: string, selectedArgs: readonly string[]) => {
      ;(argvs as string[][]).push([...selectedArgs])
      return child as unknown as ChildProcess
    }) as unknown as ProfileMaterializerSpawn

    const outcome = runDesktopProfileRepair(repairOptions(spawn, home))
    // The fake pnpm "wrote" hoisted-compatible metadata for this platform.
    writeFileSync(join(home, 'profiles', 'desktop', 'node_modules', '.modules.yaml'), `layoutVersion: 5
nodeLinker: hoisted
packageManager: pnpm@11.28.5
virtualStoreDirMaxLength: ${process.platform === 'win32' ? 60 : 120}
`)
    child.stdout.end('offline ok\n')
    child.stderr.end('')
    child.emit('close', 0, null)

    expect(await outcome).toBe('repaired')
    expect(argvs).toHaveLength(1)
    expect(argvs[0]).toContain('--offline')
    expect(argvs[0]).toContain(join(home, 'pnpm-store'))
  })

  it('returns deferred when another desktop data operation holds the lock', async () => {
    const home = temporaryHome()
    seedIncompatibleProfile(home)
    // Hold the lock with this process so the repair must defer.
    const { acquireDesktopDataOperationLock } = await import('../src/desktop-data-operation-lock.ts')
    const lease = acquireDesktopDataOperationLock(home, 'profile-dependency-repair')
    try {
      const outcome = await runDesktopProfileRepair(repairOptions(vi.fn() as unknown as ProfileMaterializerSpawn, home))
      expect(outcome).toBe('deferred')
    } finally {
      lease.release()
    }
  })

  it('surfaces a bounded failure when both attempts cannot clear the drift', async () => {
    const home = temporaryHome()
    seedIncompatibleProfile(home)
    const offlineChild = fakeChild()
    const onlineChild = fakeChild()
    const children = [offlineChild, onlineChild]
    const spawn = vi.fn(() => children.shift() as unknown as ChildProcess) as unknown as ProfileMaterializerSpawn

    const outcome = runDesktopProfileRepair(repairOptions(spawn, home))
    offlineChild.stdout.end('')
    offlineChild.stderr.end('offline failed\n')
    offlineChild.emit('close', 1, null)
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2))
    onlineChild.stdout.end('')
    onlineChild.stderr.end('registry unreachable\n')
    onlineChild.emit('close', 1, null)
    await expect(outcome).rejects.toThrow('exited unsuccessfully')
  })

  it('schedules the repair after the configured delay and cancels cleanly', async () => {
    vi.useFakeTimers()
    try {
      const home = temporaryHome()
      const spawn = vi.fn()
      const onOutcome = vi.fn()
      const schedule = scheduleDesktopProfileRepair(
        { ...repairOptions(spawn as unknown as ProfileMaterializerSpawn, home), delayMs: 1_000 },
        { onOutcome },
      )
      schedule.dispose()
      await vi.advanceTimersByTimeAsync(2_000)
      expect(spawn).not.toHaveBeenCalled()
      expect(onOutcome).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
