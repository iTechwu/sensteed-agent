# Sensteed Agent repository rules

This repository owns the desktop product around an unmodified DeepSeek Harness checkout.

## Workflow contract

- After every modification to this repository, commit the change (每次修改之后进行 commit). Keep each change in a small, reviewable commit.
- Write commit messages in Chinese (提交信息一律使用中文), using Conventional Commits style (`feat:` / `fix:` / `refactor:` / `docs:` / `test:` / `chore:`); the body describes what the change actually does.
- After committing, push to `origin` (所有提交和 push 均到 origin, per the repository owner's standing instruction).
- Verify with the relevant gate (`pnpm check` / `pnpm check:layout` / package typecheck/build) before a change is considered complete.

## Prerequisites and setup

- Use Node.js `^22.19.0` or `>=24.0.0` and the root pnpm `11.7.0` release through Corepack.
- The DeepSeek Harness source is the user's fork at `../deepseek-harness` (branch `dev`), exposed in this repository through the `deepseek-harness` symlink. Ensure that checkout exists and its root version matches `sourceVersion` in `upstream.json` before running operations.
- Install the combined root/sibling workspace with `corepack pnpm install --frozen-lockfile`.

## Build, run, and verify

- Start the desktop development workflow with `corepack pnpm dev`.
- Build the desktop package with `corepack pnpm build`.
- Run unit tests with `corepack pnpm test`.
- Run type checking with `corepack pnpm typecheck`.
- Run the complete headless gate with `corepack pnpm check`.
- Run upstream operations through the root scripts, such as `corepack pnpm upstream:build`. Desktop-owned behaviors are native fork commits on the sibling `dev` branch; `dsh-plugin-desktop/tests` assert those behaviors directly against the fork's sources and built `lib/` output. There is no patch application step.

- `../deepseek-harness/` is the user's own DeepSeek Harness fork (a sibling checkout, not vendored). Local-use behaviors land as ordinary fork commits on `dev`; the desktop repository never edits the fork from a desktop feature branch.
- `dsh-plugin-desktop/` owns the Cordis Host and Client faces, Electron bootstrap, packaging, and release tests.
- `dsh-desktop-next/` owns the separate experimental Desktop shell, Profiles and recovery, and adapters for the existing AA bridge and Community Market. Next-only changes do not belong in the Stable/Beta variant mirror. Keep its upstream reference and published runtime versions aligned; do not fork the official main frontend.
- `dsh-community-fabric/` owns the community interoperability RFC. Until schemas and a reviewed reference adapter exist, it remains a private documentation scaffold and must not declare loadable DSH or package entry points.
- `dsh-community-market/` owns the community-market shell. Until its runtime is implemented, it remains a private documentation scaffold and must not declare loadable DSH or package entry points.
- The outer repository and all owned packages use the root pnpm release with `nodeLinker: node-modules`.
- The upstream sibling checkout keeps its own pnpm workspace. Run upstream commands through the root `upstream:*` scripts, whose pnpm portable-shell commands `cd ../deepseek-harness` before invoking Corepack.
- Compatibility mode must run the upstream default client without overrides. Advanced presentation belongs to desktop-owned client plugins and may replace documented slots or services through profile composition.
- Keep graphical application launch explicit. Builds, typechecks, unit tests, and Loader smokes must remain headless-safe.
- Commit before major changes of direction; keep a fork `sourceVersion` bump separate from desktop behavior changes.
- Keep the repository topology and direct sibling workspace boundary consistent with the [owning Agent Note](.agents/notes/implemented/process/2026-08-31-sibling-fork-direct-workspace.md).

## 打包版本号与发布流程 (Packaging versioning and release flow)

- 每次发起打包（`dist:mac`、`dist:mac-smoke`、`dist:win`、`dist:win-portable`、`dist:linux`、`package:dir`）走 main 分支发布流程：先将 `dev` 合并到 `main`，在 `main` 上先打 tag，再推进对 `main` 的打包。
- 版本号与 tag 一致：以 DeepSeek Harness 的 release 版本为基准（与 `upstream.json` 的 `sourceVersion` 一致），追加 `-beta.` 与打包发起时刻的时间戳，时间戳格式为 `YYYYMMDDHHmm`（如 `202610120940`）。
- 示例：DeepSeek release 为 `0.2.1-alpha.2`、2026-10-12 09:40 发起打包 → tag 与 `dsh-plugin-desktop/package.json` 的 `version` 均为 `0.2.1-alpha.2-beta.202610120940`。
- 顺序：合并 `dev` → `main`；在 `main` 上更新 `version` 字段（electron-builder 以 `${version}` 生成产物文件名）并提交；打 tag（名称与 `version` 完全一致）；push `main` 与 tag 到 `origin`；再对 `main` 发起打包。
- 可执行入口：`corepack pnpm release:prepare` 预览，`corepack pnpm release:prepare --execute` 从干净且已 push 的 dev 执行上述流程；`release-source.json` 将本次 Harness commit 固定到版本提交。CI 的普通 dev/main push 只跑检查，精确版本 tag 自动产出未签名候选包；在同一 tagged main 上手动选择 `release` 才走签名发布。所有打包入口由 `release:verify` 同源门禁拦截未打 tag 或版本漂移的源码。
- 内置内容先在 dev 刷新并提交；所有 tagged 打包仅离线校验，不得在 tag 后重新联网刷新。首次由历史 2.x 桌面编号迁移到 Harness 0.x 编号需手动安装，正常 SemVer 比较不把降级当作自动更新。
- 签名发布路径只做离线校验，发布内容必须等于 tag 指向的提交内容。

## 内置 Skills 与 Plugins (Built-in skills and plugins)

- `bundled.json`（仓库根，与 `upstream.json` 同级）是内置内容的机器可读清单：`skills[]` 记录每个 skill 的来源（`source: "sibling"` 指向 `../docker-helm.dofe.ai/skills/<name>` 的 vendored 源，缺省 `"github"` 直连仓库拉取）与已提交快照目录；`plugins[]` 记录预装插件（sibling 唯一源）及其 `.ci` 快照，GitHub 源插件额外带 `upstream`/`siblingDir`。
- Skills 快照提交在 `dsh-plugin-desktop/bundled/skills/`（含派生清单 `bundled/manifest.json`），只能由刷新脚本产出：`corepack pnpm bundled:refresh`（sibling 源本地拷贝、GitHub 源联网拉最新）或 `corepack pnpm bundled:verify`（离线校验）。刷新是全成全不成：任一 skill 取源失败（GitHub 拉取失败或 sibling 检出缺失）则整轮不落盘，绝不截短已提交快照。sibling skill 的 `resolvedSha` 是 vendored 基准，刷新不自动改写；上游更新走 docker-helm 仓 `scripts/update-sensteed-skills.sh` 后同步本清单。
- 每个打包入口（`dist:mac`、`dist:mac-smoke`、`dist:win`、`dist:win-portable`、`dist:linux`、`package:dir`）在 check 门之前离线校验内置内容——发布内容永远等于 tag 提交内容。CI 五处物化点之后以 `--offline` 校验，技能更新通过开发机在 dev 刷新后提交完成。
- Sibling 边界：插件唯一源仍是 `../docker-helm.dofe.ai/plugins`。GitHub 源插件（当前为 `dsh-soup`）由刷新脚本自动回写 sibling，再用 `scripts/sync-dofe-plugin-snapshot.mjs --write <name>` 重同步 `.ci` 快照；sibling 脏树时跳过回写（`--force` 例外）。sibling 仓库的改动在其自身仓库提交，本仓库不代提交。
- 运行时挂载：宿主进程通过 `DSH_BUNDLED_SKILL_DIR`（见 `src/bundled-skill-root.ts`）把 `bundled/skills` 挂为 harness 的 'bundled' provider 根；打包冒烟断言清单中每个 skill 可发现。
- 新增条目：skill = 在 `../docker-helm.dofe.ai/skills/<name>/` vendored 上游源 + 在 `bundled.json` 追加一条（`source: "sibling"` + `siblingDir` + vendored 基准 `resolvedSha`）+ `bundled:refresh` + 提交快照；plugin = sibling 建包 + 桌面包 `file:` 依赖 + `cordis.patch.yml` insert + 快照同步 + 清单记录（`tests/bundled-manifest.spec.ts` 强制一致性）。
