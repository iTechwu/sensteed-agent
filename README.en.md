<p align="center">
  <a href="https://dshdesktop.cn"><img src="assets/desktop-hero-en.png" alt="Sensteed Agent, an open-source desktop client built on DeepSeek Harness" width="100%"></a>
</p>

<!-- brand:brand-title:start -->
Sensteed Agent<!-- brand:brand-title:end -->

<p align="center">
  <strong>An open-source desktop client for Windows and macOS, built on DeepSeek Harness.</strong>
</p>

<!-- brand:download-cta:start -->
<h3 align="center"><a href="https://dshdesktop.cn">One-click download, ready to use out of the box.</a></h3><!-- brand:download-cta:end -->

<p align="center">
  Everything is a plugin — the desktop itself is a plugin.
</p>

<p align="center"><sub>An independent community project, not affiliated with, authorized by, or endorsed by DeepSeek.<br>No DeepSeek employee or official upstream DeepSeek Harness team member currently participates in this repository; upstream contributors shown by GitHub are inherited from synchronized fork history.<br><a href="README.md">中文</a> · English</sub></p>

<p align="center">
  <img src="assets/desktop-chat-en.png" alt="Sensteed Agent chat interface in English" width="100%">
</p>

<p align="center">
  <a href="https://github.com/anywhere-labs/deepseek-harness-desktop/releases/latest"><img src="https://img.shields.io/github/v/release/anywhere-labs/deepseek-harness-desktop?style=flat&amp;label=release&amp;color=4D6BFE" alt="Latest release"></a>
  <a href="https://github.com/anywhere-labs/deepseek-harness-desktop/releases"><img src="https://img.shields.io/github/downloads/anywhere-labs/deepseek-harness-desktop/total?style=flat&amp;label=downloads&amp;color=4D6BFE" alt="Total downloads"></a>
  <a href="https://github.com/anywhere-labs/deepseek-harness-desktop"><img src="https://img.shields.io/github/stars/anywhere-labs/deepseek-harness-desktop?style=flat&amp;label=%E2%98%85&amp;color=08C" alt="GitHub stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2EA44F?style=flat" alt="MIT License"></a>
  <a href="https://discord.gg/TJeGqKRNM"><img src="https://img.shields.io/badge/Discord-5865F2?style=flat&amp;logo=discord&amp;logoColor=white" alt="Join Discord"></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows-4493F8?style=flat-square" alt="Supported platforms: macOS and Windows">
</p>

Sensteed Agent integrates the local Web UI, Host service, and plugin system from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) into a native desktop application. It runs a pinned upstream version unchanged, while Sensteed Agent provides the window, tray, terminal, updates, and work profiles through the plugin mechanism provided by DeepSeek Harness.

<a id="run"></a>

## Download and install

Current release installers support Windows x64 and macOS Universal. No extra environment is needed — download, install, and start using it with one click.

<!-- brand:download-table:start -->
| Platform | Download | Installation |
| --- | --- | --- |
| Windows x64 | [Download installer](https://www.dshdesktop.cn/api/downloads/windows) | Run the NSIS installer and follow its prompts |
| macOS Universal | [Download DMG](https://www.dshdesktop.cn/api/downloads/mac) | Open the DMG and drag Sensteed Agent into Applications |<!-- brand:download-table:end -->

See the [user guide](docs/user-guide.en.md) and [FAQ](docs/faq.en.md) for plugin commands, platform details, and troubleshooting.

Together with every plugin author, we want to build an open, composable, and sustainable DSH plugin ecosystem where plugins grow alongside each other. Read the [DSH plugin ecosystem manifesto](docs/plugin-ecosystem.en.md).

<details open>
<summary>❤️ Sponsors</summary>

| Logo | Introduction |
| --- | --- |
| <a href="https://dshdesktop.cn/sponsors/wuying"><img src="assets/sponsors/wuying-cloud-computer-logo.png" alt="Alibaba Cloud Wuying Cloud Computer" width="96"></a> | [**Alibaba Cloud · Wuying Cloud Computer**](https://dshdesktop.cn/sponsors/wuying)<br>Thanks to **Alibaba Cloud** Wuying Cloud Computer for sponsoring this project. Wuying Cloud Computer Personal Edition provides a cloud desktop for individual users, with compute, storage, and the desktop environment hosted in the cloud. It supports access from multiple device types and lets users choose specifications on demand, making it useful for remote work, learning, development, and lightweight creative workflows.<br><br>[**Register in WeChat →**](https://dshdesktop.cn/sponsors/wuying) |
| <a href="https://astraflow.ucloud.cn/modelverse/playground?ytag=geo_waituo_dsh"><img src="assets/sponsors/astraflow-logo.png" alt="UCloud AstraFlow" width="96"></a> | [**UCloud · AstraFlow**](https://astraflow.ucloud.cn/modelverse/playground?ytag=geo_waituo_dsh)<br>Thanks to **UCloud** AstraFlow for sponsoring this project. **UCloud** AstraFlow ModelVerse supports one-click access to 200+ models, including Kimi K3, DeepSeek V4/V3, Qwen 3, GLM5.2, happyhorse, and other leading open-source models worldwide, with no self-training required.<br><br>[**Visit website →**](https://astraflow.ucloud.cn/modelverse/playground?ytag=geo_waituo_dsh) |
| <a href="https://88api.ai/sign-up?aff=VnEb"><img src="assets/sponsors/88api-logo.png" alt="88API" width="120"></a> | [**88API**](https://88api.ai/sign-up?aff=VnEb)<br>88API is a one-stop multi-model API aggregation platform operated by an overseas company, with stable, efficient service and invoice support. It provides official-transfer and open-source DeepSeek channels, with pricing as low as 50% off, and is designed to work well with Sensteed Agent. One API key can connect to many domestic and overseas models across text chat, image, audio, music, and video generation APIs for AI coding, agent automation, content creation, and application development.<br><br>[**Register now →**](https://88api.ai/sign-up?aff=VnEb) |

</details>

## Documentation

Ordinary users can start with the [user guide](docs/user-guide.en.md); the developer documentation is only needed when extending or maintaining the application.

### User documentation

| Goal | Entry point |
| --- | --- |
| Install and use the application | [User guide](docs/user-guide.en.md) |
| Check platforms, prerequisites, and product boundaries | [FAQ](docs/faq.en.md) |
| Understand data processing and privacy choices | [Privacy Policy](PRIVACY.md) |
| Understand why the project exists | [Why Sensteed Agent](docs/why-desktop.en.md) |
| See the full documentation and README map | [Documentation index](docs/README.en.md) |

### Developer and maintainer documentation

| Goal | Entry point |
| --- | --- |
| Read the plugin ecosystem manifesto | [Plugin ecosystem manifesto](docs/plugin-ecosystem.en.md) |
| Build ordinary or Desktop plugins | [Plugin development](docs/plugin-development.en.md) |
| Join the unified plugin-contract discussion | [DSH Community Fabric Draft](dsh-community-fabric/README.md) |
| See the research behind the unified plugin framework | [Framework and real-plugin research](dsh-community-fabric/docs/research/mature-plugin-frameworks.md) |
| Read the plugin market product and safety design | [DSH Community Market](dsh-community-market/README.md) |
| See what Desktop plugins can use | [Desktop plugin API](dsh-plugin-desktop/docs/plugin-services.md) |
| Understand how the desktop works | [Architecture](docs/architecture.en.md) |
| Read package-level build and release details | [`dsh-plugin-desktop/README.md`](dsh-plugin-desktop/README.md) |

## Project Panorama

This section gives a first-time visitor the whole picture: what Sensteed Agent is, what it is made of, and how it is built and verified.

### Product positioning

| Perspective | Description |
| --- | --- |
| For users | Sensteed Agent puts a complete DeepSeek Harness inside a native window: tray, notifications, terminal, updates, and workspace configuration out of the box — no Node.js or command line required. |
| For the enterprise | The internal AI workbench of Shandzi High-Tech. Login requires Feishu SSO; models and built-in capabilities are provisioned by enterprise entitlements, and operations are recorded by the audit service and synced to Models. |
| For developers | A fork-based desktop distribution: the pinned upstream kernel runs unmodified, while the desktop shell and every business capability compose as plugins — pluggable and evolvable. |

### Core capabilities

| Capability | Description |
| --- | --- |
| Native desktop shell | compatibility / extended / advanced window modes, system tray, native menus, notifications, macOS materials and Mica effects. |
| DoFe access (Feishu login required) | First use requires Feishu SSO binding; tenant verification, entitlement groups, protocol and default model selection, and built-in capability switches all live in "User settings". The manual key mode cannot bypass login. |
| Business plugin suite | Douyin operations, recruiting, sales, supply watch, content command, dashboards, FinOps, audit, and knowledge capture DoFe data sources, managed end-to-end by `dofe-managed` (credentials + MCP transport). |
| Audit and operations | Operation-audit events are staged locally (outbox) and synced to Models by configuration; finance and operations dashboards are built into the desktop. |
| Plugin market | DSH Community Market built in: plugin discovery, details, install, and management with open data-source onboarding. |
| Recovery and safe mode | Startup checkpoints, one-click rollback, automatic recovery assistant on failure; Safe Mode boots with shipped defaults for troubleshooting. |
| Browser and LAN access | Loopback by default; optionally hand off to the system browser or open the LAN (with a connection fence and LAN HTTPS). |
| System proxy inheritance | Node-side egress inherits the system proxy; the outbound policy installs at boot and the startup report states the resolved route. |
| Phone remote | Connect to the desktop Agent from a phone via Agents Anywhere to start tasks and follow progress. |
| Update channels | stable / beta channels; pinned-version checks and artifact downloads are separate requests with version and channel metadata headers. |

### Repository layout

```text
├── dsh-plugin-desktop/      Main desktop package: Electron host + client + packaging scripts (sensteed brand)
├── dsh-desktop-next/        Next-shell experiment (outside the workspace and gates, source-level alignment)
├── dsh-community-market/    Community market: product and safety design (private docs scaffold, no loadable entries)
├── dsh-community-fabric/    Plugin interop RFC and research
├── .ci/dsh-*                DoFe business plugin sources, brand assets, and CI resources
├── brand/                   Single brand source: brand.config.json → all generated artifacts
├── docs/                    User and developer documentation (bilingual)
├── scripts/                 Brand rendering, gate verification, and snapshot-sync scripts
├── assets/                  Screenshots, community and sponsor material
└── deepseek-harness -> ../deepseek-harness   Kernel fork (symlink into the sibling checkout)
```

### Kernel and sync model

- The runtime kernel is our own DeepSeek Harness fork (`iTechwu/deepseek-harness`, dev branch) pinned by `upstream.json` to `sourceVersion` (currently **0.1.7-rc.1**), linked whole into the root pnpm workspace via symlink; all 238 `@deepseek-ai/*` packages follow the sibling as `workspace:*`.
- Desktop-specific kernel extensions (the legacy settings facade, the settings-file compat layer, the preset data package) land as native fork commits — no patch files.
- Sync cadence: `git fetch` upstream → merge into dev → `main ← dev` fast-forward; each round resolves conflicts per the established convention (architecture files keep ours, product content takes theirs, brand replayed).
- The dependency closure is enforced by `verify:closure`: 319 first-party nodes must form a closed reachable runtime graph — one missing peer turns it red.

### Brand system

- `brand/brand.config.json` is the single brand source (sensteed only); `generate:brand` renders `generated-product-identity.ts`, `electron-builder.json`, app icons, tray icons, the lockup, and the README brand fences.
- Retired brand names are governed per-file by `brand/legacy-tokens-allowlist.json` and may only shrink; product copy is fully sensteed (display name 山子 Agent).
- The `<!-- brand:* -->` fences in this README are rendered by `pnpm brand:docs` and enforced by `pnpm brand:check`.

### Build and gates

The root `check` pins `BRAND=sensteed` and chains the following stages (any failure turns red):

| Stage | Content |
| --- | --- |
| `verify:brand` | Brand doc fences + bilingual hash records + legacy token quotas |
| `build` | Market build, then the desktop package (tsdown + vite + three tsconfigs) |
| `typecheck` | Full TS type checking for the main package and market |
| `test` | ~2000 vitest cases (including integration cases that boot a real Host) |
| `verify:closure` | 319-node first-party runtime closure check |
| `verify:cli` | Packaged CLI bootstrap runtime smoke |
| `verify:loader` | Loader assembly smoke (dofe-managed wiring and tray stubs) |
| `verify:yootun-clients` | DoFe client runtime verification |
| `verify:profile` | Full profile composition + renderer manifest smoke |
| `verify:licenses` | Redistribution allowlist for production dependency licenses |
| `verify:operations` | Unit tests for operations scripts |

The market package runs its own `check` (docs → build → export verification → loader → types → 274 tests).

### Common commands

```sh
corepack pnpm install --frozen-lockfile   # install (kernel packages all workspace-linked)
corepack pnpm dev                          # local development
corepack pnpm check                        # full gates (BRAND=sensteed)
corepack pnpm build                        # build market + desktop package
corepack pnpm upstream:install             # kernel fork dependency install
corepack pnpm upstream:build               # kernel fork full build (clean + build)
corepack pnpm --filter dsh-plugin-desktop run package:dir      # directory packaging
corepack pnpm --filter dsh-plugin-desktop run dist:mac-smoke   # unsigned macOS DMG smoke
corepack pnpm --filter dsh-plugin-desktop run verify:profile   # profile composition smoke
node scripts/sync-dofe-plugin-snapshot.mjs --write <plugin>    # re-sync a DoFe plugin snapshot
corepack pnpm brand:docs && corepack pnpm brand:check          # brand doc regeneration and verification
```

### Packaging artifacts

| Platform | Artifact | Notes |
| --- | --- | --- |
| macOS | Universal DMG (plus arm64/x64 single-arch smokes) | unsigned smoke and signed release paths |
| Windows | NSIS installer + portable zip | assisted installer messages, upgrade smoke, and running-check scripts included |
| Linux | AppImage / deb | x64; artifact and executable names follow the brand rendering |


## Features

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>Desktop</h3>
      <p>Bring the upstream DeepSeek Harness local Web UI to a native desktop application. The app starts and manages the local Harness service, integrates the system tray and desktop window, and requires no Node.js installation or command-line setup.</p>
    </td>
    <td width="50%" valign="top">
      <h3>Mobile Remote Control <img src="https://img.shields.io/badge/COMING_SOON-F59E0B?style=flat-square" alt="Built in"></h3>
      <p>Connect to Desktop from iOS and Android to start tasks, monitor Agent progress, and send follow-ups from your phone. Built in since 2.0.9.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3><a href="dsh-community-market/README.md">Plugin Marketplace</a> <img src="https://img.shields.io/badge/BUILT_IN-2EA44F?style=flat-square" alt="Built in"></h3>
      <p>DSH Community Market is complete and built in, with plugin discovery, details, installation, and management. The market openly connects to a wide range of plugin data sources: anyone can provide, integrate, and use a source that follows the public schemas, while existing APIs can join as cooperating sources through a reviewed adapter.</p>
    </td>
    <td width="50%" valign="top">
      <h3>Co-build the Plugin Ecosystem</h3>
      <p>The DSH plugin ecosystem is built by the community. Upstream plugins, Sensteed Agent plugins, and other community plugins follow shared conventions and can work together through the same composition mechanism. Join us — read the <a href="docs/plugin-ecosystem.en.md">DSH plugin ecosystem manifesto</a>.</p>
    </td>
  </tr>
</table>

### First-run setup, browser access, and LAN exposure

On the normal first launch of each uninitialized profile, Desktop shows its native Setup Wizard first. It can configure the window mode and system material, plugin marketplace, notifications, whether to open the system default browser automatically, and the Web access scope; it can also be skipped. The Host and main DSH window do not start until the wizard is completed or skipped. Completion or skip state is recorded separately for each profile; an explicit recovery launch still enters Recovery Assistant first.

The Web service listens on the local loopback interface by default. When **Open in browser** is enabled, Desktop hands the page to the system default browser after the Web service is actually ready; this preference does not change the listener exposure. **Desktop settings** shows the actual local URL below the control. LAN access is a separate opt-in setting and exposes the currently available LAN URLs when enabled.

> **Danger:** LAN exposure has no authentication. Anyone on the same local network can open DSH and directly operate your computer. Enable it only on a fully trusted network and with great care.

The automatic updater's fixed version-check request sends the installed version in the `X-Sensteed-Agent-Version` header, `stable` or `beta` in the `X-Sensteed-Agent-Channel` header, and a locally generated, persistently stored random UUID in the `X-Sensteed-Agent-Installation-Id` header; the value is not derived from hardware information. Package download requests carry the channel and `X-Sensteed-Agent-Target-Version`, but download requests and their redirects do not receive the installation identifier or the current version.

## Plugin Ecosystem

Plugins are extensions that add capabilities to DSH — models, tools, interfaces, and workflows can all be plugins, combined like building blocks.

Sensteed Agent does not modify upstream source, and it is not a fixed, hardcoded shell. A pinned upstream DeepSeek Harness version runs unchanged; the desktop shell itself — the window, tray, terminal, updates, and work profiles — integrates as a DSH plugin through the plugin mechanism provided by DeepSeek Harness. From the core agent to the desktop shell, the whole product follows the same "everything is a plugin" rule: plugins compatible with the pinned upstream version can be used, while desktop capabilities are composed, replaced, and evolved in the same way.

We want the plugin ecosystem to work like a phone app store: every plugin is built against the same set of rules, so plugins can be installed together and work together without interfering with each other.

### For developers

Unlike many other projects, this project itself is a DSH [plugin](docs/plugin-development.en.md): the desktop shell uses the same plugin composition mechanism as third-party plugins. Desktop plugin capabilities are now available. We provide Desktop services so plugin developers can integrate their plugins with desktop capabilities: for example, viewing and switching work profiles, or installing, updating, and removing plugins in the active profile. See the [Desktop plugin API](dsh-plugin-desktop/docs/plugin-services.md) for complete usage details. See [Why Sensteed Agent](docs/why-desktop.en.md) and [Plugin development](docs/plugin-development.en.md) for the reasoning and the third-party boundary.

## Relationship to DeepSeek Harness

Sensteed Agent is an independent community project built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and the Cordis plugin model, intended to provide an open and composable Sensteed agent experience.

This repository is independently maintained by the community. No DeepSeek employee or member of the official upstream DeepSeek Harness team currently participates in its development, maintenance, or governance. Contributors from the upstream project may appear on GitHub's Contributors page because this repository inherited and later synchronized upstream commit history when it was forked. Such attribution reflects commit provenance only and does not imply involvement in this repository or any affiliation, partnership, authorization, or endorsement.

The upstream project provides the core agent capabilities, plugin system, and Web UI. Sensteed Agent primarily provides:

- Desktop application packaging
- Starting, stopping, and recovering the local service
- Desktop window and system tray integration
- macOS and Windows installer builds and releases
- An interface designed for desktop use

If you prefer to run DeepSeek Harness from the command line or contribute to its core functionality, refer to the upstream repository first.

## Special Thanks

Special thanks to the [original DeepSeek Harness repository](https://github.com/deepseek-ai/deepseek-harness) and the DeepSeek AI team. Sensteed Agent is built from a pinned upstream checkout, and its core agents, models, tools, sessions, Web UI, and plugin ecosystem come from that project.

We also thank [Cordis](https://github.com/cordiverse/cordis) for the plugin foundation that makes this composition possible. Sensteed Agent would not exist without these open-source projects.

We are also grateful to the [Koishi.js](https://koishi.chat/) project and community for their long-standing work on plugin practices, tooling, and shared knowledge, and to everyone who contributes discussions, testing, feedback, and plugins.

Also, and you.

<a id="run-from-source"></a>

## Development

Desktop source lives in `dsh-plugin-desktop/`. The root pnpm workspace directly includes the `../deepseek-harness` checkout through the `deepseek-harness` symlink. From the repository root:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Use `corepack pnpm check` for the headless gate. The [architecture](docs/architecture.en.md) and package [`README`](dsh-plugin-desktop/README.md) describe the full build, test, and release boundaries. See [CONTRIBUTING.en.md](CONTRIBUTING.en.md) for how to contribute.

## Community

Choose whichever platform you prefer to discuss usage, plugin development, and project updates.

<table>
  <thead>
    <tr>
      <th align="center">WeCom</th>
      <th align="center">QQ Group</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="assets/community-wechat-group.png" alt="Sensteed Agent WeCom QR code" title="Scan to add us on WeCom" width="180" height="180"></td>
      <td align="center"><img src="assets/community-qq-group.jpg" alt="Sensteed Agent QQ group QR code" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

Discord: [Join the Sensteed Agent community](https://discord.gg/TJeGqKRNM)

If you would like to join our technical team, contact us at [t4wefan@qq.com](mailto:t4wefan@qq.com).

## Related Links

Ecosystem projects and developer tools around DeepSeek Harness.

| Project | About | Link |
| --- | --- | --- |
| dshfind | The learning & sharing community for DeepSeek Harness (DSH). | [GitHub](https://github.com/hikariming/dshfind) · [Website](https://dshfind.com) |
| DSH 1024Store | A community plugin directory for the DeepSeek Harness (DSH) ecosystem (4,120 plugins), open-sourcing an online marketplace, a collection pipeline, and a public query API — fork it to deploy your own marketplace. | [GitHub](https://github.com/imsai-sh/awesome-deepseek-harness-plugins) |
| Awesome DSH Plugin | Curated list of DeepSeek Harness (DSH) plugins. | [GitHub](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) |
| dsh-market | Visual plugin market for DeepSeek Harness, with browsing, search, and one-click installation. | [GitHub](https://github.com/dsh-market/dsh-market) |
| ModLens | Adds OCR, layout, and semantic vision capabilities to DeepSeek Harness and text-only coding agents. | [GitHub](https://github.com/liustack/modlens) · [Website](https://liustack.dev) |
| DeepSeek Harness Orange Book | Community field manual for DeepSeek Harness. | [GitHub](https://github.com/alchaincyf/deepseek-harness-orange-book) |
| dsh-web-ui | DeepSeek Harness Web UI plugins and themes. | [GitHub](https://github.com/zhu1090093659/dsh-web-ui) · [Gallery](https://gallery.dsh-market.com) |
| dsh-TUI | Full-screen interactive terminal interface for DeepSeek Harness. | [GitHub](https://github.com/ccch1mneyyy/dsh-TUI) |
| dsh-tianshu-tui | Minimalist interactive terminal UI plugin for the DSH web client with a self-developed ANSI rendering core for silky-smooth output; adds TDD, evidence gates, and vision/image module workflows on top of the official UI. | [GitHub](https://github.com/huiliyi37/dsh-tianshu-tui) |
| dsh-context | DSH context insight panel: Context dashboard + `/context` command + Context browser for one-stop context lifecycle management — category composition, content details, evolution trends, compaction/injection events, and statistics. | [GitHub](https://github.com/bowenliang123/dsh-context) · [NPM](https://www.npmjs.com/package/dsh-context) |
| Agents-Anywhere | Remote-control your desktop coding agent from your phone. | [GitHub](https://github.com/anywhere-labs/Agents-Anywhere) |
| deepseek-harness-remote | Remote control and multi-device collaboration plugin for DeepSeek Harness based on P2P and APIProxy. | [GitHub](https://github.com/liguobao/deepseek-harness-remote) |
| DSH-better-sidebar | Sidebar workbench for DeepSeek Harness with files, terminal, Git, and subagents. | [GitHub](https://github.com/omdsh-dev/DSH-better-sidebar) |
| Awesome DeepSeek Harness | Curated list of DeepSeek Harness plugins, tools, and infrastructure. | [GitHub](https://github.com/0xsline/awesome-deepseek-harness) · [Website](https://deepseekdocs.com/) |
| Shenqiu Community (DeepSeek.club) | The world's largest third-party DeepSeek open-source ecosystem community, bringing together model libraries, app rankings, the Harness plugin library, and Harness Academy to serve developers, researchers, and enterprise users in one place. | [Website](https://deepseek.club) |
| MkSaaS · TanStarter | Commercial SaaS starter templates for indie developers. MkSaaS is built on Next.js; TanStarter on TanStack Start and Cloudflare, with AI, auth, payments, and admin baked in. | [MkSaaS](https://mksaas.com) · [TanStarter](https://tanstarter.dev) |

<sub>To list your project, join the WeChat group and message @王博升Benson, or contact t4wefan@qq.com, or <a href="https://github.com/anywhere-labs/deepseek-harness-desktop/issues">open an issue</a>.</sub>

## License

This project is licensed under the [MIT License](LICENSE).

> “DeepSeek Harness” is a registered trademark of DeepSeek AI. The name is used here solely to accurately describe compatibility, technical origin, and this project's relationship to upstream software.

> Sensteed Agent is an independent community project and is not affiliated with, sponsored by, authorized by, or endorsed by DeepSeek.

## Star History

<a href="https://www.star-history.com/?repos=anywhere-labs%2Fdeepseek-harness-desktop&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=anywhere-labs/deepseek-harness-desktop&type=date&theme=dark&legend=top-left&sealed_token=BRTkOyC4czCEkIyFb5-QxrsC-kaDotBJ8tsjxrWs-UGfmBqfRCXSwieZPlVTCYOjJVEZ29uLvmBjAPREB524J5dPN1jk-UA7ajFdLdrbjumJqoOBeGWmig" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=anywhere-labs/deepseek-harness-desktop&type=date&legend=top-left&sealed_token=BRTkOyC4czCEkIyFb5-QxrsC-kaDotBJ8tsjxrWs-UGfmBqfRCXSwieZPlVTCYOjJVEZ29uLvmBjAPREB524J5dPN1jk-UA7ajFdLdrbjumJqoOBeGWmig" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=anywhere-labs/deepseek-harness-desktop&type=date&legend=top-left&sealed_token=BRTkOyC4czCEkIyFb5-QxrsC-kaDotBJ8tsjxrWs-UGfmBqfRCXSwieZPlVTCYOjJVEZ29uLvmBjAPREB524J5dPN1jk-UA7ajFdLdrbjumJqoOBeGWmig" />
 </picture>
</a>
