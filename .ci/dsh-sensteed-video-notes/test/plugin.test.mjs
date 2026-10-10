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
  assert.ok(result.errors.some(error => error.includes('script')))

  const good = {
    ...base,
    sections: [{
      sectionId: 's1', title: 'x', startSeconds: 0, endSeconds: 10,
      frameIds: ['f'], imageDownloadUrls: ['https://files.ixicai.cn/coursemd/assets/s/x/v/f0.jpg'],
      segmentIds: ['seg_001', 'seg_002'], rawTexts: ['clean'], displayTexts: ['clean'],
    }],
  }
  assert.equal(validateNote(good, { offline: false }).ok, true)
  assert.equal(validateNote(good, { offline: true }).ok, false)
})
