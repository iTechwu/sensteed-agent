/** Synchronize generated runtime files in pnpm's installed file: package snapshots. */
import { cpSync, existsSync, readFileSync, mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export function syncInstalledPlugin(source, installed, { verifyOnly = false } = {}) {
  const files = []
  const manifestPath = resolve(source, 'package.json')
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}
  const declared = manifest.files?.map(path => path.replace(/^\.\//, '').split('*')[0].replace(/\/$/, ''))
  const runtimePath = path => path === 'package.json' || (declared
    ? declared.some(entry => path === entry || path.startsWith(entry + '/'))
    : /^(?:lib|assets|skills|locale|bin|plugin-src)(?:\/|$)/.test(path) || /^[^/]+\.(?:js|mjs|cjs|ya?ml)$/.test(path))
  const collect = relative => {
    for (const entry of readdirSync(resolve(source, relative), { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const path = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) throw new Error(`Unexpected plugin symlink: ${path}`)
      if (entry.isDirectory()) collect(path)
      else if (entry.isFile() && runtimePath(path)) files.push(path)
    }
  }
  collect('')
  const sameRoot = realpathSync(source) === realpathSync(installed)
  if (!verifyOnly && !sameRoot) {
    for (const file of files) {
      const from = resolve(source, file), to = resolve(installed, file)
      if (existsSync(to) && statSync(from).ino === statSync(to).ino && statSync(from).dev === statSync(to).dev) continue
      mkdirSync(dirname(to), { recursive: true })
      cpSync(from, to, { recursive: true })
    }
  }
  for (const file of files) {
    const target = resolve(installed, file)
    if (!existsSync(target) || !readFileSync(resolve(source, file)).equals(readFileSync(target))) {
      throw new Error(`Installed plugin differs from source: ${file}`)
    }
  }
  return files.length
}
