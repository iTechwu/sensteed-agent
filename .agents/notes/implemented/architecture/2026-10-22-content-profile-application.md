# Agent Note: Content Profile application ownership

Status: implemented in source; packaged and production acceptance pending

English | [中文](2026-10-22-content-profile-application.zh.md)

## Context and decision

A content Profile is a saved desired content selection inside a runtime Profile. It does not isolate accounts, sessions or workspaces. A template determines its initial selection; later catalog edits belong to that content Profile. Creation lives in the enterprise skill catalog, and custom assembly uses the existing catalog selection flow.

Instantiation registers desired content. Application uses the existing signed generation preview → execute → restart pipeline. This replaces the original four-step overlay proposal. Switching never automatically deletes the previous Profile's installed content. Registration alone must not appear as healthy activation.

## Authority and persistence

`ContentProfileStore` keeps registration, application and last healthy selection separately. Version-1 files migrate additively. All read-modify-write operations hold a file lock; corrupt state fails closed and is preserved. Host mutations serialize under installation maintenance and selection locks, await persistence, and refuse changes during an unfinished generation or mandatory update block. Renderer create, set-active and mark-applied shortcuts are refused.

Application binds the content Profile id, selection digest, operation id, signed plan digest, generation digest and identity scope before staging. Only the Host can finish it after acknowledged ACTIVATED and matching managed content. Startup/status recovery reconciles interrupted staging, failure receipts and successful activation even without an open page. Disposal waits for recovery, queued mutations and persistence.

The Hub stores exact immutable release ids, versions and enabled flags. An explicitly empty selection stays empty apart from required content. Full catalog discovery enables later edits without restoring unrelated optional defaults. Explicit selection overrides removal tombstones. Required content, authorization, dependency closure and exact target proof remain mandatory.

After healthy activation, the Host registers the exact operation selection through `POST /skillhub/v1/generations/selection`. Hub derives it from an authorized consumed operation with an acknowledged ACTIVATED receipt; COMMITTED, rolled-back and foreign operations are refused. The Host verifies the returned selection against the signed plan. A later switch restores that selection, preserving edits and MCP entries rather than replacing them with the birth template. Historical operation registration grants no old execute or boot authority.

## MCP and presentation

The Host applies only symbolic public MCP service/domain/version/enabled references through `hubMcp.applyProfileEndpoints`. Route projection, product entitlement, user preferences, business ACL and credentials remain authoritative. Plugin and Profile requests share single connection ownership, and failed shutdown blocks replacement. Successful application establishes Host configuration; it does not guarantee a remote MCP server is online.

The switcher displays applied and registered/pending state separately and refreshes on open, events and polling. Template preview binds the displayed revision, offers retry after failure and defaults the name. The create action opens the skill catalog. Loading, failure and keyboard navigation have dedicated behavior.

## Next integration

Ordinary Next retains its official frontend and upstream `runProfile` path. Explicit `--enterprise-content` on a sealed installation uses fixed installation bundles, the shared enterprise Host services and a Next-owned supervisor. Arbitrary Profile overlays and the ordinary installer are excluded from that composition. Development trees cannot fabricate a target.

The launcher recomputes the app.asar/unpacked build identity. It supervises child stop/replacement, ignores stale child requests, obtains fresh boot authority, and requires current-document nonce health plus loaded-content evidence. Failure rolls back through the base Host. Maintenance covers updates and generation/Profile changes. Installer handoff is persisted before exit and is cleared only by a verified target build or explicit cancellation recovery with `--cancel-enterprise-update`. Next retains its existing update transport; Models v2 artifact support is outside this change.

## Evidence and remaining acceptance

Regression coverage includes failed persistence, competing registrations, exact version/enabled selection, empty selections, MCP ownership, application receipt recovery, operation selection restore, Next composition/supervision, stale child messages, renderer nonces and update maintenance. A real headless Chrome check covers template creation, pending state, portal navigation and keyboard access. Root `pnpm check` is the complete source gate; focused Hub API/contracts tests also cover real database selection behavior.

These checks do not constitute trusted target proof, signed package publication, platform installer acceptance, production deployment or measurements of adoption/success/time targets. Those require a tagged installation and real authorized Hub flows. The Hub's separate full quality gate currently reports 43 pre-existing frontend internationalization violations; related API, contracts and template gates pass.
