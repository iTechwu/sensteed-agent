<p align="center">
  <img src="assets/desktop-hero-en.png" alt="Sensteed Agent, an enterprise AI desktop workbench built on DeepSeek Harness" width="100%">
</p>

<!-- brand:brand-title:start -->
Sensteed Agent<!-- brand:brand-title:end -->

<p align="center">
  <strong>The enterprise AI desktop workbench of Shandzi High-Tech — built on DeepSeek Harness, for Windows and macOS.</strong>
</p>

<!-- brand:download-cta:start -->
<h3 align="center"><a href="http://10.30.30.212/wumin1/sensteed-agent/-/releases">Installer artifacts are published on GitLab Releases.</a></h3><!-- brand:download-cta:end -->

<p align="center">
  Everything is a plugin — the desktop itself is a plugin.
</p>

<p align="center">
  <img src="assets/desktop-chat-en.png" alt="Sensteed Agent chat interface" width="100%">
</p>

## Project positioning

Sensteed Agent puts the local Web UI, Host services, and plugin system of DeepSeek Harness inside one native desktop application: it starts and manages the local kernel services automatically and integrates the tray, desktop windows, terminal, notifications, updates, and workspace configuration — no Node.js or command line required.

| Perspective | Description |
| --- | --- |
| For users | A ready-to-use AI workbench: chat, agent tasks, plugin capabilities, dashboards, and operations tooling all live in the desktop. |
| For the enterprise | The internal AI workbench of Shandzi High-Tech. Login requires Feishu SSO; models and built-in capabilities are provisioned by enterprise entitlements, and operations are recorded by the audit service and synced to Models. |
| For developers | A fork-based desktop distribution: the pinned upstream kernel runs unmodified, while the desktop shell and every business capability compose as plugins — pluggable and evolvable. |

## Core capabilities

| Capability | Description |
| --- | --- |
| Native desktop shell | compatibility / extended / advanced window modes, system tray, native menus, notifications, macOS materials and Mica effects. |
| DoFe access (Feishu login required) | First use requires Feishu SSO binding; tenant verification, entitlement groups, protocol and default model selection, and built-in capability switches all live in "User settings". The manual credential mode cannot bypass login. |
| Business plugin suite | Douyin operations, recruiting, sales, supply watch, content command, dashboards, FinOps, audit, and knowledge-capture DoFe data sources, managed end-to-end by `dofe-managed` (credentials + MCP transport). |
| Audit and operations | Operation-audit events are staged locally (outbox) and synced to Models by configuration; finance and operations dashboards are built into the desktop. |
| Plugin market | DSH Community Market built in: plugin discovery, details, install, and management with open data-source onboarding. |
| Recovery and safe mode | Startup checkpoints, one-click rollback, automatic recovery assistant on failure; Safe Mode boots with shipped defaults for troubleshooting. |
| Browser and LAN access | Loopback only by default; optionally hand off to the system browser or open the LAN (with a connection fence and LAN HTTPS). |
| System proxy inheritance | Node-side egress inherits the system proxy; the outbound policy installs at boot and the startup report states the resolved route. |
| Phone remote | Connect to the desktop Agent from a phone via Agents Anywhere to start tasks and follow progress. |
| Update channels | stable / beta channels; pinned-version checks and artifact downloads are separate requests with version and channel metadata headers. |

### First-run setup, browser access, and LAN exposure

Every uninitialized profile shows the desktop's own Setup Wizard on first launch: window mode and system materials, plugin market, notifications, whether to auto-open the system browser, and the Web exposure scope; it can be skipped. The Host and the main window do not start until the wizard finishes or is skipped.

The web service listens on loopback only by default. With "open in browser" enabled, the desktop hands the URL to the system browser once the web service is ready; LAN exposure is a separate opt-in setting that shows the currently available LAN URLs.

> **Danger:** LAN exposure provides no authentication; anyone on the same network can operate your machine. Only enable it on fully trusted networks.

## Architecture

The system has three layers, all composed into one runtime through the Cordis plugin mechanism:

| Layer | Composition | Responsibility |
| --- | --- | --- |
| Kernel | DeepSeek Harness fork (symlinked into the workspace) | Agent loop, models, tools, sessions, web services, plugin system |
| Desktop | `dsh-plugin-desktop` | Electron shell, window/tray/notifications, profile management, recovery and safe mode, updates, LAN HTTPS, business routes |
| Business | `.ci/dsh-*` and `dofe-*` plugins | Douyin operations, recruiting, sales, supply watch, content command, dashboards, FinOps, audit, and other enterprise data sources |

The kernel is managed as "pinned version + native commits": `upstream.json` pins `sourceVersion` (currently **0.1.7-rc.1**), desktop extensions (legacy settings facade, settings-file compat layer, preset data package) land as native fork commits, and upstream syncs resolve conflicts per the established convention (architecture files keep ours, product content takes theirs, brand replayed). `verify:closure` enforces a closed runtime graph of 319 first-party nodes.

## Repository layout

```text
├── dsh-plugin-desktop/      Main desktop package: Electron host + client + packaging scripts
├── dsh-desktop-next/        Next-shell experiment (outside the workspace and gates)
├── dsh-community-market/    Community market: product and safety design
├── dsh-community-fabric/    Plugin interop RFC and research
├── .ci/dsh-*                DoFe business plugin sources, brand assets, and CI resources
├── brand/                   Single brand source: brand.config.json → all generated artifacts
├── docs/                    User and developer documentation (bilingual)
├── scripts/                 Brand rendering, gate verification, and snapshot-sync scripts
└── deepseek-harness → ../deepseek-harness   Kernel fork (symlink)
```

## Quick start

Prerequisites: Node.js `^22.19.0` or `>=24`, Corepack (pnpm 11.7.0), and a checkout of the kernel fork at `../deepseek-harness` (dev branch, matching the `sourceVersion` in `upstream.json`).

```sh
corepack pnpm install --frozen-lockfile   # install (kernel packages all workspace-linked)
corepack pnpm dev                         # local development
corepack pnpm check                       # full gates (BRAND=sensteed)
corepack pnpm build                       # build market + desktop package
```

## Build and gates

The root `check` pins `BRAND=sensteed` and chains the following stages (any failure turns red):

| Stage | Content |
| --- | --- |
| `verify:brand` | Brand doc fences + bilingual hash records + legacy token quotas |
| `build` | Market build, then the desktop package (tsdown + vite + three tsconfigs) |
| `typecheck` | Full TS type checking for the main package and market |
| `test` | ~2000 vitest cases (including integration cases that boot a real Host) |
| `verify:closure` | First-party runtime closure check (319 nodes on rc.1) |
| `verify:cli` | Packaged CLI bootstrap runtime smoke |
| `verify:loader` | Loader assembly smoke (dofe-managed wiring and tray stubs) |
| `verify:yootun-clients` | DoFe client runtime verification |
| `verify:profile` | Full profile composition + renderer manifest smoke |
| `verify:licenses` | Redistribution allowlist for production dependency licenses |
| `verify:operations` | Unit tests for operations scripts |

The market package runs its own `check` (docs → build → export verification → loader → types → 274 tests).

## Packaging artifacts

| Platform | Artifact | Notes |
| --- | --- | --- |
| macOS | Universal DMG (plus arm64/x64 single-arch smokes) | unsigned smoke and signed release paths |
| Windows | NSIS installer + portable zip | assisted installer messages, upgrade smoke, and running-check scripts included |
| Linux | AppImage / deb | x64; artifact and executable names follow the brand rendering |

## Brand system

`brand/brand.config.json` is the single brand source; `generate:brand` renders `generated-product-identity.ts`, `electron-builder.json`, app icons, tray icons, and the document brand fences. Retired brand names are governed per-file by `brand/legacy-tokens-allowlist.json` and may only shrink; product copy is fully sensteed (display name 山子 Agent).

## Documentation

| Goal | Entry point |
| --- | --- |
| Install and daily use | [User guide](docs/user-guide.en.md) |
| Platform, environment, and usage boundaries | [FAQ](docs/faq.en.md) |
| How the desktop works | [Architecture](docs/architecture.en.md) |
| All documents and README roles | [Docs index](docs/README.md) |

| Developer goal | Entry point |
| --- | --- |
| Build ordinary or Desktop plugins | [Plugin development](docs/plugin-development.en.md) |
| What Desktop plugins can use | [Desktop plugin API](dsh-plugin-desktop/docs/plugin-services.md) |
| Package-level build and release details | [`dsh-plugin-desktop/README.md`](dsh-plugin-desktop/README.md) |
| Unified plugin-contract discussion | [DSH Community Fabric Draft](dsh-community-fabric/README.md) |
| Plugin market product and safety design | [DSH Community Market](dsh-community-market/README.md) |

## Relationship to DeepSeek Harness

The upstream project provides the core agent capabilities, plugin system, and web UI; Sensteed Agent owns the desktop application packaging, local service startup and recovery, desktop window and system integration, installer builds, and the interface and business capabilities tailored for internal enterprise use.

## Acknowledgements

Thanks to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and the DeepSeek AI team, and to [Cordis](https://github.com/cordiverse/cordis) and [Koishi.js](https://koishi.chat/) for the pluginization foundations and practices.
