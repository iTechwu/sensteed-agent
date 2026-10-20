# GitHub Actions 与 TOS 发布

[English](ci-tos-release.en.md)

GitHub Actions 构建并上传安装包与来源清单；Models 是唯一的桌面更新渠道权威。
管理员在 `https://ai.hozonauto.com/platform/desktop-releases` 填写版本、渠道和
安装包永久地址，服务端验证后显式发布，无需重新上传安装包。

## 触发与版本

- dev/main 普通提交执行检查；精确版本 tag 才自动构建候选包。
- main 合并 dev、更新版本并提交、打与版本完全相同的 tag（不带 v）、推送后打包。
- `workflow_dispatch` 在同一个 tagged main 上选择 candidate 或 release。
- 当前版本是 Harness sourceVersion 加 `-beta.YYYYMMDDHHmm`，例如
  `0.2.1-rc.2-beta.202610202356`。release 表示代码签名流程，不表示 stable。
- `release-contract.mjs` 校验 main、精确 tag、App/根版本、固定 Harness 提交及
  tracked 输入；发布器再次执行该检查并核对 GITHUB_SHA/UPSTREAM_SHA。
- stable 需要另行满足非预发布版本的构建合同，禁止去掉 beta 后缀改名晋级。
  历史 2.x 到 Harness 0.x 由 Models 返回手动迁移，不能当普通升级或自动降级。

## 配置归属

有效密钥源在私有部署仓库 `docker-helm.dofe.ai/apps/sensteed-agent/`。
GitHub Actions Secrets 是 CI 物化副本；禁止把密钥复制到本仓库、App 或日志。
PR 不收到上传/签名凭据。构建 Job 使用固定版本 TOS SDK，SDK 不随 App 分发。

| 配置 | 用途 |
| --- | --- |
| TOS_ACCESS_KEY_ID / TOS_SECRET_ACCESS_KEY | CI 上传权限 |
| TOS_BUCKET | 固定 dofe-public |
| TOS_REGION / TOS_ENDPOINT | 区域与原生 HTTPS 服务端点 |
| TOS_PUBLIC_BASE_URL | 桶根永久 HTTPS 地址；须与 Models 配置 origin 完全一致 |
| DESKTOP_RELEASE_MANIFEST_SIGNING_KEY_ID | 来源签名者 ID |
| DESKTOP_RELEASE_MANIFEST_SIGNING_KEY_PEM | Ed25519 PKCS8 私钥 |

Models 仅接收 `DESKTOP_RELEASE_MANIFEST_PUBLIC_KEYS_JSON` 中的公钥。
候选配置了签名者时也签来源清单，但保持安装包 unsigned，不冒充代码签名。
未配签名者的候选仍可留存，Models 不接受其发布；release 模式必须有签名者。
两项签名配置不完整或密钥错误时在上传前拒绝。私钥经 Node 标准输入处理，不放
命令参数、临时文件或输出中。可信来源签名不代替 Apple 签名和 Hub target proof。

正式 macOS release 另需 MAC_CERT_P12_BASE64、MACOS_SIGN_IDENTITY、
CSC_KEY_PASSWORD、APPLE_ID、APPLE_APP_SPECIFIC_PASSWORD、APPLE_TEAM_ID。
缺少证书时不把 release 自动降级。Windows/Linux 保持当前未签名方式并如实声明。

## 制品与提交顺序

```text
sensteed-agent/<yymmddhh>/<exact-version>-<run-id>-<attempt>/
  macos/*.dmg
  windows/*-Setup.exe
  windows/*-Portable.zip
  linux/*.AppImage
  linux/*.deb
  manifest.json
  manifest.sig.json  # 已配置来源签名者时
```

当前固定五项：darwin arm64 DMG installed；win32 x64 EXE installed 和 ZIP
portable；linux x64 AppImage portable 和 DEB installed。每个制品最大 4 GiB，
读取时流式计算 SHA-256。manifest formatVersion=2，包含 product、generation、
exact version/appVersion/tag、harnessVersion、两仓提交、run/attempt、大小、
SHA-256、永久 URL 和签名状态，不携带临时授权 URL。

五个安装包上传并校验 HEAD 大小/摘要元数据后，写入不可覆盖 manifest.json，
再写入独立 Ed25519 manifest.sig.json（签原始 UTF-8 字节）。multipart 通过
SDK GenericInput 将 x-tos-forbid-overwrite 传到创建/完成请求，防止重跑替换。
失败可能留下部分对象，缺清单/签名或校验失败时 Models 不允许发布。重跑使用
新的 attempt 目录；工作流不删除历史对象。

## Models 接入与兼容

Actions 摘要提供永久对象地址。该源目录可以是私有的；Models 通过固定 TOS
SDK 读取同批 manifest/签名及制品，按受信公钥和完整目标矩阵验证，然后 COPY
到 `yootun-agent/releases/` 下不可覆盖的发布对象并重新校验。地址不是授权，
不能用任意 URL、临时签名 URL 或 metadata 的 SHA 代替服务端字节验证。

CI 不再读写 `sensteed-agent/channels/*.json`。本仓客户端消费 Models 版本接口，
源码盘点未发现读取该 TOS 指针的客户端；历史指针保留不删除。如有外部旧消费者，
须迁移到 Models 或显式实现由 Models revision 派生的只读投影，不能恢复第二个
渠道写入者。新客户端按 os/arch/format/installationMode 获取 v2 artifactId，
下载必须校验 SHA-256；portable 不启动 NSIS，Linux 不伪称已有自动安装适配。

TOS 上传成功、Models 验证、渠道发布和客户端激活分别验收。此工作流不自动
赋予任何账号发布权限，Models 管理动作仍需 SSO 平台 superadmin。

## 本地验证

```sh
node --test scripts/ci/resolve-source.test.mjs scripts/release-contract.test.mjs
python3 -B -m unittest discover -s scripts/ci -p 'test_*.py'
corepack pnpm check:layout
```

单元测试使用内存 TOS 替身和临时合成签名者，不上传真实文件。真实平台构建、
代码签名、TOS 不覆盖响应及 Models 导入仍需对应环境验收。
