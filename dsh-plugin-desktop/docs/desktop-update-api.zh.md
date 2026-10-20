# 桌面版本服务契约（Sensteed-Agent）

> 服务端：`https://ai.hozonauto.com/api/desktop/version`（GET）。本文是桌面端消费的完整契约；服务端扩展 `mandatory` 字段即可启用强制更新，缺席则客户端零行为变化。

## 请求

| 头 | 值 |
|---|---|
| `Accept` | `application/json` |
| `X-Sensteed-Agent-Version` | 当前桌面版本（严格 SemVer） |
| `X-Sensteed-Agent-Channel` | `stable` / `beta` / `next` |
| `X-Sensteed-Agent-Installation-Id` | 安装级随机标识（可选） |

不带业务登录凭据；响应体上限 4KB。

## 响应（既有字段）

```jsonc
{
  "version": "2.1.0",                     // 必填，严格 SemVer（通道 prerelease 规则见 update-checker）
  "channel": "stable",                    // 可选
  "sha256": { "windows": "<hex64>", "mac": "<hex64>" }  // 可选，安装器摘要硬门
}
```

## 响应扩展：`mandatory`（强制更新，可选）

```jsonc
{
  "version": "2.1.0",
  "mandatory": {
    "minVersion": "2.1.0",                // 必填，严格 SemVer；低于此版本即进入策略相位
    "deadline": "2026-10-15T00:00:00Z",   // 可选，ISO 8601；过后由 notice 升级为 blocking
    "notice": {                           // 可选文案
      "title": "≤256 字符",
      "detail": "≤16384 字符",
      "zh": "≤512 字符", "en": "≤512 字符"
    }
  }
}
```

## 客户端语义（@dofe/dsh-sensteed-product/desktop-mandatory-policy）

| 条件 | 相位 | 行为 |
|---|---|---|
| 无 `mandatory` 字段，或当前版本 ≥ `minVersion` | `none` | 零行为变化；并清除既有策略 |
| 当前版本 < `minVersion` 且未过 `deadline`（或无 deadline） | `notice` | 系统通知 + 托盘项 + 五条 profile/plugin 变更路径 503 |
| 当前版本 < `minVersion` 且已过 `deadline` | `blocking` | 同上 + 30 分钟冷却的阻塞对话框（「立即下载更新」走既有下载链） |

- **解析即校验**：`minVersion` 非严格 SemVer、`deadline` 非 ISO、notice 任一字段越界 → 整条 directive 视为不存在。
- **保留语义**（移植自上游 mandatory-update-policy）：轮询失败或响应不可解析时**保留既有相位**；只有一次合法的「无 mandatory」响应才解除。
- **当前版本不可解析**：fail-closed，按低于下限处理。
- **轮询**：启动后 60s 首查、每 6h 一次；失败指数退避（封顶 30min）；并发合流。
- **退出不受阻**：任何相位都允许退出；下次启动重现同相位（快照持久化于 `<userData>/updates/mandatory-policy-state.json`）。
- **总闸**：`DSH_DESKTOP_QUIT_GATE=0` 关闭退出闸门；未打包（dev）不启用策略轮询。

## 服务端接入步骤

1. 版本服务在响应体加 `mandatory` 对象（可按 channel/安装 ID 灰度下发）。
2. 观察桌面端通知与托盘（notice 相位）确认触达。
3. 到达 `deadline` 后客户端自动进入 blocking；紧急阻断无需发版，把 `minVersion` 提到目标版本即可。
4. 回滚：去掉 `mandatory` 字段（一次合法响应即清除）。

## 常规更新体验与故障恢复

- 打包应用启动 60 秒后检查，此后每次检查结束 6 小时后再次检查；单次版本请求最长 15 秒。开发模式不自动轮询。
- 后台只提示新版本，不自动下载、安装或重启；同一版本的通知记录会持久化，支持带 Harness 前缀的 Beta 时间戳版本。
- 设置页调用已认证的同源 `POST /api/desktop/updates/check`，请求体 `{ "inspect": true }`，直接显示检查结果。这个请求不会打开原生对话框或触发安装包下载，也不允许指定渠道或版本。
- 检测响应包含 `status`、`channel`、`checkedAt`，成功时带 `latestVersion`，失败时带 `failure`。状态不持久化到浏览器，关闭设置再打开时重新检查。
- 只有发现新版才显示“下载并安装”。用户点击后进入原生确认、选择位置和平台安装流程；下载前再次验证版本，避免检查后服务端发布指针变化。取消操作保留当前应用。
- 托盘与标题栏继续使用原生交互入口。设置页的检测结果使用 live region，错误带恢复建议；检查期间禁用操作，防止重复请求。

| failure | 用户反馈与恢复方式 |
|---|---|
| `unpublished` | 此渠道尚未发布，当前版本可继续使用；不视为网络故障，不跨渠道回退 |
| `network` | 检查网络或代理后重试 |
| `timeout` | 请求超时，稍后重试或检查代理 |
| `service` | 服务不可用，稍后重试；持续失败时导出诊断 |
| `invalid-response` | 版本数据无效或渠道不匹配，联系管理员核查发布数据 |
| `invalid-version` | 安装版本不属于当前渠道，获取正确安装包 |

## 下载与发布边界

版本发现和下载由同一个品牌服务承接：相对于版本端点解析 `downloads/mac` 与 `downloads/windows`。固定服务请求携带品牌协议头，并兼容已部署服务的历史渠道头和目标版本头；安装 ID 仍仅用于版本发现。

下载需要严格匹配确认的版本；服务发布的 SHA-256 必须完整穿过 Host/Main 进程桥接，再由平台下载器校验。任一重定向必须使用不带 URL 凭据的 HTTPS 地址，最多 8 跳；安装包结构、版本固定和已提供摘要校验通过后才交给系统。网络、磁盘或安装器打开失败会通知用户从“版本与更新”重试；取消和应用退出不弹失败通知。

发布标签、CI 候选包产出与更新服务的渠道发布指针是独立环节。标签成功不代表版本已对客户端发布；管理员还需在发布服务中上传并验证对应平台制品，再将正确版本发布到对应渠道。空渠道应返回 HTTP 404 与 `{ "error": { "code": "CHANNEL_NOT_PUBLISHED" } }`。不能用“已是最新”掩盖空渠道，也不能在客户端自动回退到其他渠道。

当前服务仅接受 stable/beta；Next 使用独立实验壳，其渠道需要服务端先提供明确支持。保持现有 SemVer 比较规则，历史 2.x 到 Harness 0.x 的迁移仍要求手动安装；常规检查不自动降级。

## 本次验证范围

使用 headless 单元测试覆盖协议失败分类、通知记录、进程间摘要传递、设置页重试与确认下载、下载重定向；在 320/768/1024/1440 宽度验证未发布、网络异常、最新版本和发现新版四种状态。真实平台安装、生产渠道发布和用户可用性研究需要另行执行；界面测试不能替代这些验证。
