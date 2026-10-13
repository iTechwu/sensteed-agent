# desktop-linux 打包遗留待办（2026-10-05）

## 现状

- `desktop-linux` job 已完成 pnpm 化（`ac33656d50`）并补齐 electron linux-x64 校验和
  （`daae7ac`），`check:linux-package` 门禁与产品层前置构建全部通过。
- 唯一红灯在 `dist:linux`（AppImage/deb 组装）后的 `verifyPackagedRuntime`：

  ```
  unpacked runtime ... contains non-allowlisted package roots: node_modules/dsh-community-market
  ```

## 证据

- `app.asar.unpacked/node_modules/dsh-community-market` 含 4 files/426441 bytes，
  与 `@img/sharp-linux-x64` 的解包清单一字不差 —— 同一批物理文件被记到两个包根下。
- mac（连续 8 轮）/win（offset 读取修复后稳定）从未出现该根；linux 独有。
- 定性：electron-builder 写盘阶段目标地映射的平台变体 bug。win32 表现为
  node_modules 目录骨架丢全部文件（见 `sensteed-desktop-packaging-debug` 记忆与
  2026-10-04~05 的 17 轮排查），linux 表现为文件错位到错误包根。同一族，不同症状。

## 备选方向（按成本排序）

1. 给上游 electron-builder 报 issue（附 win 骨架 + linux 错位两组复现证据，
   26.15.7 与 26.17.0 均复现），等修复后升版。
2. 自维护更深补丁：在 `patches/app-builder-lib@26.17.0.patch` 中修
   `AsarPackager.processFileSets` 的 `resultsMap` 目的地映射（win/linux 两症同源）。
3. 临时放行：把 `node_modules/dsh-community-market` 加进
   `ALLOWED_SMART_UNPACK_PACKAGE_ROOTS` —— 不推荐，等于放行错位文件进产物。

## 关联

- 校验器：`dsh-plugin-desktop/scripts/verify-packaged-runtime.ts`
- 模板：`dsh-plugin-desktop/scripts/electron-builder-base.mjs`（electronDownload 校验和
  表新增平台时必须同步补条目）
- 排障手段：仓库记忆 `sensteed-desktop-packaging-debug`（本地交叉构建、traversal
  probe、asar 清单验证）
