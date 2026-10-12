import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { expect, it } from 'vitest'
import { parse } from 'yaml'
import { apply, inject, name, type DesktopPnpmBootstrap } from '../src/pnpm.ts'

it('adds a plugin to an existing Profile without switching its pnpm store', async () => {
  const root = mkdtempSync(join(tmpdir(), 'desktop-pnpm-existing-store-'))
  const ctx = new Context()
  try {
    const homeDir = join(root, 'home')
    const profileDir = join(homeDir, 'profiles', 'desktop')
    const oldStore = join(root, 'previous-user-store')
    const packageDir = join(root, 'fixture-plugin')
    const pnpmBinPath = fileURLToPath(new URL('../node_modules/pnpm/bin/pnpm.mjs', import.meta.url))
    const clearEnvironmentPath = join(root, 'clear-env.mjs')
    mkdirSync(profileDir, { recursive: true })
    mkdirSync(packageDir)
    writeFileSync(clearEnvironmentPath, '')
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: 'fixture-plugin', version: '1.0.0' }))
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ private: true }))
    writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n')
    const environment = { ...process.env, CI: 'true' }
    const seeded = spawnSync(process.execPath, [pnpmBinPath, 'install', '--offline', '--ignore-scripts', '--store-dir', oldStore], {
      cwd: profileDir, env: environment, encoding: 'utf8', timeout: 15_000,
    })
    expect(seeded.status, seeded.stdout + seeded.stderr).toBe(0)
    const modulesPath = join(profileDir, 'node_modules', '.modules.yaml')
    const before = parse(readFileSync(modulesPath, 'utf8')) as { storeDir: string }
    expect(before.storeDir).toBe(join(oldStore, 'v11'))

    let output = ''
    const spawn = (spec: SubprocessSpawnSpec): SubprocessHandle => {
      const result = spawnSync(spec.argv[0]!, spec.argv.slice(1), {
        cwd: spec.cwd, env: { ...environment, ...spec.env }, encoding: 'utf8', timeout: 15_000,
      })
      output = result.stdout + result.stderr
      return {
        stdin: undefined, stdout: Readable.from([result.stdout]), stderr: Readable.from([result.stderr]),
        control: undefined, collected: {},
        done: Promise.resolve({ exitCode: result.status, signal: result.signal }),
        terminate() {}, waitForExit: async () => true,
      }
    }
    const bootstrap: DesktopPnpmBootstrap = {
      activeProfileName: 'desktop', activeProfileDir: profileDir, homeDir,
      appExecutable: process.execPath, pnpmBinPath, clearEnvironmentPath,
      electronVersion: '44.0.0', nodeBinDir: dirname(process.execPath), nodeShimPath: process.execPath,
      dshBootstrapPath: join(root, 'desktop-cli.js'),
    }
    ctx.provide('desktopPnpmBootstrap', bootstrap)
    ctx.provide('subprocess', { spawn } as unknown as SubprocessRuntime)
    await ctx.plugin({ name, inject, apply })
    const operation = ctx.desktopPnpm.run(['add', '--offline', '--ignore-scripts', '--save-exact', `file:${packageDir}`])
    const outcome = await operation.done
    expect(output).not.toContain('ERR_PNPM_UNEXPECTED_STORE')
    expect(outcome.exitCode, output).toBe(0)
    const after = parse(readFileSync(modulesPath, 'utf8')) as { storeDir: string }
    expect(after.storeDir).toBe(before.storeDir)
    expect(JSON.parse(readFileSync(join(profileDir, 'node_modules', 'fixture-plugin', 'package.json'), 'utf8')).version).toBe('1.0.0')
  } finally {
    await ctx.fiber.dispose()
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)
