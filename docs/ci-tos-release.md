# GitHub Actions 与 TOS 发布

[English](ci-tos-release.en.md)

GitHub Actions 构建安装包，`dofe-public` 保存最终产物。GitHub Artifacts 仅作为各平台与发布任务之间的中转，保留一天。PR 不读取 TOS 密钥，也不向 TOS 上传。

## 触发方式

- `dev`、`master` 的产品变更：构建并上传候选包，不修改渠道索引。
- Actions → CI → Run workflow：`publish_kind=candidate` 上传候选包；`release` 从 `dev` 或 `master` 发布正式版本。
- 推送 `v<package.json版本>` 标签：正式发布，标签必须与根包版本完全一致。
- 文档变更跳过产品构建；手动运行和版本标签始终执行产品检查。

正式发布支持 `X.Y.Z`（stable）和 `X.Y.Z-beta.N`（beta）。macOS 必须完成 Developer ID 签名、公证及现有安装包验证。Windows 和 Linux 延用当前未签名打包方式；清单明确记录签名状态。缺少 Apple 凭证时使用候选模式，不会自动降级正式发布。

## GitHub 配置

仓库 Settings → Secrets and variables → Actions：

| 名称 | 类型 | 内容 |
| --- | --- | --- |
| `TOS_ACCESS_KEY_ID` | Secret | TOS Access Key |
| `TOS_SECRET_ACCESS_KEY` | Secret | TOS Secret Key |
| `TOS_BUCKET` | Variable 或 Secret | `dofe-public`，未填写时使用此值 |
| `TOS_REGION` | Variable 或 Secret | 桶所属地域 |
| `TOS_ENDPOINT` | Variable 或 Secret | TOS 公网服务端点，支持主机名或 HTTPS URL，不含桶名路径 |
| `TOS_PUBLIC_BASE_URL` | Variable 或 Secret | 指向桶根目录的 HTTPS 下载域名，不含临时签名参数 |

非敏感配置优先读取 Variables，兼容已存入 Secrets 的配置。GitHub 可能遮蔽存于 Secrets 的下载域名，导致日志或摘要链接不完整；需要可点击链接时将该配置迁移至 Variables。凭证仅传入配置预检和上传步骤。CI 通过固定版本的官方 Python TOS SDK 分片上传并启用 CRC 校验，不向 App 打包 SDK 或上传凭证。

正式 macOS 发布另需六项 Secrets：`MAC_CERT_P12_BASE64`、`MACOS_SIGN_IDENTITY`、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。证书必须是带私钥的 Developer ID Application P12；Apple 密码是 App 专用密码。

上传账号需要目标目录的对象写入、读取/HEAD 和分片上传权限，正式发布还需读写渠道索引。工作流不修改桶 ACL、公开访问策略、CORS 或 CDN 配置；下载域名应已能公开读取发布目录。

## 产物与发布顺序

```text
sensteed-agent/candidates/<desktop-sha>/<run-id>-<attempt>/
sensteed-agent/releases/<beta|stable>/<version>/<run-id>-<attempt>/
sensteed-agent/channels/<beta|stable>.json
```

每个目录包含 `macos/` 下的 universal DMG、`windows/` 下的 x64 Setup EXE 和 Portable ZIP、`linux/` 下的 x64 AppImage 和 DEB，以及 `manifest.json`。清单包含文件大小、SHA-256、下载 URL、签名状态、桌面提交、Harness 提交、运行编号和重试编号。

流程开始时只解析一次 `upstream.json` 所声明分支的提交，各平台下载同一 SHA 并核对 `sourceVersion`。产品检查、三个平台打包检查和 Windows 兄弟仓库检查全部通过后，才允许发布。

上传顺序为五个安装包 → 校验远端大小和 SHA-256 元数据 → 写入版本清单 → 更新正式渠道索引。安装包启用长缓存，渠道索引使用 `no-store`。正式版本必须高于当前渠道版本；条件写入防止并发发布覆盖。候选包永不写渠道索引。失败可能遗留部分对象，但不会发布不完整版本；在 Actions 重试失败任务会使用新的 attempt 目录。

同渠道的发布任务串行执行。GitHub 并发组可能替换尚未开始的排队任务，因此中间候选版本不保证全部上传；需要某一版本时手动重跑。历史版本保留，工作流不自动删除 TOS 对象。

## 下载与客户端更新

发布成功后在 Actions 运行摘要查看安装包和清单。GitHub Secrets 不可读回，本地只能检查配置名称；首次实际上传由 Actions 验证账号权限、地域、网络及端点。

TOS 渠道清单是发布输出，并非现有客户端版本 API 的替代接口。本次不变更线上更新服务或客户端下载白名单。要接入 App 内更新，需要更新服务读取清单、按目标版本提供下载及 SHA-256；若重定向到 TOS/CDN，新客户端还需允许精确下载域名。旧客户端可通过原受信任域名代理下载，不能直接重定向到未允许域名。

渠道拒绝同版本和降级发布。发现坏版本时保留旧包，发布更高版本的修复包；紧急切换线上服务属于单独的发布运维操作。

## 本地验证

```sh
node --test scripts/ci/resolve-source.test.mjs
python3 -B -m unittest discover -s scripts/ci -p 'test_*.py'
corepack pnpm check:layout
```

单元测试使用内存 TOS 替身，不上传真实文件。完整平台构建、签名公证和 TOS 上传由对应 GitHub runner 执行。
