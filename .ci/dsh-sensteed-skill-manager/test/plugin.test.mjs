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

test('accepts public GitHub repositories and explicit skill-directory URLs', () => {
  assert.deepEqual(__test.safeGitHubUrl('https://github.com/acme/review-skill'), {
    repository: 'https://github.com/acme/review-skill.git',
  })
  assert.deepEqual(__test.safeGitHubUrl('https://github.com/acme/skills/tree/main/review-skill'), {
    repository: 'https://github.com/acme/skills.git', ref: 'main', path: 'review-skill',
  })
  assert.deepEqual(__test.safeGitHubUrl('https://github.com/acme/skills/blob/v1/skills/review/SKILL.md'), {
    repository: 'https://github.com/acme/skills.git', ref: 'v1', path: 'skills/review',
  })
  assert.throws(() => __test.safeGitHubUrl('https://user:secret@github.com/acme/review-skill'), /public GitHub/u)
  assert.throws(() => __test.safeGitHubUrl('https://example.com/acme/review-skill'), /public GitHub/u)
  assert.throws(() => __test.safeGitHubUrl('https://github.com/acme/review-skill/tree/main/skills/%2Fetc'), /skill path/u)
  assert.throws(() => __test.safeGitHubUrl('https://github.com/acme/review-skill/blob/main/README.md'), /SKILL.md/u)
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

test('resolves only the selected skill directory without scanning sibling skills', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-manager-selected-'))
  try {
    await mkdir(join(root, 'skills', 'one'), { recursive: true })
    await mkdir(join(root, 'skills', 'two'), { recursive: true })
    await writeFile(join(root, 'skills', 'one', 'SKILL.md'), '---\nname: one\ndescription: one\n---\n')
    await writeFile(join(root, 'skills', 'two', 'SKILL.md'), '---\nname: two\ndescription: two\n---\n')
    assert.equal(await __test.skillSource(root, 'skills/one'), join(root, 'skills', 'one'))
    await assert.rejects(__test.skillSource(root, 'skills/missing'), /not a skill directory/u)
    await symlink(join(root, 'skills', 'one'), join(root, 'linked-skill'))
    await assert.rejects(__test.skillSource(root, 'linked-skill'), /not a skill directory/u)
  } finally { await rm(root, { recursive: true, force: true }) }
})
