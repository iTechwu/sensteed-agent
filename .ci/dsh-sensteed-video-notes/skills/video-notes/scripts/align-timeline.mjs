#!/usr/bin/env node
// align-timeline.mjs — 确定性图文对齐（docs/1010/03 §2.3）。
//
// 输入（stdin JSON 或 --input <file>）：
// {
//   "source": {...}, "transcript": {segments:[{segmentId,startSeconds,endSeconds,rawText,status}]},
//   "frames": [{frameId,assetId,onsetSeconds,captureSeconds,endSeconds,downloadUrl,width,height,sha256}],
//   "timingQuality": "source|chunk|none"
// }
// 输出：note 基线 JSON（sections[]，每 segment 恰好归属一个 section；原文不重不漏）。
//
// 规则：帧按 onset 排序构成 [onset,nextOnset) 区间；segment 按中点归属；
// 首帧之前的文字归首帧所在 section（若存在帧），尾段不丢；timingQuality!=source
// 时不建立句子级精确对应，标注粗粒度。

import { readFileSync } from 'node:fs'

export function alignTimeline({ transcript, frames, timingQuality = 'source', source = null }) {
  const segments = (transcript?.segments || []).slice()
  const sortedFrames = (frames || [])
    .slice()
    .sort((a, b) => Number(a.onsetSeconds) - Number(b.onsetSeconds))
  if (sortedFrames.length > 0) {
    for (let index = 0; index < sortedFrames.length - 1; index += 1) {
      sortedFrames[index] = { ...sortedFrames[index], endSeconds: sortedFrames[index + 1].onsetSeconds }
    }
  }

  const sections = sortedFrames.map((frame, index) => ({
    sectionId: `sec_${String(index + 1).padStart(4, '0')}`,
    title: '',
    startSeconds: Number(frame.onsetSeconds),
    endSeconds: frame.endSeconds == null ? null : Number(frame.endSeconds),
    frameIds: [frame.frameId],
    imageDownloadUrls: frame.downloadUrl ? [frame.downloadUrl] : [],
    segmentIds: [],
    rawTexts: [],
    displayTexts: [],
  }))

  const warnings = []
  const uncovered = []
  if (timingQuality !== 'source') {
    warnings.push(`timingQuality=${timingQuality}: 不建立句子级精确时间对应`)
  }
  if (sections.length === 0 && segments.length > 0) {
    warnings.push('no-frames: 文字证据未与截图对齐，输出纯文字时间线')
  }

  for (const segment of segments) {
    if (segment.status && segment.status !== 'speech') continue
    const start = Number(segment.startSeconds)
    const end = Number(segment.endSeconds)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      uncovered.push(segment.segmentId)
      warnings.push(`segment ${segment.segmentId}: 非法时间区间，未归属`)
      continue
    }
    const midpoint = (start + end) / 2
    let target = null
    if (sections.length > 0) {
      if (midpoint < sections[0].startSeconds) target = sections[0]
      else {
        for (const section of sections) {
          if (midpoint >= section.startSeconds && (section.endSeconds == null || midpoint < section.endSeconds)) {
            target = section
            break
          }
        }
        if (target == null) target = sections[sections.length - 1]
      }
    }
    if (target == null) {
      // 无帧：构造单一时间线 section 承载全部文字。
      const only = {
        sectionId: 'sec_timeline',
        title: '',
        startSeconds: Number.isFinite(sections[0]?.startSeconds) ? sections[0].startSeconds : 0,
        endSeconds: null,
        frameIds: [],
        imageDownloadUrls: [],
        segmentIds: [],
        rawTexts: [],
        displayTexts: [],
      }
      sections.push(only)
      target = only
    }
    target.segmentIds.push(segment.segmentId)
    target.rawTexts.push(String(segment.rawText ?? ''))
    target.displayTexts.push(String(segment.rawText ?? ''))
  }

  const coveredSegmentIds = sections.flatMap(section => section.segmentIds)
  const baseline = {
    schemaVersion: 'video-notes-v1',
    noteVersion: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    generatorVersion: 'align-timeline.mjs v1',
    source,
    evidence: {
      timingQuality,
      frameCount: sortedFrames.length,
      segmentCount: segments.length,
      coveredSegmentCount: coveredSegmentIds.length,
    },
    sections,
    quality: {
      complete: uncovered.length === 0 && coveredSegmentIds.length === segments.filter(s => !s.status || s.status === 'speech').length,
      warnings: Array.from(new Set(warnings)),
      failedStages: [],
    },
  }
  return baseline
}

export function mergeSections(baseline, titles) {
  // 写作阶段回填标题/displayText：不新增/删除 segment 引用（确定性约束）。
  const merged = JSON.parse(JSON.stringify(baseline))
  for (const section of merged.sections) {
    const patch = titles?.[section.sectionId]
    if (patch?.title != null) section.title = String(patch.title)
    if (patch?.displayHtml != null) section.displayHtml = String(patch.displayHtml)
    if (patch?.displayTexts != null) section.displayTexts = patch.displayTexts.map(String)
  }
  return merged
}

function main() {
  const argv = process.argv.slice(2)
  let inputPath = null
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--input') inputPath = argv[index + 1]
  }
  const raw = inputPath ? readFileSync(inputPath, 'utf8') : readFileSync(0, 'utf8')
  process.stdout.write(`${JSON.stringify(alignTimeline(JSON.parse(raw)), null, 2)}\n`)
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main()
}
