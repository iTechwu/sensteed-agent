#!/usr/bin/env node
// Enterprise distribution is managed by Sensteed Agent's verified Hub profile.
// This compatibility entry point intentionally does not fetch or install upstream packages.
process.stdout.write(
  'Dashi PPT 由 Sensteed Agent 的 Skill Hub 管理。请在“插件与技能”中检查并安装更新，完成后重启 Agent 生效。此脚本不执行独立版本检查。\n'
);
