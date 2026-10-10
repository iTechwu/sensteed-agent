#!/usr/bin/env node
// render-note.mjs — 从 note.json（video-notes-v1）确定性渲染 Markdown + HTML。
//
// 用法：render-note.mjs --input note.json --out-dir <dir> [--offline] [--title-suffix "..."]
// - 在线模式（默认）：图片引用 Tools 返回的永久 https://files.ixicai.cn/coursemd/assets/... 链接。
// - 离线模式（--offline）：图片引用 assets/<n>.jpg 相对路径（本地副本由调用方下载放入）。
// - HTML：UTF-8、语义目录、章节锚点、无脚本、无远端资源、严格转义、CSP。
// - 所有标题/原文/总结全部 HTML 转义；Markdown raw HTML 禁用（<> 转义）。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const IMAGE_URL_PREFIX = 'https://files.ixicai.cn/coursemd/assets/'

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function formatSeconds(seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value)) return ''
  const total = Math.max(0, Math.round(value))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = n => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}

function sectionLines(note, section, offline) {
  const lines = []
  const heading = escapeHtml(section.title || `段落 ${section.sectionId}`)
  const stamp = formatSeconds(section.startSeconds)
  lines.push(`## ${heading}${stamp ? `（${stamp}）` : ''}`)
  lines.push('')
  const texts = section.displayTexts?.length ? section.displayTexts : section.rawTexts || []
  for (const text of texts) {
    if (String(text).trim()) lines.push(escapeHtml(String(text).trim()))
  }
  const urls = section.imageDownloadUrls || []
  urls.forEach((url, index) => {
    const reference = offline ? `assets/frame-${String(index + 1).padStart(4, '0')}.jpg` : url
    const alt = `${note.source?.title || '视频'} ${stamp}`
    lines.push('')
    lines.push(`![${alt}](${reference})`)
    if (!offline && !url.startsWith(IMAGE_URL_PREFIX)) {
      lines.push('')
      lines.push(`> 注意：图片链接非 coursemd/assets 永久地址：${escapeHtml(url)}`)
    }
  })
  lines.push('')
  return lines
}

export function renderMarkdown(note, { offline = false } = {}) {
  const lines = []
  const source = note.source || {}
  lines.push(`# ${escapeHtml(source.title || '视频笔记')}`)
  lines.push('')
  const meta = []
  if (source.author) meta.push(`作者：${escapeHtml(source.author)}`)
  if (source.duration != null) meta.push(`时长：${formatSeconds(source.duration)}`)
  if (source.platform) meta.push(`平台：${source.platform}`)
  if (note.evidence?.timingQuality) meta.push(`时间线：${note.evidence.timingQuality}`)
  if (meta.length) {
    lines.push(meta.join(' · '))
    lines.push('')
  }
  if (source.safeCanonicalUrl) {
    lines.push(`来源：${source.safeCanonicalUrl}`)
    lines.push('')
  }
  const quality = note.quality || {}
  const notices = []
  if (quality.warnings?.length) notices.push(...quality.warnings)
  if (quality.failedStages?.length) notices.push(`未完成阶段：${quality.failedStages.join('、')}`)
  if (notices.length) {
    lines.push('> 覆盖说明：' + notices.join('；'))
    lines.push('')
  }
  if (note.summary?.text) {
    lines.push('## 摘要')
    lines.push('')
    lines.push(escapeHtml(note.summary.text))
    lines.push('')
  }
  lines.push('## 目录')
  lines.push('')
  note.sections.forEach((section, index) => {
    const heading = section.title || `段落 ${section.sectionId}`
    const anchor = `sec-${index + 1}`
    lines.push(`- [${escapeHtml(heading)}](#${anchor})${section.startSeconds != null ? `（${formatSeconds(section.startSeconds)}）` : ''}`)
  })
  lines.push('')
  note.sections.forEach(section => {
    lines.push(...sectionLines(note, section, offline))
  })
  lines.push('---')
  lines.push('')
  lines.push(`由 sensteed-video-notes 生成（${note.generatorVersion || ''}）；原始转写与截图证据保留于 note.json / transcript.json。`)
  lines.push('')
  return lines.join('\n')
}

export function renderHtml(note, { offline = false } = {}) {
  const toc = note.sections
    .map((section, index) => {
      const heading = escapeHtml(section.title || `段落 ${section.sectionId}`)
      return `<li><a href="#sec-${index + 1}">${heading}</a></li>`
    })
    .join('\n')
  const body = note.sections
    .map((section, index) => {
      const heading = escapeHtml(section.title || `段落 ${section.sectionId}`)
      const stamp = formatSeconds(section.startSeconds)
      const texts = (section.displayTexts?.length ? section.displayTexts : section.rawTexts || [])
        .filter(text => String(text).trim())
        .map(text => `<p>${escapeHtml(text)}</p>`)
        .join('\n')
      const images = (section.imageDownloadUrls || [])
        .map((url, imageIndex) => {
          const src = offline ? `assets/frame-${String(imageIndex + 1).padStart(4, '0')}.jpg` : escapeHtml(url)
          return `<figure><img src="${src}" alt="${escapeHtml(note.source?.title || 'video')} ${escapeHtml(stamp)}" loading="lazy" /></figure>`
        })
        .join('\n')
      return `<section id="sec-${index + 1}"><h2>${heading}${stamp ? `<time>（${escapeHtml(stamp)}）</time>` : ''}</h2>${texts}${images}</section>`
    })
    .join('\n')
  const title = escapeHtml(note.source?.title || '视频笔记')
  const qualityNotice = (note.quality?.warnings || []).length
    ? `<p class="notice">覆盖说明：${escapeHtml((note.quality?.warnings || []).join('；'))}</p>`
    : ''
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https://files.ixicai.cn data:; style-src 'unsafe-inline'" />
<style>
body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 52rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.7; color: #1c1c1e; }
figure { margin: 1rem 0; } img { max-width: 100%; height: auto; border-radius: 8px; }
time { color: #6e6e73; font-size: 0.9em; } .notice { background: #fff7e6; border-left: 4px solid #f0a020; padding: .5rem 1rem; }
</style>
</head>
<body>
<h1>${title}</h1>
${qualityNotice}
<nav><ol>${toc}</ol></nav>
<main>${body}</main>
<footer><p>由 sensteed-video-notes 生成；原始证据保留于 note.json / transcript.json。</p></footer>
</body>
</html>
`
}

export function renderNoteOfflineImages(note) {
  // 离线模式按 sections 顺序平铺图片文件名映射（调用方据此下载本地副本）。
  const mapping = []
  let index = 0
  for (const section of note.sections || []) {
    for (const url of section.imageDownloadUrls || []) {
      index += 1
      mapping.push({ sectionId: section.sectionId, frameId: section.frameIds?.[index - 1] || null, url, file: `assets/frame-${String(index).padStart(4, '0')}.jpg` })
    }
  }
  return mapping
}

function main() {
  const argv = process.argv.slice(2)
  const get = flag => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : null
  }
  const inputPath = get('--input')
  const outDir = get('--out-dir')
  const offline = argv.includes('--offline')
  if (!inputPath || !outDir) {
    process.stderr.write('usage: render-note.mjs --input note.json --out-dir <dir> [--offline]\n')
    process.exit(2)
  }
  const note = JSON.parse(readFileSync(inputPath, 'utf8'))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'course.md'), renderMarkdown(note, { offline }), 'utf8')
  writeFileSync(join(outDir, 'course.html'), renderHtml(note, { offline }), 'utf8')
  process.stdout.write(JSON.stringify({ ok: true, files: ['course.md', 'course.html'], offline }) + '\n')
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main()
}
