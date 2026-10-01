/** Fail when committed brand-derived build inputs drift from brand/brand.config.json. */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderBrandBuildInputs } from './generate-product-identity.mjs'
import { renderProductBrandAssets, renderProductIdentityModule } from '../../dsh-sensteed-product/scripts/generate-brand-module.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const productRoot = resolve(packageRoot, '..', 'dsh-sensteed-product')

const committed = {
  identityModule: resolve(packageRoot, 'src/generated-product-identity.ts'),
  builderConfig: resolve(packageRoot, 'electron-builder.json'),
}

const rendered = renderBrandBuildInputs()
const drift = []
if (readFileSync(committed.identityModule, 'utf8') !== rendered.identityModule) {
  drift.push(committed.identityModule)
}
const committedBuilder = JSON.parse(readFileSync(committed.builderConfig, 'utf8'))
if (JSON.stringify(committedBuilder) !== JSON.stringify(rendered.builderConfig)) {
  drift.push(committed.builderConfig)
}
// The product layer ships its own generated identity subset from the same
// single brand source; one gate watches both packages.
const productIdentity = resolve(productRoot, 'src/generated-product-identity.ts')
if (readFileSync(productIdentity, 'utf8') !== renderProductIdentityModule()) {
  drift.push(productIdentity)
}
const productAssets = resolve(productRoot, 'src/generated-brand-assets.ts')
if (readFileSync(productAssets, 'utf8') !== await renderProductBrandAssets()) {
  drift.push(productAssets)
}
if (drift.length > 0) {
  console.error('committed brand build inputs are stale:')
  for (const path of drift) console.error(`  ${path}`)
  console.error('run: corepack pnpm --filter dsh-plugin-desktop generate:brand && corepack pnpm --filter @dofe/dsh-sensteed-product generate:brand')
  process.exitCode = 1
} else {
  console.log('brand build inputs are in sync with brand/brand.config.json.')
}
