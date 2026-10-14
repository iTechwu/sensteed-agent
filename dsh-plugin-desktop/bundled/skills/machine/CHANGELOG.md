# Changelog

## 1.2.0 (2026-10-14)

- Multi-host adaptation: the skill installs and runs unchanged in Sensteed Agent (DeepSeek Harness) and any Agent Skills host — agent-neutral wording, host-relative script paths, a `whenToUse` frontmatter field, and an environment check with a graceful no-film fallback in SKILL.md.
- Windows recording: `record.mjs` deletes its silent intermediate with `rmSync` instead of `rm -f`.
- README rebuilt: per-host install table (Claude Code, Sensteed Agent, any DSH host), a Sensteed Agent section with fleet bundling via `bundled.json`, per-OS requirements, and a troubleshooting section.

## 1.1.0 (2026-10-13)

- Two refinery examples for plant training: an API 610 process pump (cavitation) and an API 617 barrel compressor (surge), each with hover notes on what every part does and what the operator checks, live operator rounds and a curve or map chart.
- `film/reply.html`: a director page that plays both machines in one film.

## 1.0.0 (2026-10-12)

- First public release: SKILL.md, the runtime kit (`kit/lab-kit.js`), the recorder with the magenta frame guard and pink scan, two example machines (turbofan, rocket engine) with posters and films, and the launch film director page.
