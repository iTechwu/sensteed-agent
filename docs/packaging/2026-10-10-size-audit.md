# Installer size audit — 2026-10-10

Preserve required Codex, Claude, LibreOffice and other existing tool runtimes. Remove unused installation content. These tools remain bundled; this change does not introduce on-demand downloads.

## Measured result

The measurement covers a local **unsigned arm64 DMG**, desktop `2.0.11-beta.21`, upstream `0.2.1-alpha.2`, Electron `44.0.0`. It is not a universal or signed-release measurement. See [raw evidence](2026-10-10-size-evidence.json) for bytes, installer SHA-256 and largest packages. MiB means 1,048,576 bytes.

| Content | Before MiB | After MiB |
| --- | ---: | ---: |
| DMG download | 631.43 | 560.87 |
| app.asar | 690.15 | 428.76 |
| Unpacked runtime files | 830.77 | 829.38 |
| ASAR plus unpacked runtime | 1520.93 | 1258.14 |
| Debug source maps | 208.80 | 0 |

Download size decreased **11.17%**; runtime payload decreased **17.28%**. The runtime metric excludes Electron Framework and other application resources outside ASAR. Compressed installers and expanded applications require separate measurements. Header reservation, filtering and compression mean source file sizes cannot simply be added to predict download savings.

## Implemented cleanup

1. Exclude JS, TS and CSS debug maps on every platform. Also remove maps from native packages hydrated after the builder filter. Build output still contains debug files; installers do not.
2. Keep only the product's `en-US` and `zh-CN` Electron language resources.
3. Remove approximately **81.9 MiB** of unused `react-icons` code and declarations, retaining metadata and licenses. Both artifact consumers are `dsh-better-sidebar/lib/client*.js`; selected icons are embedded and package names only occur in bundle comments. Parse artifact syntax trees: future imports, requires, dynamic imports or other real string references stop packaging and request restoring the dependency.
4. Emit `package-size-*.json` separately from the application. Inventory physical ASAR bytes, physical unpacked files, debug maps, largest packages and files. Count native content once and preserve nested dependency versions as separate locations. CI uploads reports even after failures.
5. Enforce runtime payload budgets of 1.5 GiB per architecture and 2.5 GiB for universal packages, preserving reports before failing. Reports distinguish the current stage architecture from the final delivery target: intermediate Mac universal x64/arm64 stages temporarily include both required runtime trees and use the final target budget. TOS independently rejects installer files larger than 1 GiB, matching the existing updater download limit.

## Required content retained

| arm64 runtime | MiB | Purpose |
| --- | ---: | --- |
| Codex | 274.79 | Codex subagents and code execution |
| Claude | 190.03 | Claude Code subagents |
| LibreOffice | 146.07 | Office conversion and previews |
| CUA Driver | 50.74 | Computer operation |
| uv | 37.71 | Python tool environments |
| cloudflared | 37.58 | Remote connectivity |
| sherpa-onnx | 32.51 | Speech recognition |

Codex, Claude and LibreOffice file counts and byte totals stayed unchanged through both cleanup passes. SHA-256 comparisons of all **743 non-package.json files** in the final package matched installed dependency sources. Builder-normalized package manifests were excluded from byte comparison. Existing native loading and mounted-DMG checks still execute.

Mermaid remains approximately 24.13 MiB after map removal and supports diagrams. Different Sharp/libvips versions each consume approximately 17 MiB and cannot be merged solely by name. Declarations, skill instructions, plugin configuration and licenses may be read by runtime, plugin management or user installation workflows; directory names alone do not prove that content is unused.

## Further packaging review boundaries

- **Prove unreachability before deleting.** Inspect generated client/server entries, dynamic loading, CSS/font/worker assets and plugin configuration; add artifact regressions. Lack of a source-level name reference is insufficient.
- **Keep declarations consistent with delivery closure.** Restore worktree, translator and bundle entry dependencies, check required first-party direct declarations during generation, and retain Loader and real-archive checks. Do not weaken closure checks to reduce size.
- **Filter platform prebuilds individually.** Existing rules already exclude many foreign operating-system runtimes. Residual foreign architecture/platform content in the baseline was approximately 2.5 MiB, a minor contributor requiring loading-path review. Mac universal packages require both CPU runtimes.
- **Do not silently change Mac release architecture.** Mac defaults and release builds use universal, as do the TOS publisher and update manifest. Separate CPU installers require coordinated publisher, server update response and client selection changes, outside this unused-content cleanup.
- **Calibrate budgets using platform artifacts.** This measurement covers arm64 only. Windows, Linux and Mac universal require their CI reports and installer checks. Runtime budgets and download limits are distinct.

## Related failure fixes and verification

Declare missing worktree, translator and indirect bundle dependencies after the upstream upgrade. Remove the Windows fs-ext rebuild command targeting an obsolete pnpm path; Windows uses a different lock implementation. Update Loader verification to the current webStartup injection.

Additional full-gate failures came from outdated smoke assumptions that AA 2.0.2 should remain pending or fail import, and ASAR 3 returning a stream whose bytes had not finished writing before fixture reads/repairs. Wait for stream finish and give the dual-architecture native compilation its own realistic timeout.

Knowledge failures were outdated internationalization/navigation mocks. Its 50 frontend files and 227 tests, full quality:gate, and 155 API suites with 1458 tests passed. The integration stage discovered no tests and does not demonstrate completed integration scenarios.
