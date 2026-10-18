import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as filesystem from '@deepseek-ai/dsh-skill-filesystem'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundledSkillRoot } from '../src/bundled-skill-root.ts'
import { registerHubBootstrapSkillRoots, registerHubSkillRoots } from '../src/hub-skill-roots.ts'
const dirs: string[] = [], contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})
it('the built Harness provider discovers only the Desktop sealed generation roots', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'desktop-hub-roots-'))); dirs.push(dir)
  const root = join(dir, 'skills'), unrelated = join(dir, 'unrelated')
  await mkdir(root); await mkdir(unrelated)
  await writeFile(join(root, 'skill-creator.md'), '---\nname: skill-creator\ndescription: signed replacement\n---\nUpdated body')
  await writeFile(join(root, 'safe.md'), '---\nname: safe\ndescription: trusted skill\n---\nTrusted')
  await writeFile(join(unrelated, 'forged.md'), '---\nname: forged\ndescription: untrusted skill\n---\nUntrusted')
  const ctx = new Context(); contexts.push(ctx)
  registerHubSkillRoots(ctx, { generationId: 'g1', skillProviderName: 'hub-g1', skillsRoot: root } as never)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(filesystem, { providerName: 'ordinary', customSkillDirs: [unrelated], watch: false })
  const catalog = await ctx.skills.list()
  expect(catalog.find(skill => skill.name === 'safe')).toMatchObject({ provider: 'hub-g1', source: 'hub' })
  expect(catalog.filter(skill => skill.name === 'skill-creator')).toHaveLength(1)
  expect(catalog.find(skill => skill.name === 'skill-creator')).toMatchObject({ provider: 'hub-g1', source: 'hub', path: join(root, 'skill-creator.md') })
  expect(catalog.find(skill => skill.name === 'humanizer')).toMatchObject({ provider: 'hub-g1', source: 'bundled', path: join(bundledSkillRoot()!, 'humanizer/SKILL.md') })
  expect((await ctx.skills.get('skill-creator'))?.content).toContain('Updated body')
  expect(catalog.some(skill => skill.name === 'forged')).toBe(false)
  expect((await ctx.skills.get('safe'))?.content).toContain('Trusted')
  expect(await ctx.skills.get('forged')).toBeUndefined()
})


it('bootstrap discovers sealed bundled and reserved personal skills while ignoring environment/custom roots', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'desktop-bootstrap-roots-'))); dirs.push(dir)
  const personal = join(dir, 'skills'), forged = join(dir, 'forged')
  await mkdir(personal); await mkdir(forged)
  const body = '---\nname: humanizer\ndescription: personal skill\n---\nPersonal body'
  await writeFile(join(personal, 'humanizer.md'), body)
  await writeFile(join(forged, 'forged.md'), body.replace('humanizer', 'forged'))
  const prior = process.env.DSH_BUNDLED_SKILL_DIR
  process.env.DSH_BUNDLED_SKILL_DIR = forged
  try {
    const ctx = new Context(); contexts.push(ctx)
    registerHubBootstrapSkillRoots(ctx, personal)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(filesystem, { providerName: 'ordinary', customSkillDirs: [forged], bundledSkillDir: forged, watch: false })
    const catalog = await ctx.skills.list()
    expect(catalog.find(skill => skill.name === 'humanizer')).toMatchObject({ provider: 'hub-bootstrap', source: 'bundled' })
    expect(catalog.find(skill => skill.name === 'user-local-humanizer')).toMatchObject({ provider: 'user-local', source: 'user-local' })
    expect(catalog.some(skill => skill.name === 'forged')).toBe(false)
    expect((await ctx.skills.get('user-local-humanizer'))?.content).toContain('Personal body')
  } finally {
    if (prior === undefined) delete process.env.DSH_BUNDLED_SKILL_DIR
    else process.env.DSH_BUNDLED_SKILL_DIR = prior
  }
})
