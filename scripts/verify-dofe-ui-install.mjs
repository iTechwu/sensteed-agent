/** Sync and verify the installed file: plugin copies after pnpm install. Must run post-install. */
import { cpSync, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const plugins = [
  'dsh-sensteed-finance',
  'dsh-sensteed-skill-manager',
]
const require = createRequire(resolve(root, 'dsh-plugin-desktop/package.json'))

// pnpm file: dependencies are snapshots, not live links to the sibling.
// Update the directory Electron actually packages, then verify it byte-for-byte.
for (const name of plugins) {
  const plugin = resolve(root, `../docker-helm.dofe.ai/plugins/${name}`)
  if (!existsSync(resolve(plugin, 'package.json'))) {
    throw new Error(`verify-dofe-ui-install: sibling plugin is missing at ${plugin}`)
  }
  const installed = resolve(require.resolve(`@dofe/${name}/package.json`), '..')
  if (realpathSync(installed) !== realpathSync(plugin)) {
    for (const file of ['index.js', 'cordis.patch.yml', 'lib', 'package.json']) {
      cpSync(resolve(plugin, file), resolve(installed, file), {
        recursive: true,
        filter: (src, dest) => !existsSync(dest) || statSync(src).ino !== statSync(dest).ino || statSync(src).dev !== statSync(dest).dev,
      })
    }
  }
  for (const file of ['lib/client.js', 'package.json']) {
    if (!readFileSync(resolve(plugin, file)).equals(readFileSync(resolve(installed, file)))) {
      throw new Error(`verify-dofe-ui-install: packaged ${name}/${file} differs from the source`)
    }
  }
  process.stdout.write(`verify-dofe-ui-install: ${name} matches the packaged copy\n`)
}
