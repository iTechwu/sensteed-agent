import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { __test, listSkills, parseSkillFrontmatter, skillRoot } from '../index.js'

test('resolves the local DSH skills directory and validates skill metadata', () => {
  assert.equal(skillRoot({ DSH_HOME: '/tmp/dsh-home' }), '/tmp/dsh-home/skills')
  assert.deepEqual(parseSkillFrontmatter('---\nname: draft-review\ndescription: Review drafts\n---\nBody'), {
    name: 'draft-review', description: 'Review drafts',
  })
  assert.deepEqual(parseSkillFrontmatter('---\nname: draft-review\ndescription: >-\n  Review drafts\n  with a folded summary\n---\nBody'), {
    name: 'draft-review', description: 'Review drafts with a folded summary',
  })
  assert.throws(() => parseSkillFrontmatter('---\nname: Bad_Name\ndescription: Bad\n---\n'), /lowercase/u)
  assert.throws(() => parseSkillFrontmatter('No frontmatter'), /frontmatter/u)
})

test('accepts only plain public GitHub repository URLs', () => {
  assert.equal(__test.safeGitHubUrl('https://github.com/acme/review-skill'), 'https://github.com/acme/review-skill.git')
  assert.throws(() => __test.safeGitHubUrl('https://user:secret@github.com/acme/review-skill'), /Only public/u)
  assert.throws(() => __test.safeGitHubUrl('https://example.com/acme/review-skill'), /Only public/u)
  assert.throws(() => __test.safeGitHubUrl('https://github.com/acme/review-skill/tree/main'), /Only public/u)
})

test('lists only the invocation-neutral metadata the UI needs', async () => {
  const skills = await listSkills({ skills: { list: async () => [{
    name: 'draft-review', description: 'Review drafts', source: 'user-dsh', provider: 'filesystem', path: '/private/path/SKILL.md',
    content: 'must not be returned', invocation: { modelInvocable: true, userInvocable: true },
  }] } })
  assert.deepEqual(skills, [{
    name: 'draft-review', description: 'Review drafts', source: 'user-dsh', provider: 'filesystem', path: '/private/path/SKILL.md',
  }])
})

test('recognizes one root or skills/ child and rejects a multi-skill collection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-manager-test-'))
  try {
    await mkdir(join(root, 'skills', 'one'), { recursive: true })
    await writeFile(join(root, 'skills', 'one', 'SKILL.md'), '---\nname: one\ndescription: one\n---\n')
    assert.equal(await __test.skillSource(root), join(root, 'skills', 'one'))
    await rm(join(root, 'skills', 'one', 'SKILL.md'))
    const externalSkill = join(root, 'outside.md')
    await writeFile(externalSkill, 'external content')
    await symlink(externalSkill, join(root, 'skills', 'one', 'SKILL.md'))
    await assert.rejects(__test.skillSource(root), /symbolic link/u)
    await rm(join(root, 'skills', 'one', 'SKILL.md'))
    await writeFile(join(root, 'skills', 'one', 'SKILL.md'), '---\nname: one\ndescription: one\n---\n')
    await mkdir(join(root, 'skills', 'two'))
    await writeFile(join(root, 'skills', 'two', 'SKILL.md'), '---\nname: two\ndescription: two\n---\n')
    await assert.rejects(__test.skillSource(root), /multiple skills/u)
  } finally { await rm(root, { recursive: true, force: true }) }
})
