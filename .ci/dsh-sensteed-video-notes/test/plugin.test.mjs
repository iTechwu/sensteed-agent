import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

function loadHost(names = []) {
  const tools = new Map()
  const sections = []
  return import('../index.js').then(({ apply }) => {
    apply({
      tools: {
        schemas: () => names.map(name => ({ name })),
        register(value) { tools.set(value.name, value); return () => {} },
      },
      systemPrompt: { section(value) { sections.push(value); return () => {} } },
    })
    return { tools, sections }
  })
}

test('package registers the video-processing MCP patch', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
  assert.equal(manifest.name, '@dofe/dsh-sensteed-video-notes')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.match(patch, /serverName: video-processing/u)
  assert.match(patch, /https:\/\/ai\.hozonauto\.com\/mcp\/tools\/video-processing/u)
  // 凭据只来自 Host 环境变量，不写死任何 key 字面量。
  assert.match(patch, /process\.env\.MODELS_API_KEY/u)
  assert.doesNotMatch(patch, /Bearer\s+[A-Za-z0-9_-]{8}/u)
})

test('loads the skill as system guidance and registers a read-only bootstrap', async () => {
  const { tools, sections } = await loadHost([
    'mcp__video-processing__video_capabilities_get',
    'mcp__video-processing__video_frames_extract_start',
    'mcp__video-processing__video_upload_authorize',
  ])
  assert.equal(sections[0].name, 'sensteed:video-notes-skill')
  assert.match(sections[0].text, /视频笔记/u)
  assert.match(sections[0].text, /MODEL_DELEGATION_UNAVAILABLE/u)
  const bootstrap = tools.get('sensteed_video_notes_bootstrap')
  assert.ok(bootstrap)
  assert.equal(bootstrap.isConcurrencySafe(), true)
  const result = await bootstrap.execute({})
  assert.equal(result.result.dataSource, 'local_tool_catalog')
  assert.equal(result.result.externalCallMade, false)
  assert.ok(result.result.tools.video_frames_extract_start)
  assert.ok(result.result.scripts['align-timeline.mjs'])
  assert.ok(result.result.scripts['render-note.mjs'])
  assert.ok(result.result.scripts['validate-note.mjs'])
})

test('skill preserves alignment, ASR gating, idempotency, and evidence boundaries', async () => {
  const skill = await readFile(new URL('skills/video-notes/SKILL.md', root), 'utf8')
  for (const token of [
    'captureSeconds',
    'onsetSeconds',
    'timingQuality',
    '稳定',
    '原 jobId',
    '不得换幂等键',
    'coverage',
    'MODEL_DELEGATION_UNAVAILABLE',
    'files.ixicai.cn/coursemd/assets/',
  ]) assert.match(skill, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  assert.doesNotMatch(skill, /Bearer\s+[A-Za-z0-9]/u)
})

test('align-timeline maps segments to frame intervals deterministically', async () => {
  const { alignTimeline } = await import('../skills/video-notes/scripts/align-timeline.mjs')
  const note = alignTimeline({
    transcript: {
      segments: [
        { segmentId: 'seg_001', startSeconds: 1, endSeconds: 3, rawText: '开头', status: 'speech' },
        { segmentId: 'seg_002', startSeconds: 5, endSeconds: 9, rawText: '中段', status: 'speech' },
        { segmentId: 'seg_003', startSeconds: 30, endSeconds: 40, rawText: '尾段', status: 'speech' },
      ],
    },
    frames: [
      { frameId: 'frm_1', onsetSeconds: 4, captureSeconds: 5, endSeconds: null, downloadUrl: 'https://files.ixicai.cn/coursemd/assets/s/x/v/f1.jpg' },
      { frameId: 'frm_0', onsetSeconds: 0, captureSeconds: 1, endSeconds: null, downloadUrl: 'https://files.ixicai.cn/coursemd/assets/s/x/v/f0.jpg' },
    ],
    timingQuality: 'source',
  })
  assert.equal(note.sections.length, 2)
  assert.equal(note.sections[0].startSeconds, 0)
  assert.equal(note.sections[0].endSeconds, 4)
  assert.deepEqual(note.sections[0].segmentIds, ['seg_001'])
  assert.deepEqual(note.sections[1].segmentIds, ['seg_002', 'seg_003'])
  assert.equal(note.quality.complete, true)
})

test('render-note escapes content and honors offline mode', async () => {
  const { renderMarkdown, renderHtml } = await import('../skills/video-notes/scripts/render-note.mjs')
  const note = {
    schemaVersion: 'video-notes-v1',
    generatorVersion: 'test',
    source: { title: '<标题> & "引号"', platform: 'local', duration: 75 },
    evidence: { timingQuality: 'source', frameCount: 1, segmentCount: 1 },
    sections: [{
      sectionId: 'sec_0001', title: '第一章', startSeconds: 0, endSeconds: 10,
      frameIds: ['frm_1'], imageDownloadUrls: ['https://files.ixicai.cn/coursemd/assets/s/x/v/f0.jpg'],
      segmentIds: ['seg_001'], rawTexts: ['hello <script>alert(1)</script>'], displayTexts: ['hello <script>alert(1)</script>'],
    }],
    quality: { complete: true, warnings: [], failedStages: [] },
  }
  const markdown = renderMarkdown(note, { offline: false })
  assert.match(markdown, /# &lt;标题&gt; &amp; &quot;引号&quot;/u)
  assert.doesNotMatch(markdown, /<script>/u)
  const html = renderHtml(note, { offline: false })
  assert.match(html, /Content-Security-Policy/u)
  assert.match(html, /&lt;script&gt;/u)
  assert.doesNotMatch(html, /<script>/u)
  const offlineMarkdown = renderMarkdown(note, { offline: true })
  assert.match(offlineMarkdown, /assets\/frame-0001\.jpg/u)
})

test('validate-note rejects bad urls, duplicates, and injection', async () => {
  const { validateNote } = await import('../skills/video-notes/scripts/validate-note.mjs')
  const base = {
    schemaVersion: 'video-notes-v1',
    evidence: { timingQuality: 'source', frameCount: 1, segmentCount: 2 },
    sections: [],
    quality: { complete: true, warnings: [], failedStages: [] },
  }
  const bad = {
    ...base,
    sections: [{
      sectionId: 's1', title: 'x', startSeconds: 5, endSeconds: 0,
      frameIds: ['f'], imageDownloadUrls: ['https://evil.example.com/a.jpg'],
      segmentIds: ['seg_001', 'seg_001'], rawTexts: ['<script>x</script>'], displayTexts: [],
    }],
  }
  const result = validateNote(bad, { offline: false })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some(error => error.includes('coursemd/assets')))
  assert.ok(result.errors.some(error => error.includes('重复')))
  assert.ok(result.warnings.some(warning => warning.includes('script')))

  const good = {
    ...base,
    sections: [{
      sectionId: 's1', title: 'x', startSeconds: 0, endSeconds: 10,
      frameIds: ['f'], imageDownloadUrls: ['https://files.ixicai.cn/coursemd/assets/s/x/v/f0.jpg'],
      segmentIds: ['seg_001', 'seg_002'], rawTexts: ['clean'], displayTexts: ['clean'],
    }],
  }
  assert.equal(validateNote(good, { offline: false }).ok, true)
  assert.equal(validateNote(good, { offline: true }).ok, true)
})


test('preserves untimed speech, excludes silence from coverage and propagates gaps', async () => {
  const { alignTimeline } = await import('../skills/video-notes/scripts/align-timeline.mjs')
  const { validateNote } = await import('../skills/video-notes/scripts/validate-note.mjs')
  const input = {
    transcript: { transcriptId: 'tr_1', timingQuality: 'none', segments: [
      { segmentId: 's1', startSeconds: null, endSeconds: null, rawText: '未计时原文' },
      { segmentId: 'silence', status: 'silence' },
    ] },
    frames: [{ frameId: 'f', onsetSeconds: 0, captureSeconds: 1,
      downloadUrl: 'https://files.ixicai.cn/coursemd/assets/a/b/c/f.jpg' }],
    coverage: { complete: false, truncated: true },
  }
  const note = alignTimeline(input)
  assert.deepEqual(note.sections.at(-1).rawTexts, ['未计时原文'])
  assert.equal(note.sections.at(-1).startSeconds, null)
  assert.equal(note.evidence.segmentCount, 1)
  assert.equal(note.evidence.transcriptId, 'tr_1')
  assert.equal(note.quality.complete, false)
  assert.match(note.quality.warnings.join(' '), /截图覆盖不完整/)
  assert.equal(validateNote(note).ok, true)
  assert.deepEqual(alignTimeline(input), note)
  const forged = structuredClone(note)
  forged.sections.at(-1).segmentIds = ['invented']
  assert.equal(validateNote(forged).ok, false)
})

test('offline images agree across sections, manifest, MD and HTML; missing files fail', async () => {
  const { mkdtemp, mkdir, writeFile, rm, symlink } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { renderMarkdown, renderHtml, renderNoteOfflineImages } = await import('../skills/video-notes/scripts/render-note.mjs')
  const { validateRenderedFiles, validateNote } = await import('../skills/video-notes/scripts/validate-note.mjs')
  const note = { schemaVersion: 'video-notes-v1', source: { title: '课]程' },
    evidence: { segmentCount: 2 }, sections: [1, 2].map(n => ({
      sectionId: `sec_${n}`, startSeconds: n, endSeconds: n + 1,
      frameIds: [`f${n}`], imageDownloadUrls: [`https://files.ixicai.cn/coursemd/assets/a/b/c/f${n}.jpg`],
      segmentIds: [`s${n}`], rawTexts: ['<script>教学示例</script>'],
    })) }
  const dir = await mkdtemp(join(tmpdir(), 'video-note-test-'))
  try {
    const md = join(dir, 'course.md'); const html = join(dir, 'course.html')
    await writeFile(md, renderMarkdown(note, { offline: true }))
    const renderedHtml = renderHtml(note, { offline: true })
    await writeFile(html, renderedHtml)
    const mapping = renderNoteOfflineImages(note)
    assert.deepEqual(mapping.map(item => item.frameId), ['f1', 'f2'])
    for (const item of mapping) {
      assert.ok(renderMarkdown(note, { offline: true }).includes(item.file))
      assert.ok(renderedHtml.includes(item.file))
    }
    assert.match(renderedHtml, /img-src 'self' file:/)
    assert.equal(validateNote(note, { offline: true }).ok, true)
    assert.equal(validateRenderedFiles(md, html, { offline: true }).ok, false)
    await mkdir(join(dir, 'assets'))
    for (const item of mapping) await writeFile(join(dir, item.file), 'jpeg')
    assert.equal(validateRenderedFiles(md, html, { offline: true }).ok, true)
    await rm(join(dir, mapping[1].file))
    await symlink(md, join(dir, mapping[1].file))
    // symlinks within the selected output directory are allowed; escaping it fails.
    await rm(join(dir, mapping[1].file))
    await symlink('/etc/hosts', join(dir, mapping[1].file))
    assert.equal(validateRenderedFiles(md, html, { offline: true }).ok, false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('untrusted Markdown cannot add images and permanent URLs reject traversal/query strings', async () => {
  const { renderMarkdown, renderHtml } = await import('../skills/video-notes/scripts/render-note.mjs')
  const { validateNote } = await import('../skills/video-notes/scripts/validate-note.mjs')
  const note = { schemaVersion: 'video-notes-v1', source: { title: 'title' }, sections: [{
    sectionId: 's', startSeconds: 0, imageDownloadUrls: [], segmentIds: [],
    rawTexts: ['![track](https://evil.test/pixel.jpg)'],
  }] }
  assert.ok(renderMarkdown(note).includes('\\!\\[track\\]'))
  for (const suffix of ['../x.jpg', 'x.jpg?X-Amz-Signature=token', 'x.jpg?foo=1']) {
    note.sections[0].imageDownloadUrls = [`https://files.ixicai.cn/coursemd/assets/${suffix}`]
    assert.equal(validateNote(note).ok, false)
    assert.throws(() => renderHtml(note))
  }
})

test('bootstrap exposes installed script paths and rejects lookalike tool names', async () => {
  const { tools } = await loadHost(['fake_video_capabilities_get_suffix'])
  const result = await tools.get('sensteed_video_notes_bootstrap').execute({})
  assert.equal(result.result.tools.video_capabilities_get, false)
  assert.ok(result.result.scriptPaths['render-note.mjs'].endsWith('/scripts/render-note.mjs'))
  assert.ok(result.result.scripts['note-assets.mjs'])
})

test('render CLI refuses to overwrite an existing output directory', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { spawnSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const dir = await mkdtemp(join(tmpdir(), 'video-note-cli-'))
  try {
    const input = join(dir, 'note.json')
    await writeFile(input, JSON.stringify({ sections: [], source: {} }))
    const script = fileURLToPath(new URL('../skills/video-notes/scripts/render-note.mjs', import.meta.url))
    const output = join(dir, 'new-version')
    assert.equal(spawnSync(process.execPath, [script, '--input', input, '--out-dir', output]).status, 0)
    await writeFile(join(output, 'course.md'), 'user-edited')
    assert.notEqual(spawnSync(process.execPath, [script, '--input', input, '--out-dir', output]).status, 0)
    assert.equal(await readFile(join(output, 'course.md'), 'utf8'), 'user-edited')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
