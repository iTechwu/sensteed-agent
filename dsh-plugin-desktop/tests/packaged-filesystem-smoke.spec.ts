import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { verifyBundledSkills } from '../src/packaged-filesystem-smoke.ts'

it('discovers and reads shipped Cordis skills through fs-local in a plain app directory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-packaged-skills-'))
  try {
    const app = join(root, 'resources', 'app')
    // dsh 0.1.7 ships the skill tree from `@deepseek-ai/dsh-agent-preset/skills`.
    const preset = join(app, 'node_modules', '@deepseek-ai', 'dsh-agent-preset')
    mkdirSync(preset, { recursive: true })
    const require = createRequire(import.meta.url)
    cpSync(join(dirname(require.resolve('@deepseek-ai/dsh-agent-preset/package.json')), 'skills'),
      join(preset, 'skills'), { recursive: true })
    await expect(verifyBundledSkills(app)).resolves.toBeUndefined()
    rmSync(join(preset, 'skills', 'cordis-plugin-development'), { recursive: true })
    await expect(verifyBundledSkills(app)).rejects.toThrow('bundled skill is unavailable: cordis-plugin-development')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('discovers app-bundled third-party skills listed in the in-package manifest', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-app-bundled-skills-'))
  try {
    const app = join(root, 'resources', 'app')
    const preset = join(app, 'node_modules', '@deepseek-ai', 'dsh-agent-preset')
    mkdirSync(preset, { recursive: true })
    const require = createRequire(import.meta.url)
    cpSync(join(dirname(require.resolve('@deepseek-ai/dsh-agent-preset/package.json')), 'skills'),
      join(preset, 'skills'), { recursive: true })
    const skillDir = join(app, 'bundled', 'skills', 'demo-bundled')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), [
      '---',
      'name: demo-bundled',
      'description: app-bundled smoke fixture',
      '---',
      '',
      'demo body',
      '',
    ].join('\n'))
    writeFileSync(join(app, 'bundled', 'manifest.json'), `${JSON.stringify({
      schemaVersion: 1,
      skills: [{ name: 'demo-bundled', kind: 'dir', path: 'demo-bundled' }],
    }, null, 2)}\n`)
    const bundledRoot = join(app, 'bundled', 'skills')
    await expect(verifyBundledSkills(app, bundledRoot)).resolves.toBeUndefined()
    rmSync(skillDir, { recursive: true })
    await expect(verifyBundledSkills(app, bundledRoot))
      .rejects.toThrow('app-bundled skill is unavailable: demo-bundled')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
