import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'
import { zipSync } from 'fflate'
import { __test, listSkills, parseSkillFrontmatter, skillRoot } from '../index.js'

const execFileAsync = promisify(execFile)

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

test('validates shared skill archives and installs their complete directory atomically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-manager-shared-'))
  const archive = Buffer.from(zipSync({
    'SKILL.md': new TextEncoder().encode('---\nname: release-notes\ndescription: Prepare release notes\n---\n'),
    'scripts/check.mjs': new TextEncoder().encode('export default true'),
  }))
  const digest = (await import('node:crypto')).createHash('sha256').update(archive).digest('hex')
  try {
    assert.equal(__test.validateZipArchive(archive).has('scripts/check.mjs'), true)
    const installed = await __test.installArchive(root, 'release-notes', archive, digest)
    assert.equal(installed.name, 'release-notes')
    assert.equal(await readFile(join(root, 'release-notes', 'scripts', 'check.mjs'), 'utf8'), 'export default true')
    await assert.rejects(__test.installArchive(root, 'different-name', archive, digest), /does not match/u)
    await assert.rejects(__test.installArchive(root, 'release-notes', archive, '0'.repeat(64)), /checksum/u)
    const updateArchive = Buffer.from(zipSync({
      'SKILL.md': new TextEncoder().encode('---\nname: release-notes\ndescription: Prepare release notes\n---\n'),
      'scripts/check.mjs': new TextEncoder().encode('export default false'),
    }))
    const updateDigest = (await import('node:crypto')).createHash('sha256').update(updateArchive).digest('hex')
    await __test.installArchive(root, 'release-notes', updateArchive, updateDigest, 2)
    assert.equal(await readFile(join(root, 'release-notes', 'scripts', 'check.mjs'), 'utf8'), 'export default false')
    assert.deepEqual(JSON.parse(await readFile(join(root, 'release-notes', '.sensteed-shared-skill.json'), 'utf8')), {
      name: 'release-notes', sha256: updateDigest, version: 2,
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('does not replace a same-name local skill without a company-library marker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-manager-local-conflict-'))
  const archive = Buffer.from(zipSync({
    'SKILL.md': new TextEncoder().encode('---\nname: release-notes\ndescription: Prepare release notes\n---\n'),
  }))
  const digest = (await import('node:crypto')).createHash('sha256').update(archive).digest('hex')
  try {
    await mkdir(join(root, 'release-notes'))
    await writeFile(join(root, 'release-notes', 'SKILL.md'), 'locally maintained')
    await assert.rejects(__test.installArchive(root, 'release-notes', archive, digest, 2), /not managed by the company library/u)
    assert.equal(await readFile(join(root, 'release-notes', 'SKILL.md'), 'utf8'), 'locally maintained')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('rejects traversal and symbolic-link entries in shared skill archives', () => {
  const traversal = Buffer.from(zipSync({
    'SKILL.md': new TextEncoder().encode('---\nname: unsafe\ndescription: Unsafe\n---\n'),
    '../escape.txt': new TextEncoder().encode('outside'),
  }))
  assert.throws(() => __test.validateZipArchive(traversal), { code: 'HUB_UNSAFE_ARCHIVE' })
})

test('rejects archive path collisions and the install marker filename', () => {
  const frontmatter = new TextEncoder().encode('---\nname: unsafe\ndescription: Unsafe\n---\n')
  const conflicts = [
    zipSync({ 'SKILL.md': frontmatter, 'SKILL.md/child.txt': new TextEncoder().encode('collision') }),
    zipSync({ 'SKILL.md': frontmatter, '.sensteed-shared-skill.json': new TextEncoder().encode('{}') }),
    zipSync({ 'SKILL.md': frontmatter, 'Docs/a.txt': new TextEncoder().encode('a'), 'docs/A.txt': new TextEncoder().encode('b') }),
  ]
  for (const archive of conflicts) assert.throws(() => __test.validateZipArchive(Buffer.from(archive)))
})

test('bounds third-party skill trees and excludes Git metadata from installed content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-manager-tree-limit-'))
  try {
    await mkdir(join(root, '.git'), { recursive: true })
    await writeFile(join(root, '.git', 'ignored'), 'metadata')
    await writeFile(join(root, 'SKILL.md'), 'skill')
    assert.equal(await __test.validateSkillTree(root), undefined)
    const largePath = join(root, 'large.bin')
    await writeFile(largePath, Buffer.alloc(25 * 1024 * 1024 + 1))
    await assert.rejects(__test.validateSkillTree(root), /25 MiB/u)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('preflights Git tree sizes before checking out skill blobs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-manager-git-preflight-'))
  try {
    await mkdir(join(root, 'skills', 'review'), { recursive: true })
    await writeFile(join(root, 'skills', 'review', 'SKILL.md'), '---\nname: review\ndescription: Review\n---\n')
    await execFileAsync('git', ['init', root])
    await execFileAsync('git', ['-C', root, 'config', 'user.email', 'skill-test@example.invalid'])
    await execFileAsync('git', ['-C', root, 'config', 'user.name', 'Skill Test'])
    await execFileAsync('git', ['-C', root, 'add', '.'])
    await execFileAsync('git', ['-C', root, 'commit', '-m', 'fixture'])
    assert.equal(await __test.inspectGitSkill(root), join('skills', 'review'))
    await mkdir(join(root, 'skills', 'review', 'resources'), { recursive: true })
    await Promise.all(Array.from({ length: 500 }, (_, index) =>
      writeFile(join(root, 'skills', 'review', 'resources', `${index}.txt`), ''),
    ))
    await execFileAsync('git', ['-C', root, 'add', '.'])
    await execFileAsync('git', ['-C', root, 'commit', '-m', 'oversized fixture'])
    await assert.rejects(__test.inspectGitSkill(root), /too many files/u)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('hubViewUrl exchanges a one-time ticket and falls back to the plain page', async () => {
  const session = { dofeAuth: { getDatasourceSession: () => ({ accessToken: 'tok' }) } }
  const anonymous = { dofeAuth: { getDatasourceSession: () => undefined } }
  // 无桌面会话:直开网页
  assert.deepEqual(await __test.hubViewUrl(anonymous, 'skills'), { url: 'https://ai.hozonauto.com/plugins/skills' })
  // 服务端未上线(404):回退直开
  assert.deepEqual(await __test.hubViewUrl(session, 'skills', { fetch: async () => ({ ok: false, status: 404, json: async () => null }) }),
    { url: 'https://ai.hozonauto.com/plugins/skills' })
  // 换票成功:拼票据交换地址,ticket 与 next 一并编码
  const requests = []
  const viewUrl = await __test.hubViewUrl(session, 'plugins', { fetch: async (url, init) => {
    requests.push([url, init.method, JSON.parse(init.body), init.headers.Authorization])
    return { ok: true, json: async () => ({ code: 200, data: { ticket: 'Abc123-._x9z' + 'q'.repeat(10), expiresIn: 30 } }) }
  } })
  assert.equal(requests[0][0], 'https://ai.hozonauto.com/plugins/api/auth/ticket')
  assert.equal(requests[0][1], 'POST')
  assert.deepEqual(requests[0][2], { next: '/plugins' })
  assert.equal(requests[0][3], 'Bearer tok')
  assert.equal(viewUrl.url, 'https://ai.hozonauto.com/plugins?tt=Abc123-._x9zqqqqqqqqqq&next=%2Fplugins')
  // 票据格式不符(过短/含特殊字符):回退直开
  assert.deepEqual(await __test.hubViewUrl(session, 'skills', { fetch: async () => ({ ok: true, json: async () => ({ code: 200, data: { ticket: 'bad ticket!' } }) }) }),
    { url: 'https://ai.hozonauto.com/plugins/skills' })
})

test('Hub detail links preserve the verified workspace in ticket and fallback paths', async () => {
  const workspaceId = '10000000-0000-4000-8000-000000000001'
  const resourceId = '20000000-0000-4000-8000-000000000001'
  const next = `/skills/${resourceId}?workspace=${workspaceId}`
  const ctx = { dofeAuth: { getDatasourceSession: () => ({ accessToken: 'test-placeholder' }) } }
  const result = await __test.hubViewUrl(ctx, `skills/${resourceId}`, { workspaceId, fetch: async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), { next })
    return { ok: true, json: async () => ({ code: 200, data: { ticket: 'x'.repeat(32) } }) }
  } })
  assert.equal(new URL(result.url).searchParams.get('next'), next)
  assert.deepEqual(await __test.hubViewUrl({}, `skills/${resourceId}`, { workspaceId }), { url: `https://ai.hozonauto.com/plugins${next}` })
  await assert.rejects(__test.hubViewUrl(ctx, 'skills/../../elsewhere'), /Invalid Hub target/u)
})
