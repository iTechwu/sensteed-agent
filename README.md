<!-- brand:brand-title:start -->
Sensteed Agent<!-- brand:brand-title:end -->

<p align="center">
  <strong>山子高科企业级 AI 桌面工作台 —— 基于 DeepSeek Harness 构建，运行于 Windows 与 macOS。</strong>
</p>

<!-- brand:download-cta:start -->
<h3 align="center"><a href="http://10.30.30.212/wumin1/sensteed-agent/-/releases">安装包从 GitLab Releases 获取。</a></h3><!-- brand:download-cta:end -->

<p align="center">
  万物皆「插件」，桌面本身也是「插件」。
</p>


## 项目定位

Sensteed Agent（山子 Agent）把 DeepSeek Harness 的本地 Web UI、Host 服务和插件系统完整装进一个原生桌面应用：自动启动并管理本地内核服务，集成系统托盘、桌面窗口、终端、通知、更新与工作配置，无需安装 Node.js 或执行任何命令。

| 视角 | 说明 |
| --- | --- |
| 面向用户 | 打开即用的 AI 工作台：对话、Agent 任务、插件能力、看板与运维工具都在桌面内完成。 |
| 面向企业 | 山子高科内部 AI 工作台。登录强制走飞书 SSO，模型与内置能力按企业授权（entitlements）下发，操作经审计服务留痕并同步 Models。 |
| 面向开发者 | 一个 fork 型桌面发行版：固定版本的上游内核原样运行，桌面壳与全部业务能力都按「一切皆插件」的方式组合，可插拔、可演进。 |

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 原生桌面壳 | compatibility / extended / advanced 三种窗口模式，系统托盘、原生菜单、通知、macOS 材质与 Mica 窗口效果。 |
| DoFe 访问（强制飞书登录） | 首次使用必须完成飞书 SSO 绑定；租户校验、企业授权组、接口协议与默认模型选择、内置能力开关都在「用户设置」中完成，手动凭据模式不可绕过登录。 |
| 业务插件套件 | 抖音运营、招聘、销售、供方观察、内容指令、看板、FinOps、审计、知识采集等 DoFe 数据源即插即用，由 `dofe-managed` 统一管理凭据与 MCP 传输。 |
| 审计与运维 | 操作审计事件本地暂存（outbox）并按配置同步 Models；财务与运营看板内置于桌面。 |
| 插件市场 | DSH Community Market 内置：插件发现、详情、安装与管理，支持开放数据源接入。 |
| 恢复与安全模式 | 启动检查点、一键回滚、失败自动进入恢复助手；Safe Mode 以出厂默认配置启动用于排障。 |
| 浏览器与局域网访问 | 默认仅监听回环；可选交给系统浏览器打开或开放局域网（带连接栅栏与 LAN HTTPS）。 |
| 系统代理继承 | Node 侧出站统一继承系统代理，启动即安装出站策略，启动报告写明实际路由。 |
| 手机远程 | 通过 Agents Anywhere 从手机连接桌面 Agent，发起任务并跟进进度。 |
| 更新通道 | stable / beta 双通道，固定版本检查与安装包下载分离，请求头携带版本与通道元数据。 |

### 首次设置、浏览器与局域网访问

每个尚未初始化的 profile 首次启动时，会先显示桌面自带的 Setup Wizard：可设置窗口模式与系统材质、插件市场、通知、是否用系统默认浏览器自动打开，以及 Web 访问范围；也可以直接跳过。向导完成或跳过以前，Host 和主窗口都不会启动。

Web 服务默认仅监听本机回环地址。开启「用浏览器打开」后，桌面会在 Web 服务就绪时交给系统默认浏览器；局域网访问是独立的可选设置，开启后显示当前可用的局域网 URL。

> **危险：** 向局域网开放不提供鉴权；同一局域网内的所有人都能直接操作你的电脑。请只在完全信任的网络中谨慎开启。

## 架构

系统分为三层，全部以 Cordis 插件机制组合进同一个运行时：

| 层 | 组成 | 职责 |
| --- | --- | --- |
| 内核层 | DeepSeek Harness fork（symlink 进 workspace） | Agent 循环、模型、工具、会话、Web 服务、插件系统 |
| 桌面层 | `dsh-plugin-desktop` | Electron 壳、窗口/托盘/通知、profile 管理、恢复与安全模式、更新、LAN HTTPS、业务路由 |
| 业务层 | `.ci/dsh-*` 与 `dofe-*` 插件 | 抖音运营、招聘、销售、供方观察、内容指令、看板、FinOps、审计等企业数据源 |

内核以「固定版本 + 原生提交」的方式管理：`upstream.json` 固定 `sourceVersion`（当前 **0.1.7-rc.1**），桌面特有扩展（旧版设置门面、settings-file 兼容层、预设数据包等）以 harness fork 的原生提交落地；上游同步按「架构文件保 ours、产品内容取 theirs、品牌重放」的约定逐类解冲突，`verify:closure` 强制 319 个一等节点构成闭合运行时图。

## 仓库结构

```text
├── dsh-plugin-desktop/      桌面主包：Electron 宿主 + 客户端 + 打包脚本
├── dsh-desktop-next/        下一代壳实验场（不在 workspace 与门禁内）
├── dsh-community-market/    社区市场：产品与安全设计
├── dsh-community-fabric/    插件互操作 RFC 与调研
├── .ci/dsh-*                DoFe 业务插件源码、品牌资源与 CI 资源
├── brand/                   品牌单一来源：brand.config.json → 全部生成产物
├── docs/                    用户与开发者文档（中英双语）
├── scripts/                 品牌渲染、门禁校验、快照同步脚本
└── deepseek-harness → ../deepseek-harness   内核 fork（symlink）
```

## 快速开始

前置要求：Node.js `^22.19.0` 或 `>=24`、Corepack（pnpm 11.7.0），以及位于 `../deepseek-harness` 的内核 fork checkout（dev 分支，与 `upstream.json` 的 `sourceVersion` 一致）。

```sh
corepack pnpm install --frozen-lockfile   # 安装（内核包全部 workspace 链接）
corepack pnpm dev                         # 本地开发启动
corepack pnpm check                       # 全量门禁（BRAND=sensteed）
corepack pnpm build                       # 构建 market + 桌面主包
```

## 构建与门禁

根 `check` 固定 `BRAND=sensteed`，串联以下阶段（任一失败即红）：

| 阶段 | 内容 |
| --- | --- |
| `verify:brand` | 品牌文档围栏 + 双语哈希记录 + 旧品牌 token 配额 |
| `build` | market 构建后再构建桌面主包（tsdown + vite + tsc） |
| `typecheck` | 主包与 market 的 TS 全量类型检查 |
| `test` | 约 2000 项 vitest（含真实 Host 启动的集成用例） |
| `verify:closure` | 一等运行时闭包校验（rc.1 为 319 节点） |
| `verify:cli` | 打包后 CLI 引导运行时冒烟 |
| `verify:loader` | Loader 装配冒烟（dofe-managed 装配与托盘桩） |
| `verify:yootun-clients` | DoFe 客户端运行时校验 |
| `verify:profile` | 完整 profile 组合 + 渲染器清单冒烟 |
| `verify:licenses` | 生产依赖许可证再分发白名单 |
| `verify:operations` | 运维脚本单测 |

market 包另有独立 `check`（文档 → 构建 → 导出校验 → loader → 类型 → 274 项测试）。

## 打包产物

| 平台 | 产物 | 说明 |
| --- | --- | --- |
| macOS | Universal DMG（另支持 arm64/x64 单架构冒烟） | 未签名冒烟 + 签名发布两条路径 |
| Windows | NSIS 安装程序 + 便携版 zip | 辅助安装消息、升级冒烟、运行中检测脚本齐备 |
| Linux | AppImage / deb | x64，产物名与可执行名走品牌渲染 |

## 品牌体系

`brand/brand.config.json` 是唯一品牌来源，`generate:brand` 据此生成 `generated-product-identity.ts`、`electron-builder.json`、应用图标、托盘图标与文档品牌围栏。已退役的旧品牌名由 `brand/legacy-tokens-allowlist.json` 按文件配额管控，只减不增；产品文案全量使用 sensteed（显示名「山子 Agent」）。

## 文档

| 目标 | 入口 |
| --- | --- |
| 安装和日常使用 | [用户指南](docs/user-guide.md) |
| 快速确认平台、环境和使用边界 | [常见问题](docs/faq.md) |
| 了解桌面应用如何工作 | [架构说明](docs/architecture.md) |
| 查看全部文档与 README 分工 | [文档索引](docs/README.md) |

| 开发者目标 | 入口 |
| --- | --- |
| 编写普通或 Desktop 插件 | [插件开发](docs/plugin-development.md) |
| 了解桌面插件可以使用的能力 | [桌面插件接口说明](dsh-plugin-desktop/docs/plugin-services.zh.md) |
| 查阅包级构建与发布细节 | [`dsh-plugin-desktop/README.md`](dsh-plugin-desktop/README.md) |
| 参与统一插件 contract 讨论 | [DSH Community Fabric Draft](dsh-community-fabric/README.zh.md) |
| 查看插件市场的产品与安全设计 | [DSH Community Market](dsh-community-market/README.zh.md) |

## 与 DeepSeek Harness 的关系

上游项目提供核心的智能体能力、插件系统和 Web UI；Sensteed Agent 负责桌面应用封装、本地服务的启动与恢复、桌面窗口和系统集成、安装包构建发布，以及更适合企业内部使用的界面与业务能力。

## 致谢

感谢 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 与 DeepSeek AI 团队，以及 [Cordis](https://github.com/cordiverse/cordis)、[Koishi.js](https://koishi.chat/) 提供的插件化基础与实践经验。
