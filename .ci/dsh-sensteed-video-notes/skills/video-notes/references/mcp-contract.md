# video-processing MCP 契约速查（contractVersion: video-processing-v1）

公共入口：`https://ai.hozonauto.com/mcp/tools/video-processing`。所有响应为 camelCase；错误信封 `{"error":{"code","message","retryable","requestId"}}`。

## 工具

| 工具 | 关键参数 | 说明 |
| --- | --- | --- |
| `video_capabilities_get` | 无 | 来源适配状态、字幕/ASR 能力、帧策略、限额（本地只读） |
| `video_source_resolve_start` | `source:{kind:"platformUrl",url}` 或 `{kind:"uploadedAsset",assetId}`；`partId?`；`idempotencyKey` | 解析来源；平台 URL 未适配时 `UNSUPPORTED_SOURCE` |
| `video_source_get` | `sourceId` | 只读投影：标题/probe/字幕轨/mediaAssetId；绝不触发下载 |
| `video_upload_authorize` | `filename,contentType,sizeBytes,sha256,purpose(sourceVideo\|subtitle)`；`idempotencyKey` | 返回 PUT 预签名；URL 过期需换新键重授权 |
| `video_upload_complete` | `uploadId`；`idempotencyKey` | 实测校验（大小/SHA256/魔数/ffprobe）后才返回 assetId |
| `video_media_prepare_start` | `sourceId`；`idempotencyKey` | 媒体就绪校验；`MEDIA_NOT_READY` 显式返回 |
| `video_subtitles_read_start` | `sourceId` + `trackId` 或 `subtitleAssetId`；`idempotencyKey` | 字幕规范化，不调 Models、不计费 |
| `video_transcription_start` | `sourceId,language,confirm=true`；`idempotencyKey` | ASR（潜在收费）；未开闸时 `MODEL_DELEGATION_UNAVAILABLE` |
| `video_transcript_get` | `transcriptId,cursor,limit≤200` | 分页 segments + timingQuality |
| `video_frames_extract_start` | `sourceId,strategy(stable_slides\|scene_hybrid\|timestamps)`，`timestampsSeconds?≤50`；`idempotencyKey` | 异步任务；轮询 jobId |
| `video_frames_list` | `frameSetId,cursor,limit≤50` | 每帧 onset/capture/end、sha256、永久 `downloadUrl` |
| `video_job_get` | `jobId` | 状态 `queued/running/waiting/succeeded/partial/failed/cancelled/indeterminate` + `retryAfterSeconds` |
| `video_job_cancel` | `jobId,confirm=true`；`idempotencyKey` | 尽力取消；已计费请求不保证可撤销 |
| `video_asset_download_authorize` | `assetIds≤50`；`idempotencyKey` | 成品图片回永久链接；私有素材回短期签名 |

## 关键稳定码

`UNSUPPORTED_SOURCE`（平台未适配）、`NOT_A_VIDEO`、`MEDIA_NOT_READY`、`UPLOAD_EXPIRED`、`UPLOAD_VALIDATION_FAILED`、`FILE_TOO_LARGE`、`MEDIA_DURATION_EXCEEDED`、`SUBTITLE_UNAVAILABLE`、`MODEL_DELEGATION_UNAVAILABLE`、`FRAME_LIMIT_REACHED`、`ASSET_PUBLICATION_UNAVAILABLE`、`RESOURCE_NOT_FOUND`（未知/越权统一）、`IDEMPOTENCY_CONFLICT`、`IDEMPOTENCY_OUTCOME_UNKNOWN`（对账后才能决定是否重试；`retryable=true` 只表示可能恢复，不授权重发付费请求）。

## 幂等与轮询

- 幂等作用域 = owner + tool + idempotencyKey；同键同输入返回原结果，同键不同输入 `IDEMPOTENCY_CONFLICT`。
- 轮询遵守 `retryAfterSeconds`（缺失时 30 秒起退避）；超时后继续查原 jobId，不换键重提。
- 帧集 `coverage.truncated=true` 表示超预算抽稀，笔记必须注明覆盖缺口。
