// 笔记图片只接受约定的永久成品 URL；不允许查询签名、路径穿越或额外资源域。
export function isPermanentImageUrl(value) {
  if (typeof value !== 'string' || !/^https:\/\/files\.ixicai\.cn\/coursemd\/assets\/[A-Za-z0-9_./-]+\.jpg$/.test(value)) return false
  return !value.split('/').some(part => part === '.' || part === '..')
}

export function offlineImageMapping(note) {
  const mapping = []
  for (const [sectionIndex, section] of (note.sections || []).entries()) {
    for (const [imageIndex, url] of (section.imageDownloadUrls || []).entries()) {
      if (!isPermanentImageUrl(url)) throw new Error('图片必须为 files.ixicai.cn/coursemd/assets 永久 JPEG 链接')
      mapping.push({ sectionId: section.sectionId, sectionIndex, imageIndex,
        frameId: section.frameIds?.[imageIndex] || null, url,
        file: `assets/frame-${String(mapping.length + 1).padStart(4, '0')}.jpg` })
    }
  }
  return mapping
}

export function imageReferences(note, offline) {
  const mapping = offlineImageMapping(note)
  return (note.sections || []).map((section, sectionIndex) => mapping
    .filter(item => item.sectionIndex === sectionIndex).map(item => offline ? item.file : item.url))
}
