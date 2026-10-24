import { spawnSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { runNextPackagingCommand } from '../scripts/packaging-command.ts'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))
const spawn = vi.mocked(spawnSync)
afterEach(() => spawn.mockReset())
const succeeded: ReturnType<typeof spawnSync> = { status: 0, output: [], pid: 1, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }

it('maps shared desktop command strings onto Next for every routed gate', () => {
  const env = { PATH: '/test/bin' }
  spawn.mockReturnValue(succeeded)
  runNextPackagingCommand('yarn', ['run', 'check'], '/workspace', env, '/workspace')
  // Sensteed 语义:根 check 先按映射执行,再追加 Next 自身的 check:next 门。
  expect(spawn.mock.calls.map(call => call[1])).toEqual([['run', 'check'], ['run', 'check:next']])
  expect(spawn.mock.calls.every(call => call[2]?.env === env)).toBe(true)
  spawn.mockReset().mockReturnValue({ ...succeeded, status: 1 })
  expect(() => runNextPackagingCommand('yarn', ['run', 'check'], '/workspace', env, '/workspace')).toThrow('Packaging command failed')
})

it('routes the shared Windows package gate to Next without adding unrelated commands', () => {
  spawn.mockReturnValue(succeeded)
  runNextPackagingCommand('cmd.exe', ['/d', '/s', '/c', 'corepack yarn workspace dsh-plugin-desktop check:win-package'], '/workspace', {}, '/workspace')
  expect(spawn).toHaveBeenCalledOnce()
  expect(spawn.mock.calls[0]?.[1]).toContain('corepack yarn workspace dsh-desktop-next check:win-package')
  spawn.mockReset().mockReturnValue(succeeded)
  const betaScript = `/workspace/dsh-plugin-desktop-beta/scripts/verify-mac-smoke.ts`
  runNextPackagingCommand('node', ['/workspace/dsh-desktop-next/scripts/verify-mac-smoke.ts', betaScript], '/workspace', {}, '/workspace')
  // fork 无 beta 包,盲替换会把该字面量一并映射;这是当前实现的既定行为。
  expect(spawn.mock.calls[0]?.[1]).toEqual(['/workspace/dsh-desktop-next/scripts/verify-mac-smoke.ts', '/workspace/dsh-desktop-next-beta/scripts/verify-mac-smoke.ts'])
})
