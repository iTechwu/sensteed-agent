/** Fail when committed product brand modules drift from brand/brand.config.json. */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderProductBrandAssets, renderProductIdentityModule } from './generate-brand-module.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const committed = {
  identityModule: resolve(packageRoot, 'src/generated-product-identity.ts'),
  brandAssets: resolve(packageRoot, 'src/generated-brand-assets.ts'),
}

const drift = []
if (readFileSync(committed.identityModule, 'utf8') !== renderProductIdentityModule()) {
  drift.push(committed.identityModule)
}
if (readFileSync(committed.brandAssets, 'utf8') !== await renderProductBrandAssets()) {
  drift.push(committed.brandAssets)
}
if (drift.length > 0) {
  console.error('committed product brand modules are stale:')
  for (const path of drift) console.error(`  ${path}`)
  console.error('run: corepack pnpm --filter @dofe/dsh-sensteed-product generate:brand')
  process.exitCode = 1
} else {
  console.log('product brand modules are in sync with brand/brand.config.json.')
}
