/**
 * Post-failure diagnostic for the Windows archive: compare the app.asar
 * header against the physical dependency tree so collected-but-dropped
 * entries surface all at once.
 *
 * Usage:
 *   node scripts/diagnose-win-asar.mjs <app.asar> <desktopRoot> [headerPrefix]
 *
 * - lists header entries under [headerPrefix] (default the LibreOffice kit)
 * - reports physical hits for a probe filename under the dependency tree
 * - counts header entries whose top-level scope directory is absent on disk
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const [asarPath, desktopRoot = 'dsh-plugin-desktop', headerPrefix = 'node_modules/@deepseek-ai/libreoffice-kit-win32-x64/'] = process.argv.slice(2)
if (!asarPath || !existsSync(asarPath)) {
  console.error(`diagnose: app.asar not found at ${asarPath ?? '(missing argument)'}`)
  process.exit(1)
}

const buf = readFileSync(asarPath)
const headerStringSize = buf.readUInt32LE(12)
const header = JSON.parse(buf.slice(16, 16 + headerStringSize).toString('utf8'))

const files = []
const walk = (node, prefix) => {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const path = `${prefix}${name}`
    if (child.files !== undefined) walk(child, `${path}/`)
    else if (child.size !== undefined || child.unpacked) files.push({ path, unpacked: child.unpacked === true, size: child.size ?? 0, link: child.link ?? null })
  }
}
walk(header, '')

const scoped = files.filter(entry => entry.path.startsWith(headerPrefix))
console.log(`diagnose: header files total ${files.length}`)
console.log(`diagnose: header entries under ${headerPrefix}: ${scoped.length}`)
for (const entry of scoped.slice(0, 40)) {
  console.log(`  ${entry.unpacked ? '[unpacked]' : entry.link !== null ? `[link->${entry.link}]` : '[file]    '} ${entry.path} (${entry.size}B)`)
}
if (scoped.length > 40) console.log(`  … ${scoped.length - 40} more`)

const nodeModules = join(desktopRoot, 'node_modules')
const probeName = headerPrefix.split('/').filter(Boolean).at(-1)
const physicalHits = []
const pending = [join(nodeModules, '.pnpm')]
while (pending.length > 0 && physicalHits.length < 10) {
  const dir = pending.pop()
  if (!existsSync(dir)) continue
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === probeName) physicalHits.push(full)
      else pending.push(full)
    }
  }
}
console.log(`diagnose: physical directories named ${probeName}: ${physicalHits.length}`)
for (const hit of physicalHits) console.log(`  ${hit}`)

const scopeDir = join(nodeModules, '@deepseek-ai')
const scopesOnDisk = existsSync(scopeDir) ? readdirSync(scopeDir).filter(name => name.startsWith('libreoffice')) : []
console.log(`diagnose: top-level @deepseek-ai libreoffice entries on disk: ${scopesOnDisk.length ? scopesOnDisk.join(', ') : 'none'}`)

const topPrefix = headerPrefix.split('/').slice(0, 2).join('/')
const topLevelMissing = files.filter(entry => entry.path.startsWith(topPrefix) && !entry.path.slice(topPrefix.length + 1, Number.POSITIVE_INFINITY).includes('/'))
const absentTopLevel = topLevelMissing.filter(entry => !existsSync(join(desktopRoot, entry.path)))
console.log(`diagnose: header top-level entries under ${topPrefix}: ${topLevelMissing.length}, physically absent: ${absentTopLevel.length}`)
for (const entry of absentTopLevel.slice(0, 20)) console.log(`  absent: ${entry.path}`)
