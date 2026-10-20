# 哪吒Agent / hozonauto-agent

产品名称为“哪吒Agent”，英文/发布标识为 `hozonauto-agent`。当前 Beta 通道 App 为 `哪吒Agent.app`，Bundle ID 为 `com.hozonauto.agent.beta`；Stable 通道标注 Stable，以便双通道共存。

官方标志源自哪吒汽车官网 https://www.hozonauto.com/ 所引用的 SVG：
https://new-official-website-prod.oss-cn-hangzhou.aliyuncs.com/cmsstatic/static/images/logo-w.svg

保留原始 SVG；应用构建素材仅做尺寸适配、留白与黑白主题着色，不重绘标志。品牌唯一配置为 `brand/brand.config.json`，通过既有生成脚本派生图标、身份、客户端素材与文档。

## 兼容边界

- 旧用户数据不移动、不覆盖。新目录尚不存在时沿用旧通道的用户数据和 Harness home；新安装使用 hozonauto-agent 目录。
- `sensteed` 组合键、历史插件包/路由 ID、租户 UUID、OIDC client ID、更新请求头及仓库 URL 为服务端/存量数据兼容契约，不做字符串替换。它们不代表用户可见产品名称。
- Electron 系统凭据加密与应用身份相关；原始凭据保持原处，若系统无法解密则需重新飞书登录，不降低凭据保护或将凭据转换为明文。
- 本地安装不等于发布远端更新或更改 GitHub 仓库名称。

## 本地安装验证（2026-10-20）

最终版本 `0.2.1-rc.2-beta.202610201612`，tag 提交 `7bcddcea5e`。已安装 `/Applications/哪吒Agent.app`，Bundle ID 为 `com.hozonauto.agent.beta`。app.asar SHA256 为 `b98de7ab994a5b09fcf8f2160a528552d412fe8b978e241024c0742191637195`，与构建产物一致。

全量 `pnpm check`、发布布局、内置内容离线校验和最终包运行时校验通过。实机恢复旧版 Profile、历史会话、默认模型与业务入口；本地技能页面实际加载 35/35。旧品牌 App 移至 `/tmp/sensteed-ux-install-backups/legacy-brand-before-hozonauto-1612.app`，历史数据目录保留，未复制或明文导出凭据。

此前 15:07 包的目录识别遗漏已通过最终包修复：自动创建的新空缓存目录不能覆盖历史数据选择。此次验证不等于远端更新发布或完整逐页 UX 验收。
