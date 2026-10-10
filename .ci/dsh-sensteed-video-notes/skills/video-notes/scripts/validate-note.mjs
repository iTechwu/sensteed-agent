#!/usr/bin/env node
// validate-note.mjs — note.json / 渲染产物校验（docs/1010/03 references/note-quality）。
//
// 用法：validate-note.mjs --input note.json [--offline] [--rendered-md course.md] [--rendered-html course.html]
// 退出码 0=通过；1=存在 error。输出 JSON {ok, errors[], warnings[]}。

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

const ALLOWED_IMAGE_PREFIX = 'https://files.ixicai.cn/coursemd/assets/'
const INJECTION_PATTERNS = [
  /<\s*script/i,
  /javascript\s*:/i,
  /data\s*:\s*text\/html/i,
  /\bon[a-z]+\s*=/i,
]

export function validateNote(note, { offline = false } = {}) {
  const errors = []
  const warnings = []

  if (note.schemaVersion !== 'video-notes-v1') {
    errors.push(`schemaVersion 必须为 video-notes-v1，当前 ${JSON.stringify(note.schemaVersion)}`)
  }

  // 时间单调与帧区间连续
  const sections = note.sections || []
  let previousStart = -Infinity
  sections.forEach((section, index) => {
    const start = Number(section.startSeconds)
    if (!Number.isFinite(start)) errors.push(`sections[${index}].startSeconds 非法`)
    else if (start < previousStart) errors.push(`sections[${index}] 时间倒序（${start} < ${previousStart}）`)
    else previousStart = start
    const end = section.endSeconds
    if (end != null && Number.isFinite(Number(start)) && Number(end) <= Number(start)) {
      warnings.push(`sections[${index}].endSeconds <= startSeconds`)
    }
  })

  // segment 覆盖不重不漏
  const evidence = note.evidence || {}
  const covered = sections.flatMap(section => section.segmentIds || [])
  const coveredSet = new Set(covered)
  if (coveredSet.size !== covered.length) errors.push('segment 覆盖存在重复（同一 segmentId 出现在多个 section）')
  const expected = Number(evidence.segmentCount || 0)
  if (expected > 0 && covered.length !== expected) {
    errors.push(`segment 覆盖数 ${covered.length} != 证据总数 ${expected}（基线必须不重不漏）`)
  }

  // 图片链接安全
  sections.forEach((section, index) => {
    for (const url of section.imageDownloadUrls || []) {
      if (offline) {
        if (!/^assets\/[\w.-]+\.jpg$/.test(url)) errors.push(`sections[${index}] 离线图片路径非法：${url}`)
      } else if (!url.startsWith(ALLOWED_IMAGE_PREFIX)) {
        errors.push(`sections[${index}] 图片非 coursemd/assets 永久地址：${url}`)
      } else if (/[?&](X-Amz|signature|Expires)=/i.test(url)) {
        errors.push(`sections[${index}] 图片链接携带签名参数（永久链接不得带签名）：${url}`)
      }
    }
  })

  // 注入安全
  const textFields = []
  for (const section of sections) {
    for (const text of [...(section.rawTexts || []), ...(section.displayTexts || [])]) {
      textFields.push(text)
    }
    if (section.title) textFields.push(section.title)
  }
  if (note.summary?.text) textFields.push(note.summary.text)
  textFields.forEach(text => {
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(String(text))) {
        errors.push(`文本包含可执行内容片段，必须转义或清除：${String(text).slice(0, 60)}…`)
        break
      }
    }
  })

  // 缺口显式化
  const quality = note.quality || {}
  if (evidence.timingQuality === 'none' && !quality.warnings?.some(item => String(item).includes('timingQuality'))) {
    warnings.push('timingQuality=none：必须输出带缺口说明的部分笔记')
  }
  if (evidence.frameCount === 0 && sections.length === 0 && expected === 0) {
    warnings.push('无文字与截图证据：输出为空笔记')
  }

  return { ok: errors.length === 0, errors, warnings }
}

export function validateRenderedFiles(markdownPath, htmlPath, { offline = false, rootDir = process.cwd() } = {}) {
  const errors = []
  const warnings = []
  const markdown = markdownPath && existsSync(markdownPath) ? readFileSync(markdownPath, 'utf8') : null
  const html = htmlPath && existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : null
  if (!markdown) errors.push(`course.md 不存在：${markdownPath}`)
  if (!html) errors.push(`course.html 不存在：${htmlPath}`)
  if (markdown) {
    const imageRefs = [...markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(match => match[1])
    for (const reference of imageRefs) {
      if (offline) {
        if (reference.startsWith('assets/')) {
          const target = resolve(rootDir, reference)
          if (!target.startsWith(resolve(rootDir)) || isAbsolute(reference) || reference.includes('..')) {
            errors.push(`离线图片路径越界：${reference}`)
          } else if (!existsSync(target)) {
            warnings.push(`离线图片缺失（可恢复）：${reference}`)
          }
        } else if (!reference.startsWith(ALLOWED_IMAGE_PREFIX)) {
          errors.push(`Markdown 图片引用既非离线相对路径也非永久链接：${reference}`)
        }
      } else if (!reference.startsWith(ALLOWED_IMAGE_PREFIX)) {
        errors.push(`在线模式 Markdown 图片必须为 coursemd/assets 永久链接：${reference}`)
      }
    }
    if (/<\s*script/i.test(markdown)) errors.push('course.md 含 script 标签')
  }
  if (html) {
    if (!/<meta charset="utf-8"/i.test(html)) errors.push('course.html 缺少 UTF-8 声明')
    if (!/Content-Security-Policy/i.test(html)) errors.push('course.html 缺少 CSP')
    if (!offline && /img-src(?![^"]*files\.ixicai\.cn)/i.test(html)) {
      errors.push('在线模式 CSP 未放行 files.ixicai.cn 图片域')
    }
    if (/<\s*script/i.test(html)) errors.push('course.html 含 script 标签（严格无脚本模板）')
    if (/https?:\/\/(?!files\.ixicai\.cn)[^\s"']+/i.test(html.replace(/<meta[^>]*>/gi, ''))) {
      warnings.push('course.html 存在非 files.ixicai.cn 外链，需人工确认')
    }
  }
  return { ok: errors.length === 0, errors, warnings }
}

function main() {
  const argv = process.argv.slice(2)
  const get = flag => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : null
  }
  const inputPath = get('--input')
  if (!inputPath) {
    process.stderr.write('usage: validate-note.mjs --input note.json [--offline] [--rendered-md course.md] [--rendered-html course.html]\n')
    process.exit(2)
  }
  const offline = argv.includes('--offline')
  const note = JSON.parse(readFileSync(inputPath, 'utf8'))
  const result = validateNote(note, { offline })
  const markdownPath = get('--rendered-md')
  const htmlPath = get('--rendered-html')
  if (markdownPath || htmlPath) {
    const rendered = validateRenderedFiles(markdownPath, htmlPath, { offline, rootDir: process.cwd() })
    result.errors.push(...rendered.errors)
    result.warnings.push(...rendered.warnings)
    result.ok = result.errors.length === 0
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exit(result.ok ? 0 : 1)
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main()
}
