/** Guard a narrowly proven redundant frontend dependency before publishing. */
import { closeSync, openSync, readFileSync, readSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { extractFile, getRawHeader } from '@electron/asar'
import ts from 'typescript'

const PRUNED_FRONTEND_PACKAGES = ['react-icons'] as const

/** Parse JavaScript so template/regex syntax cannot turn comments into strings.
 * Ignore bundled module comments but catch import/require,
 * dynamic imports, resolver calls, and escaped package-name string literals. */
export function referencesPrunedFrontendPackage(source: string): string | undefined {
  const file = ts.createSourceFile('packaged.js', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS)
  let dependency: string | undefined
  const visit = (node: ts.Node): void => {
    if (dependency) return
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) {
      dependency = PRUNED_FRONTEND_PACKAGES.find(name => node.text.includes(name))
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return dependency
}

interface Entry { files?: Record<string, Entry>; size?: number; unpacked?: boolean; offset?: string }

function extractFileWithOffsetFallback(archive: string, path: string, unpacked = false): Buffer {
  // smartUnpack 条目的内容不在 asar 载荷里（头中无 offset），落在旁边的
  // app.asar.unpacked 物理目录；从磁盘读取而不是抛「not found」。
  if (unpacked) return readFileSync(join(dirname(archive), 'app.asar.unpacked', path))
  try {
    return extractFile(archive, path)
  } catch (cause) {
    let node: Entry = getRawHeader(archive).header as Entry
    for (const segment of path.split('/').filter(Boolean)) {
      const child = node.files?.[segment]
      if (child === undefined) throw cause
      node = child as Entry
    }
    if (typeof node.size !== 'number' || typeof node.offset !== 'string') throw cause
    const sizes = Buffer.alloc(8)
    const fd = openSync(archive, 'r')
    try {
      readSync(fd, sizes, 0, sizes.length, 0)
      const content = Buffer.alloc(node.size)
      readSync(fd, content, 0, node.size, 8 + sizes.readUInt32LE(4) + Number(node.offset))
      return content
    } finally {
      closeSync(fd)
    }
  }
}

/** Inspect the artifact itself so a future client externalizing icons fails
 * closed instead of silently publishing a missing runtime dependency. */
export function verifyUnusedFrontendRuntime(archive: string): void {
  const walk = (entry: Entry, prefix = ''): void => {
    for (const [name, child] of Object.entries(entry.files ?? {})) {
      const path = prefix ? `${prefix}/${name}` : name
      if (child.files) { walk(child, path); continue }
      if (!/\.(?:[cm]?js|[cm]?ts)$/u.test(path) || !child.size) continue
      if (PRUNED_FRONTEND_PACKAGES.some(dependency => path.includes(`node_modules/${dependency}/`))) {
        throw new Error(`unused frontend code remains in the package: ${path}`)
      }
      const source = extractFileWithOffsetFallback(archive, path, child.unpacked === true).toString('utf8')
      // Only parse files mentioning this package, keeping large binary and
      // unrelated source payloads outside the parser.
      if (!source.includes('react') && !source.includes('\\')) continue
      const dependency = referencesPrunedFrontendPackage(source)
      if (dependency) throw new Error(`${path} references pruned ${dependency}; restore its packaging rule`)
    }
  }
  walk(getRawHeader(archive).header)
}
