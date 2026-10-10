/** Verify bundled skill discovery through the real local filesystem backend. */
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'

/** In-package manifest of app-bundled skills, written by scripts/refresh-bundled.mjs. */
interface BundledSkillManifest {
  schemaVersion: number
  skills: { name: string, kind: 'dir' | 'flat', path: string }[]
}

export async function verifyBundledSkills(applicationRoot: string, bundledSkillRoot?: string): Promise<void> {
  // dsh 0.1.7 ships the Cordis skill tree from `@deepseek-ai/dsh-agent-preset/skills`.
  const skillsRoot = join(applicationRoot, 'node_modules', '@deepseek-ai', 'dsh-agent-preset', 'skills')
  const ctx = new Context()
  try {
    await ctx.plugin(LocalFileSystem, { cwd: applicationRoot })
    for (const path of [dirname(applicationRoot), applicationRoot, skillsRoot]) {
      const target = await ctx.fs.resolve(path)
      const first = await ctx.fs.stat(target)
      const second = await ctx.fs.stat(target)
      if (first?.type !== 'directory' || first.version !== second?.version) {
        throw new Error(`packaged directory has invalid or unstable metadata: ${path}`)
      }
      if ((await ctx.fs.lstat(path))?.type !== 'directory') {
        throw new Error(`packaged directory lstat failed: ${path}`)
      }
      await ctx.fs.listDir(target)
    }
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, {
      includeDefaultRoots: false, bundledSkillDir: skillsRoot, watch: false,
    })
    const snapshot = await ctx.skills.snapshot()
    if (!snapshot.complete) throw new Error('packaged skill discovery was incomplete')
    for (const name of ['editing-cordis-compositions', 'cordis-plugin-development']) {
      if (!snapshot.skills.some(skill => skill.name === name)
        || !(await ctx.skills.get(name))?.content.trim()) {
        throw new Error(`bundled skill is unavailable: ${name}`)
      }
    }
  } finally {
    await ctx.fiber.dispose()
  }
  if (bundledSkillRoot !== undefined) await verifyAppBundledSkills(applicationRoot, bundledSkillRoot)
}

/**
 * Verify the app-bundled third-party skill root (`bundled/skills`, written by
 * `scripts/refresh-bundled.mjs`): every skill in the in-package manifest must
 * be discoverable with readable content.
 */
export async function verifyAppBundledSkills(applicationRoot: string, bundledSkillRoot: string): Promise<void> {
  const manifestPath = join(applicationRoot, 'bundled', 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BundledSkillManifest
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.skills) || manifest.skills.length === 0) {
    throw new Error(`app-bundled skill manifest is empty or unsupported: ${manifestPath}`)
  }
  const ctx = new Context()
  try {
    await ctx.plugin(LocalFileSystem, { cwd: applicationRoot })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, {
      includeDefaultRoots: false, bundledSkillDir: bundledSkillRoot, watch: false,
    })
    const snapshot = await ctx.skills.snapshot()
    if (!snapshot.complete) throw new Error('app-bundled skill discovery was incomplete')
    for (const skill of manifest.skills) {
      if (!snapshot.skills.some(candidate => candidate.name === skill.name)
        || !(await ctx.skills.get(skill.name))?.content.trim()) {
        throw new Error(`app-bundled skill is unavailable: ${skill.name}`)
      }
    }
  } finally {
    await ctx.fiber.dispose()
  }
}
