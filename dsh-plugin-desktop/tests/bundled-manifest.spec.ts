import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BUNDLED_MANIFEST,
  BUNDLED_SKILLS_ROOT,
  loadManifest,
  normalizeSkillName,
  planSkillTargets,
} from '../../scripts/refresh-bundled.mjs'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

interface SkillEntry {
  name: string
  repository: string
  snapshotDir: string
}

interface PluginEntry {
  name: string
  package: string
  source: string
  upstream?: string
  siblingDir?: string
  snapshotDir: string
}

interface DerivedSkill {
  name: string
  kind: 'dir' | 'flat'
  path: string
  repository: string
}

describe('bundled manifest', () => {
  it('parses the committed manifest with valid shape', async () => {
    const manifest = await loadManifest(REPO_ROOT)
    expect(manifest.version).toBe(1)
    expect(manifest.skills.length).toBeGreaterThan(0)
    expect(manifest.plugins.length).toBeGreaterThan(0)
  })

  it('ships the initial skill set', async () => {
    const manifest = await loadManifest(REPO_ROOT)
    expect(manifest.skills.map((skill: SkillEntry) => skill.name)).toEqual(
      expect.arrayContaining(['dashi-ppt-skill', 'humanizer']),
    )
  })

  it('records every preinstalled plugin with an existing snapshot directory', async () => {
    const manifest = await loadManifest(REPO_ROOT)
    const names = manifest.plugins.map((plugin: PluginEntry) => plugin.name)
    expect(names).toContain('dsh-soup')
    expect(names).toContain('dsh-knowledge-capture')
    for (const plugin of manifest.plugins) {
      expect(existsSync(resolve(REPO_ROOT, plugin.snapshotDir)), `snapshot for ${plugin.name}`).toBe(true)
    }
  })

  it('keeps the manifest plugins aligned with the desktop file: dependencies', async () => {
    const manifest = await loadManifest(REPO_ROOT)
    const desktop = JSON.parse(await readFile(join(REPO_ROOT, 'dsh-plugin-desktop/package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    for (const plugin of manifest.plugins) {
      expect(desktop.dependencies[plugin.package], `${plugin.package} must be a desktop dependency`).toBe(
        `file:../../docker-helm.dofe.ai/plugins/${plugin.name}`,
      )
    }
  })

  it('derives the in-package manifest from committed skill snapshots', async () => {
    const derived = JSON.parse(await readFile(join(REPO_ROOT, BUNDLED_MANIFEST), 'utf8')) as {
      schemaVersion: number
      skills: DerivedSkill[]
    }
    expect(derived.schemaVersion).toBe(1)
    expect(derived.skills.length).toBeGreaterThan(0)
    const manifest = await loadManifest(REPO_ROOT)
    const repositories = new Set(manifest.skills.map((skill: SkillEntry) => skill.repository))
    for (const skill of derived.skills) {
      expect(repositories.has(skill.repository), `${skill.name} must map to a bundled.json repository`).toBe(true)
      const full = resolve(REPO_ROOT, BUNDLED_SKILLS_ROOT, skill.path)
      expect(existsSync(full), skill.path).toBe(true)
      if (skill.kind === 'dir') expect(existsSync(join(full, 'SKILL.md')), `${skill.path}/SKILL.md`).toBe(true)
    }
  })

  it('resolves the github-sourced plugin write-back to the sibling checkout', async () => {
    const manifest = await loadManifest(REPO_ROOT)
    const soup = manifest.plugins.find((plugin: PluginEntry) => plugin.name === 'dsh-soup')
    expect(soup).toMatchObject({
      source: 'github',
      upstream: 'https://github.com/lyhue1991/dsh-soup',
      siblingDir: '../docker-helm.dofe.ai/plugins/dsh-soup',
    })
  })
})

describe('normalizeSkillName', () => {
  it('kebab-cases candidate names', () => {
    expect(normalizeSkillName('Dashi PPT Skill')).toBe('dashi-ppt-skill')
    expect(normalizeSkillName('humanizer')).toBe('humanizer')
    expect(normalizeSkillName('  A__B  ')).toBe('a-b')
  })

  it('rejects names that normalize to empty', () => {
    expect(() => normalizeSkillName('---')).toThrow()
  })
})

describe('planSkillTargets', () => {
  async function seedRepo(files: string[]): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'bundled-skill-'))
    for (const file of files) {
      const full = join(dir, file)
      await mkdir(join(full, '..'), { recursive: true })
      await writeFile(full, '---\nname: x\ndescription: y\n---\nbody')
    }
    return dir
  }

  it('treats a root SKILL.md repository as one skill and skips flat fallback', async () => {
    const dir = await seedRepo(['SKILL.md', 'notes.md', 'README.md'])
    try {
      expect(planSkillTargets(dir, { fallbackName: 'humanizer' })).toEqual([
        { name: 'humanizer', kind: 'dir', from: '.' },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('collects direct child skill directories', async () => {
    const dir = await seedRepo(['alpha/SKILL.md', 'beta/SKILL.md', 'docs/notes.md'])
    try {
      expect(planSkillTargets(dir)).toEqual([
        { name: 'alpha', kind: 'dir', from: 'alpha' },
        { name: 'beta', kind: 'dir', from: 'beta' },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('collects skills under a skills/ tree', async () => {
    const dir = await seedRepo(['skills/gamma/SKILL.md'])
    try {
      expect(planSkillTargets(dir)).toEqual([{ name: 'gamma', kind: 'dir', from: join('skills', 'gamma') }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('collects root-level flat markdown and excludes documentation files', async () => {
    const dir = await seedRepo(['notes.md', 'README.md', 'LICENSE.md'])
    try {
      expect(planSkillTargets(dir)).toEqual([{ name: 'notes', kind: 'flat', from: 'notes.md' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a repository without any skill', async () => {
    const dir = await seedRepo(['README.md'])
    try {
      expect(() => planSkillTargets(dir)).toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
