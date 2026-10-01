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
