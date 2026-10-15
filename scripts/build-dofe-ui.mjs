/** Build Sensteed Client plugins before Desktop packaging. */
import { execFileSync } from 'node:child_process'
import { existsSync, cpSync, realpathSync, statSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const plugins = [
  'dsh-sensteed-finance',
  'dsh-sensteed-skill-manager',
]
const require = createRequire(resolve(root, 'dsh-plugin-desktop/package.json'))
for (const name of plugins) {
  const plugin = resolve(root, `../docker-helm.dofe.ai/plugins/${name}`)
  if (!existsSync(resolve(plugin, 'package.json'))) {
    throw new Error(`build-dofe-ui: sibling plugin is missing at ${plugin}`)
  }
  execFileSync(process.execPath, [resolve(plugin, 'scripts/build.mjs')], {
    cwd: plugin,
    stdio: 'inherit',
  })
  // pnpm file: dependencies are snapshots, not live links to the sibling.
  // Build and update the directory Electron actually packages, then verify it.
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
      throw new Error(`build-dofe-ui: packaged ${name}/${file} differs from the source`)
    }
  }
}
