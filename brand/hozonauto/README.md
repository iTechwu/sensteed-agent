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
