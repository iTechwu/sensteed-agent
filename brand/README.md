# 哪吒Agent 品牌配置

当前产品名称为 **哪吒Agent**，产品标识为 **hozonauto-agent**。唯一配置为 `brand/brand.config.json`。官方 Logo 来源与历史数据兼容边界见 [品牌迁移说明](hozonauto/README.md)。

## 生成与检查

```sh
corepack pnpm --filter @dofe/dsh-sensteed-product generate:brand
corepack pnpm --filter dsh-plugin-desktop generate:brand
corepack pnpm brand:docs
corepack pnpm check
```

品牌素材位于 `brand/hozonauto/assets/`：原始官方 SVG、应用 JPEG 母版、透明侧栏图、会话头像及文字标。既有生成脚本派生各平台图标、客户端素材、产品身份模块、electron-builder 配置和文档围栏，生成物应提交，不手工修改。

## 身份与兼容

- Beta：`哪吒Agent.app`，`com.hozonauto.agent.beta`，产物前缀 `hozonauto-agent-beta`。
- Stable：`哪吒Agent Stable`，`com.hozonauto.agent`，产物前缀 `hozonauto-agent`。
- 新安装使用新的 home 和用户数据目录；存在历史数据时沿用旧通道数据。Electron 自动创建的空缓存目录不视为已迁移数据。
- `hozonauto-agent` 为新的命令入口；`sensteed-agent` 仅作历史兼容别名。
- `sensteed` 组合键、插件包 ID、租户 UUID、OIDC client ID、更新协议头及仓库地址保持兼容，不代表可见产品品牌。不以字符串替换的方式更换授权租户。
- `packageName` 为内部工作区与 Profile 准入契约，不随显示品牌变更。

## 打包

从干净且已推送的 dev 执行 `corepack pnpm release:prepare --execute`，再在其生成的 tagged main 上执行 `corepack pnpm package:dir` 或相应平台打包命令。内置内容在 dev 更新并提交，tagged 打包仅离线校验。
