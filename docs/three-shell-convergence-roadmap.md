# 三壳归一路线图（Three-Shell Convergence Roadmap）

> 结论先行：产品层已是壳无关的独立包（`@dofe/dsh-sensteed-product`，双壳激活契约齐备）；壳层收敛的唯一未决项是在官方壳上实测产品层装载，然后以判据驱动 Stable/Beta → Next/官方壳的流量切换。

## 一、三壳现状盘点

| 壳 | 形态 | 版本线 | 状态 |
|---|---|---|---|
| Stable/Beta（`dsh-plugin-desktop`） | 自研 Electron 壳 + Cordis 插件身份 | 2.0.x-beta / dsh 0.2.0-rc.2 | 生产；已具备零 pnpm 启动、退出闸门、强制更新策略、发布工程全套 |
| Next（`dsh-desktop-next`） | 以官方 `apps/desktop`+`apps/desktop-host` 为参照的实验壳 | 钉官方已发布 0.2.0-rc.2 | runnable；签名安装器/自动更新/数据迁移显式排除 |
| 官方 App（`../deepseek-harness/apps/desktop`） | 上游官方壳（薄壳厚容器） | 与 dsh runtime 严格同版 | 上游高频迭代；发布管线私有 |

## 二、已奠定的收敛基础

- **第 1 层（启动零 pnpm）**：健康启动全程零 pnpm 子进程，与官方「预解析 runtime + 启动期校验」模型对齐；检视/修复/闭包清单机制可直接映射到官方壳的 applyRelease 校验位。
- **第 2 层（产品层独立包）**：产品语义（SSO 准入、managed key、模型路由、审计、业务路由、client 面）全部在 `@dofe/dsh-sensteed-product`，激活只走 profile bundle 层；`scripts/verify-product-contract.mjs` 静态守约（自有行、宽 semver、bundle.patch 声明）。
- **第 3 层（闸门与策略）**：退出闸门与强制更新策略的 Host 检视/策略行在产品包内（`dofe-product-quit-inspection`、`dofe-product-update-policy`），壳侧只保留窗口呈现与 RPC 桥——与官方壳的 quit-inspection/mandatory-update 分工同构。

## 三、收敛路径（三阶段）

### 阶段 A：Next 补齐（当前焦点）

Next 需补四项才具备接流量资格（均为官方 apps/desktop 已验证的机制移植）：

1. 签名安装器与公证（复用 dsh-plugin-desktop 的 mac 证书链 / win NSIS A/B 方法论）。
2. 自动更新（官方 update-coordinator 移植：用户授权 + 任务检视退出闸门已在第 3 层壳侧就绪）。
3. Stable/Beta 数据迁移（home 目录 `.sensteed-agent(-beta)` → Next home；profile/凭据/checkpoint 语义保持）。
4. 产品层在官方壳实测（见阶段 B 清单）。

### 阶段 B：产品层官方壳实测（第 2 层遗留验收）

1. `dsh plugin --profile desktop add @dofe/dsh-sensteed-product`（或预置进 runtime OPTIONAL_BUNDLES）后整层激活。
2. 已知差异逐项验证：install 锚点恒优先（官方 runtime 不得预置同名包）；bundle 级 peer 检查不满足即静默 skip（宽 semver 已备，需实测）；无安装层补丁（finance/supplier-intelligence/soup 三行需以 profile bundle 或 runtime OPTIONAL_BUNDLES 供行）。
3. SSO 登录、模型路由、审计上行、退出闸门、强制更新在官方壳端到端走通。
4. 契约自检 `verify-product-contract` 作为阶段 B 的静态准入。

### 阶段 C：切流与冻结

- 判据（全部满足才切）：阶段 B 全绿 + Next 自动更新灰度无事故 + 数据迁移演练通过 + 支持面（诊断/恢复/日志）对齐。
- 切换：Next 转正为新 Stable；`dsh-plugin-desktop` 壳层冻结（仅安全修复），产品迭代全部发生在产品包与官方壳。
- 回滚：双通道并存期内品牌开关可回指旧壳；产品包两壳契约保证回装零迁移。

## 四、延展项挂账（显式不做，防范围歧义）

- Phase 2 离线 store 种子（第 1 层遗留，需产品签字体积增量）。
- 全屏 blocking 更新窗（第 3 层以单飞原生对话框交付；全屏窗复用 setup-wizard 窗口族，列 Layer 3.5）。
- admission lock 503 中间件与 community-market install 路由拦截（Layer 3.5；第 3 层以 inspect-only 闸 + 策略短路覆盖用户可见目标）。
- Host 检视线协议与 `dsh-desktop-next/src/host-process.ts` 已对齐（quitInspection/updateTasks 形状），Layer 5 收敛时 Host 侧应答可平移。

## 五、风险登记（摘）

| 风险 | 等级 | 缓解 |
|---|---|---|
| 官方壳 bundle 级 peer 检查静默 skip 产品层 | 阻塞（阶段 B） | 宽 semver + 契约自检 + 实测清单 |
| install 锚点遮蔽 profile 副本 | 中 | 官方 runtime 不预置同名包；文档化 |
| 双轮询同端点（desktop-updates 与策略行） | 低 | 6h 频率可接受；roadmap 注明可合并 |
| Stable/Beta 数据迁移丢凭据/会话 | 高（阶段 A） | checkpoint 语义保持 + 演练准出 |
