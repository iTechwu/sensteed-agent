---
name: sensteed-video-notes
description: 将 YouTube、小红书、抖音、Bilibili 或用户选择的本地视频转换为带真实视频截图、可追溯时间线的图文笔记（Markdown/HTML）。适用于课程笔记、视频拆解、讲座整理、带截图的图文总结。
---

# 视频笔记（sensteed-video-notes）

通过 `mcp__video-processing__*` 工具工作。开始时调用 `sensteed_video_notes_bootstrap` 和 `video_capabilities_get`，确认工具目录、各来源可用性与限制（512 MiB / 120 分钟 / 120 帧预算以 capabilities 实际返回为准）。不要把 Cookie、API Key、租户、用户标识、本地路径或对象存储 key 作为工具参数。

本地脚本使用 bootstrap 返回的 `scriptPaths` 绝对路径，不假定当前目录就是插件目录。能力状态仅说明接口配置开启，不代表平台真实样本已通过验收。平台字幕只选择 source_get 已发现的人工/自动轨；调用字幕读取后，若返回 queued/running，轮询原 jobId，从成功结果的 resultRefs.transcriptId 继续读取。只有取得 transcript 才能声称读到了字幕；SUBTITLE_UNAVAILABLE 时可以使用用户提供的 SRT/VTT。

## 输入与预检

1. 从用户消息获取视频来源；缺少来源才询问。默认中文、时间顺序、Markdown 与 HTML、真实截图、保留原始转写与来源。
2. 用户已说出输出格式、语言、目标目录、章节范围时沿用。Bilibili 标准视频链接用 partId 正整数或 URL 的 p 参数选择具体分 P，两者同时出现必须一致；短链接须先取得标准视频链接后再选 P。合集/多 P 必须确认具体条目或批量范围，逐项处理；当前没有合集候选/批量接口，不默认下载整个合集。PART_SELECTION_UNSUPPORTED 时停止该选择，不默认为第一 P。
3. 本地视频首次上传前说明会传到私有云处理；用户明确要求上传/云端处理则沿用授权。用户要求完全离线时明确当前能力缺口，保留文件不自动上传。
4. 本地文件用 `sensteed_video_file_upload` 的 `list` 找到当前会话用户附件，再用 `upload`、attachmentId 与固定幂等键上传。Host 按块计算 SHA256、流式 PUT 到已验证私有 TOS，Tools complete 校验后返回 assetId；无需 shell、base64、凭据或本地路径参数。字幕 SRT/VTT 也走此入口。工具缺失时说明 Host 传输不可用，不要求用户手工携带签名地址或密钥。

## 执行流程（A→G）

| 阶段 | 行为 | 检查点 |
| --- | --- | --- |
| A 来源 | 链接调用 `video_source_resolve_start`；本地附件通过 `sensteed_video_file_upload` 上传，取得 assetId 后以 `uploadedAsset` resolve。按原 jobId 轮询 `video_job_get` | sourceId、幂等键、assetId |
| B 媒体 | `video_media_prepare_start` 取真实时长/音轨；`video_source_get` 复核 | sourceVersion、probe |
| C 文字 | 人工字幕轨优先，其次自动字幕/用户旁挂字幕（`video_upload_authorize` purpose=subtitle → `video_subtitles_read_start`）。字幕不可用且用户允许时才 `video_transcription_start`（可能计费；`MODEL_DELEGATION_UNAVAILABLE` 时停止并说明） | trackId/transcriptId、timingQuality |
| D 图片 | 课程/演示选 `stable_slides`，快节奏选 `scene_hybrid`，用户指定段落用 `timestamps`。`video_frames_extract_start` 后按 `retryAfterSeconds` 轮询；`video_frames_list` 分页取每张永久 `downloadUrl` | frameSetId、每张 URL/摘要 |
| E 对齐 | 运行 `scripts/align-timeline.mjs`：segment 按中点归属帧区间 `[onset,nextOnset)`，保留全部原始 segment 与图片证据 | 基线 note.json |
| F 写作 | 分批组织章节（长视频按时间窗分批读 transcript，每批约 10 分钟并记录 coveredSegmentIds）；润色/总结经本地 Agent 完成；不改动证据中的数值、公式、时间 | 章节结构、证据引用 |
| G 导出 | `scripts/render-note.mjs` 生成 MD/HTML → `scripts/validate-note.mjs` 校验 → 原子写入目标目录 | manifest、校验结果 |

ASR 与截图在媒体就绪后可独立推进：某一路失败不取消另一路成功结果。轮询超时继续查原 jobId，不得换幂等键重提；`IDEMPOTENCY_CONFLICT` 表示同键不同输入，须换新键并说明。

ASR 已有调用者委托实现，是否可用仍以部署 capabilities 为准。调用 `video_transcription_start` 须 confirm=true；网关/Models 派生委托，客户端无需传 delegationRef、租户或 Models key。音频留在私有桶，worker 保存原 Models 任务引用并分次查询；提交未知时只对账，禁止换键重提。`ASR_SUBMISSION_INDETERMINATE` 或委托失效时保留字幕/截图结果，报告文字缺口。无真实分段时间的 ASR 标记 timingQuality=none，不能编造对齐。

## 对齐与质量规则

- 实际图片时间用 `captureSeconds`，章节开始用 `onsetSeconds`，二者不混用。
- `timingQuality=chunk` 不建立句子级精确对应，按 chunk 区间列画面并标明粗粒度；`none` 不伪造时间，生成带缺口说明的部分笔记。
- 超帧预算时文字可全保留，但图文覆盖必须按 frameSet 的 `coverage` 缺口注明；静音视频可交付截图笔记，不能冒充语音内容。
- 基线笔记对每个 speech segment 恰好保留一次覆盖映射；摘要可引用同一 segment，但基线原文不重复不丢失。
- 无有效时间的 speech 原文保留于 `sec_unaligned`，时间留空，不能丢弃或猜测时间；silence 不计入 speech 覆盖总数。对齐输入传入 `coverage` 和 `frameSetId`，截帧预算缺口必须传到笔记。

## 输出

默认输出 `course.md`、`course.html`、`note.json`、`manifest.json`、`transcript.json`，图片直接引用 Tools 返回的永久 `https://files.ixicai.cn/coursemd/assets/...` 链接。用户需要断网阅读时额外导出离线资源包（render `--offline` 模式，图片为 `assets/` 本地副本）。HTML 不含脚本与远端追踪资源；所有标题/原文/总结必须转义。交付说明内容来源与覆盖缺口；失败限制不能隐藏，但不展示 jobId、队列名或 Provider 术语。

渲染 CLI 的 `--out-dir` 必须是用户工作区内尚不存在的新版本目录，其父目录先由 Host 创建；脚本拒绝覆盖已有目录。离线图片映射从渲染输出的 `images` 获取，逐张下载到 `file` 指定路径并核对 Tools 的 SHA256。`note.json` 始终保留永久 URL 证据，只有 MD/HTML 改用相对路径。缺图或 symlink 越界导致校验失败，不能交付为已完成离线包。课程原文出现 HTML/JavaScript 教学代码时保留原文，由渲染器转义成普通文字；不要为通过校验删除证据。

恢复：重启后先读本地 checkpoint，再查原 job 状态；cancel 保留已完成资产引用。需要工具字段与稳定码细节时读取 [references/mcp-contract.md](references/mcp-contract.md)；来源差异见 [references/source-adapters.md](references/source-adapters.md)；笔记质量门槛见 [references/note-quality.md](references/note-quality.md)。
