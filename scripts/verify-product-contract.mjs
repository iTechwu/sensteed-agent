/**
 * Verify the product layer's cross-shell activation contract:
 *
 * - the package declares `dsh.bundle.patch` and exposes `./package.json`;
 * - its patch only INSERTS self-owned rows (historical product ids or the
 *   `dofe-product-*`/`@dofe/dsh-sensteed-product` namespace) and never
 *   touches ids reserved by either shell (market, AA, webserver,
 *   desktop-shell, upstream bundle rows);
 * - every host peer on the product runtime is declared with a wide semver
 *   range (no exact pins), so both shell generations can satisfy it.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const yamlRequire = createRequire(resolve(root, 'dsh-plugin-desktop/package.json'))
const { parse: parseYaml } = yamlRequire('yaml')
const manifestPath = resolve(root, 'dsh-sensteed-product/package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

const failures = []

if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') {
  failures.push('package.json must declare dsh.bundle.patch = ./cordis.patch.yml')
}
if (manifest.exports?.['./package.json'] === undefined) {
  failures.push('package.json must expose ./package.json for bundle resolution')
}

const RESERVED_ROW_IDS = new Set([
  'market', 'dshmarket', 'desktop-market', 'agents-anywhere-bridge-next',
  'webserver', 'web-runtime', 'desktop-shell', 'hmr', 'llm-deepseek',
  'agent-default-model', 'ui-settings-models', 'ui-brand-official',
  'desktop-terminal', 'desktop-diagnostics', 'desktop-notifications',
  'desktop-pnpm', 'desktop-profiles', 'desktop-updates', 'desktop-browser-tools',
  'ui-dsh-soup', 'dofe-sensteed-supplier-intelligence',
])
const OWN_ROW_IDS = new Set([
  'dofe-managed', 'personal-knowledge-files', 'dofe-sensteed-finance',
  'personal-knowledge-management', 'openmontage-guidance', 'dofe-opencli',
  'dofe-product-client', 'dofe-product-routes', 'sensteed-quit-inspection',
  'sensteed-update-policy',
])

const patchPath = resolve(root, 'dsh-sensteed-product/cordis.patch.yml')
const statements = parseYaml(readFileSync(patchPath, 'utf8'))
for (const statement of statements) {
  const inserts = statement.insert ?? []
  if (inserts.length === 0) continue
  if (statement.remove !== undefined || statement.override !== undefined) {
    failures.push('product patch must only insert rows')
  }
  for (const row of inserts) {
    const id = typeof row.id === 'string' ? row.id : undefined
    const name = typeof row.name === 'string' ? row.name : undefined
    if (id === undefined || RESERVED_ROW_IDS.has(id)) {
      failures.push(`product patch row has a reserved or missing id: ${String(id)}`)
      continue
    }
    if (!OWN_ROW_IDS.has(id)) failures.push(`product patch row ${id} is not a known own row`)
    if (name !== undefined && !name.startsWith('@dofe/dsh-sensteed-product') && !name.startsWith('@dofe/dsh-sensteed-') && !name.startsWith('@dofe/dsh-')) {
      failures.push(`product patch row ${id} names a package outside the DoFe product namespace: ${name}`)
    }
  }
}

const RESERVED_PEERS = ['@deepseek-ai/cordis', '@deepseek-ai/schemastery', 'react', 'react-dom', 'lucide-react']
for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
  if (typeof range !== 'string') continue
  if (RESERVED_PEERS.includes(name)) continue
  if (/^\d/u.test(range) || range.startsWith('=')) {
    failures.push(`peerDependencies.${name} must be a wide semver range, got ${range}`)
  }
}

if (failures.length > 0) {
  console.error('product layer contract violations:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`product layer contract holds (${statements.length} patch statements, ${Object.keys(manifest.peerDependencies ?? {}).length} peers).`)
