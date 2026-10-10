/** Guard a narrowly proven redundant frontend dependency before publishing. */
import { extractFile, getRawHeader } from '@electron/asar'
import ts from 'typescript'

const PRUNED_FRONTEND_PACKAGES = ['react-icons'] as const

/** A token scan ignores bundled module comments but catches import/require,
 * dynamic imports, resolver calls, and escaped package-name string literals. */
export function referencesPrunedFrontendPackage(source: string): string | undefined {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source)
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (![ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral,
      ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail].includes(token)) continue
    const value = scanner.getTokenValue()
    const dependency = PRUNED_FRONTEND_PACKAGES.find(name => value.includes(name))
    if (dependency) return dependency
  }
  return undefined
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
      // Only tokenize files mentioning this package, keeping large binary and
      // unrelated source payloads outside the scanner.
      if (!source.includes('react') && !source.includes('\\')) continue
      const dependency = referencesPrunedFrontendPackage(source)
      if (dependency) throw new Error(`${path} references pruned ${dependency}; restore its packaging rule`)
    }
  }
  walk(getRawHeader(archive).header)
}
