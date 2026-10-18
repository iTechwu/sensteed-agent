import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as filesystem from '@deepseek-ai/dsh-skill-filesystem'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerHubSkillRoots } from '../src/hub-skill-roots.ts'
const dirs: string[] = [], contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})
it('the built Harness provider discovers only the Desktop sealed generation roots', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'desktop-hub-roots-'))); dirs.push(dir)
  const root = join(dir, 'skills'), unrelated = join(dir, 'unrelated')
  await mkdir(root); await mkdir(unrelated)
  await writeFile(join(root, 'safe.md'), '---\nname: safe\ndescription: trusted skill\n---\nTrusted')
  await writeFile(join(unrelated, 'forged.md'), '---\nname: forged\ndescription: untrusted skill\n---\nUntrusted')
  const ctx = new Context(); contexts.push(ctx)
  registerHubSkillRoots(ctx, { generationId: 'g1', skillProviderName: 'hub-g1', skillsRoot: root } as never)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(filesystem, { providerName: 'ordinary', roots: [unrelated], watch: false })
  expect((await ctx.skills.list()).map(skill => [skill.name, skill.provider, skill.source])).toEqual([['safe', 'hub-g1', 'hub']])
  expect((await ctx.skills.get('safe'))?.content).toContain('Trusted')
  expect(await ctx.skills.get('forged')).toBeUndefined()
})
