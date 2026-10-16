/** Build Sensteed Client plugins before Desktop packaging. The installed-copy
 * sync and verification live in verify-dofe-ui-install.mjs and must run after
 * pnpm install. */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const plugins = [
  'dsh-sensteed-finance',
  'dsh-sensteed-skill-manager',
]
for (const name of plugins) {
  const plugin = resolve(root, `../docker-helm.dofe.ai/plugins/${name}`)
  if (!existsSync(resolve(plugin, 'package.json'))) {
    throw new Error(`build-dofe-ui: sibling plugin is missing at ${plugin}`)
  }
  execFileSync(process.execPath, [resolve(plugin, 'scripts/build.mjs')], {
    cwd: plugin,
    stdio: 'inherit',
  })
}
