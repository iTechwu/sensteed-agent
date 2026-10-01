# 启动关键路径零 pnpm 化（startup zero-pnpm）

> 结论先行：**健康 Profile 的启动全程零 pnpm 子进程**。Profile 依赖元数据失配不再阻塞启动，而是启动后离线优先地后台修复；网络敏感的安装已整体移出启动关键路径。

## 背景

官方 DeepSeek Harness 桌面 App（`apps/desktop`）的启动模型是"预解析 runtime + 启动期只校验"：Electron 主进程启动路径上没有 pnpm。本包此前的对应路径上保留了一个现场 pnpm 调用——`materializeProfile` 依赖迁移（Profile 依赖元数据失配时在启动中现场联网安装，120 秒超时）。它在负载和网络抖动下是首帧延迟与 flake 的唯一启动期来源（Host boot RPC 内本就无 pnpm）。

## 模型

```
prepareDesktopProfile（启动解析，从不依赖迁移完成）
  ├─ reconcileProfilePnpmWorkspace      纯文件读写
  ├─ classifyProfileDependencyState     纯 JS 分类，零 pnpm
  │    status: compatible | repair-required
  │    reasons: modules-metadata | lockfile-settings
  │    workspaceDrift（仅信息位，单独漂移不再触发迁移）
  └─ 闭包快校验 readDesktopProfileClosure + verifyDesktopProfileClosure
       对照 lib/profile-closure.json 逐包比对打包树版本，违规只记录不安装

main.ts
  ├─ compatible                → 直接启动（零 pnpm）
  ├─ repair-required（默认）    → 记录日志 + scheduleDesktopProfileRepair（启动后延迟、
  │                              离线优先、数据操作锁串行），启动继续
  ├─ DSH_DESKTOP_LEGACY_MIGRATION=1（回退开关）
  │                            → 旧行为：启动中现场迁移，失败即启动失败
  └─ 三方 bundle 解析失败        → Loader skippedBundles + bundleFailures 记录（对齐 AA 降级）
```

## 组成部分

| 件 | 位置 | 职责 |
|---|---|---|
| 依赖状态分类器 | `src/profile.ts` `classifyProfileDependencyState` | 纯 JS 判定漂移类别，是零 pnpm 校验的核心 |
| 钉版 store | `src/profile-store-dir.ts`、`src/pnpm-policy.ts` | 全部 Desktop 驱动的 pnpm 共用 `<DSH_HOME>/pnpm-store`，Market 下载的内容可被离线物化复用 |
| offline-first 物化器 | `src/profile-materializer.ts` | `offline: 'always' \| 'prefer' \| 'never'`（缺省 never=旧行为），prefer 离线失败自动带网重试一次，结果带 `attempt` |
| 后台修复 | `src/profile-repair.ts` | 数据操作锁串行化 + 复检 + 恢复窗 `repairDependencies` 动作（双语入口在恢复窗诊断页） |
| 闭包契约 | `scripts/generate-profile-closure.mjs` → `lib/profile-closure.json` → `src/profile-closure.ts` | 打包期冻结一方依赖 name→version 快照并随 app.asar 分发；afterPack 校验钉版一致性；启动期快校验只产出违规清单 |
| 恢复物化 | `main.ts` `afterCheckpointRestore` | checkpoint 恢复后的 frozen 安装走钉版 store + offline-prefer |
| 测试隔离 | `vitest.config.ts` | 两个真进程 Host spec 固定 `fileParallelism: false` 单 worker 串行（host 池），其余为 unit 池 |

## 不变量

1. **启动解析从不依赖迁移完成**——`prepareDesktopProfile` 的 bundle 解析在迁移判定之前完成，迁移只服务后续 pnpm 操作的元数据一致性。
2. **启动路径上的失败不再现场重装**——元数据失配进后台修复；三方 bundle 损坏降级跳过；闭包违规只取证。需要现场安装的场景只剩两类用户显式动作：Market 插件安装与恢复窗"修复依赖元数据"。
3. **`.modules.yaml` 永不伪造**——它必须由真实 pnpm 写入，打包期不可预生成；校验保留在运行期分类器中。
4. **checkpoint 快照不含 `.modules.yaml`**——恢复后由 offline-first 物化按钉版 store 重建。
5. **回退开关**——`DSH_DESKTOP_LEGACY_MIGRATION=1` 恢复启动中迁移旧语义，无需重新构建。

## Phase 2（未实施，需产品签字）

打包期把一方闭包 `pnpm store add` 进随包 resources（离线 store 种子），使修复在全新机器上也能禁网完成；体积增量需评审。
