/** Sync and verify every bundled file: plugin, including the copy Electron actually packages. */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { syncInstalledPlugin } from './installed-plugin-copy.mjs'

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'bundled.json'), 'utf8'))
const require = createRequire(resolve(root, 'dsh-plugin-desktop/package.json'))
function installedRoot(name) {
  try { return dirname(require.resolve(`${name}/package.json`)) } catch {
    let dir = dirname(require.resolve(name))
    while (dirname(dir) !== dir) {
      const file = resolve(dir, 'package.json')
      if (existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).name === name) return dir
      dir = dirname(dir)
    }
    throw new Error(`Installed plugin not found: ${name}`)
  }
}
for (const plugin of manifest.plugins) {
  const source = resolve(root, `../docker-helm.dofe.ai/plugins/${plugin.name}`)
  if (!existsSync(resolve(source, 'package.json'))) throw new Error(`Sibling plugin missing: ${plugin.name}`)
  syncInstalledPlugin(source, installedRoot(plugin.package), { verifyOnly: process.argv.includes('--verify-only') })
  console.log(`verify-dofe-ui-install: ${plugin.name} matches the packaged copy`)
}
