# dsh-sensteed-video-notes

Sensteed Agent 视频笔记插件：将 YouTube、小红书、抖音、Bilibili 或用户选择的本地视频转换为带真实截图与可追溯时间线的 Markdown/HTML 笔记。

设计文档：`docs/1010/tools-add-course2md/`（本仓库）。

## 结构

- `cordis.patch.yml`：注册 `video-processing` 公共 MCP（`https://ai.hozonauto.com/mcp/tools/video-processing`）与本技能；Models key 只来自 Host 环境变量 `MODELS_API_KEY`，不写入任何文件。
- `index.js`：注入 SKILL.md 系统提示段 + 只读 `sensteed_video_notes_bootstrap` 目录预检工具。
- `skills/video-notes/SKILL.md`：A→G 执行流程（来源→媒体→文字→图片→对齐→写作→导出）。
- `skills/video-notes/references/`：MCP 契约速查、来源适配差异、笔记质量门槛。
- `skills/video-notes/scripts/`：确定性辅助脚本（对齐/渲染/校验），Node 内置模块、零外部依赖。

## 边界

- 语义写作与编排在本设备端 Agent；服务端只提供素材处理基础 MCP，不含章节/摘要逻辑。
- 本地视频必须经用户选择/会话附件授权后流式上传，不把本地路径交给远端。
- 成品图片为 TOS `coursemd/assets/...` 永久链接（`https://files.ixicai.cn/...`，无签名）；离线资源包是本地副本，不替代服务端存储。
- 云端 ASR 在异步委托闸门（G0-B/G0-C）验证通过前 fail-closed（`MODEL_DELEGATION_UNAVAILABLE`）。

## 测试

```sh
npm test     # node --test test/
npm run check
```

## 同步

插件源码权威在本目录；sensteed-agent 侧 `.ci/dsh-sensteed-video-notes/` 快照由
`scripts/sync-dofe-plugin-snapshot.mjs --write dsh-sensteed-video-notes` 生成。
