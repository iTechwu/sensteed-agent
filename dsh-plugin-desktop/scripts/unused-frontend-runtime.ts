/** Guard a narrowly proven redundant frontend dependency before publishing. */
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

interface Entry { files?: Record<string, Entry>; size?: number }

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
      const source = extractFile(archive, path).toString('utf8')
      // Only parse files mentioning this package, keeping large binary and
      // unrelated source payloads outside the parser.
      if (!source.includes('react') && !source.includes('\\')) continue
      const dependency = referencesPrunedFrontendPackage(source)
      if (dependency) throw new Error(`${path} references pruned ${dependency}; restore its packaging rule`)
    }
  }
  walk(getRawHeader(archive).header)
}
