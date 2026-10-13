/** Guard a narrowly proven redundant frontend dependency before publishing. */
import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { getRawHeader } from '@electron/asar'
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

/** Inspect the artifact itself so a future client externalizing icons fails
 * closed instead of silently publishing a missing runtime dependency. */
export function verifyUnusedFrontendRuntime(archive: string): void {
  const started = performance.now()
  // Archive keys always use '/', whereas asar's extractFile lookup uses the
  // host separator. On Windows every nested lookup used to fail, rereading and
  // parsing the entire multi-MiB header once per source file in the fallback.
  // Walk one fresh header and read its offsets through one shared descriptor.
  const { header, headerSize } = getRawHeader(archive)
  const fd = openSync(archive, 'r')
  let inspected = 0
  let parsed = 0
  const archiveBytes = fstatSync(fd).size
  const readSource = (path: string, entry: Entry): string => {
    if (entry.unpacked) return readFileSync(join(`${archive}.unpacked`, path), 'utf8')
    const size = entry.size!
    const offset = typeof entry.offset === 'string' && /^\d+$/u.test(entry.offset) ? Number(entry.offset) : NaN
    const position = 8 + headerSize + offset
    if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(offset)
      || !Number.isSafeInteger(position + size) || position + size > archiveBytes) {
      throw new Error(`invalid packaged source range: ${path}`)
    }
    const content = Buffer.alloc(size)
    let read = 0
    while (read < size) {
      const bytes = readSync(fd, content, read, size - read, position + read)
      if (bytes === 0) throw new Error(`truncated packaged source: ${path}`)
      read += bytes
    }
    return content.toString('utf8')
  }
  const walk = (entry: Entry, prefix = ''): void => {
    for (const [name, child] of Object.entries(entry.files ?? {})) {
      const path = prefix ? `${prefix}/${name}` : name
      if (child.files) { walk(child, path); continue }
      if (!/\.(?:[cm]?js|[cm]?ts)$/u.test(path) || !child.size) continue
      if (PRUNED_FRONTEND_PACKAGES.some(dependency => path.includes(`node_modules/${dependency}/`))) {
        throw new Error(`unused frontend code remains in the package: ${path}`)
      }
      const source = readSource(path, child)
      inspected += 1
      // Only parse files mentioning this package, keeping large binary and
      // unrelated source payloads outside the parser.
      if (!source.includes('react-icons') && !source.includes('\\')) continue
      parsed += 1
      const dependency = referencesPrunedFrontendPackage(source)
      if (dependency) throw new Error(`${path} references pruned ${dependency}; restore its packaging rule`)
    }
  }
  try {
    walk(header)
  } finally {
    closeSync(fd)
  }
  console.log(`packaged frontend guard: ${inspected} source files, ${parsed} parsed, ${((performance.now() - started) / 1000).toFixed(3)}s`)
}
