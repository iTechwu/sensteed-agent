# 笔记质量门槛与校验清单（note schema: video-notes-v1）

## 结构

```text
note
  schemaVersion / noteVersion / generatorVersion
  source: sourceId / sourceVersion / platform / safeCanonicalUrl / title / author / duration
  evidence: transcriptId / timingQuality / frameSetId / segment↔frame 映射
  sections[]: sectionId / title / startSeconds / endSeconds
    frameIds[] / imageDownloadUrls[] / segmentIds[] / rawText / displayText
  summary: 可选摘要 + 引用 segmentIds
  quality: complete / coverage / warnings / failedStages
```

## 校验清单（validate-note.mjs 覆盖）

1. 时间单调：sections 按 `startSeconds` 升序、不重叠；帧区间 `[onset,nextOnset)` 连续；`captureSeconds` 落在区间内。
2. 覆盖：每个 speech segment 恰好出现在一个 section 的 `segmentIds` 中（不重不漏）；摘要引用不改变基线覆盖。
3. 图片：note 的 `imageDownloadUrls` 始终是 `https://files.ixicai.cn/coursemd/assets/...`（无任何查询参数/路径穿越）。离线 MD/HTML 的相对图片路径与渲染输出 `images` 映射一致，文件存在且不经 symlink 逃出输出目录；缺图为错误。
4. 注入安全：原始转写中的 HTML/JavaScript 教学代码保留为证据；渲染层转义 HTML 和 Markdown 控制字符，输出无可执行 script/事件属性，不能额外引入第三方图片。原文字段中的代码只作为提示，不成为删除证据的理由。
5. 路径安全：输出路径禁止 `..`、绝对路径覆盖、symlink 逃逸；同源重生成写新版本目录，不覆盖用户手改文件。
6. 缺口显式化：`timingQuality=chunk/none`、`coverage.truncated=true`、`failedStages` 非空时，笔记头部必须有对应说明。
7. 无时间原文进入 `sec_unaligned`（时间留空）；speech 覆盖 ID 集合必须与证据一致。silence 不计入 speech 数量。noteVersion 由输入摘要产生，相同输入重跑不随日期变化。

## 写作边界

- 模型不改写证据中的数值、公式、时间；润色前后同时保留 rawText 与 displayText。
- 长视频分批阅读 transcript（每批约 10 分钟，受 token 预算再拆），每批记录 coveredSegmentIds；提纲必须来自已读证据。
- 图片只按需发送有界缩略图给视觉模型；120 张高清图不一次性进上下文。看不清/无法识别的板书注明缺口。
- 摘要失败只标 `summaryUnavailable`，不影响原始图文笔记交付；计费值只取 Models 记录。
