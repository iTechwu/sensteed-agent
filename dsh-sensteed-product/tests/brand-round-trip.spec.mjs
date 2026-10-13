import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { renderProductIdentityModule } from '../scripts/generate-brand-module.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('product identity render follows an alternative brand config', () => {
  const configDir = mkdtempSync(join(tmpdir(), 'dsh-product-brand-'))
  try {
    const configPath = join(configDir, 'brand.config.json')
    const config = JSON.parse(readFileSync(join(repositoryRoot, 'brand/brand.config.json'), 'utf8'))
    config.displayName = { ...config.displayName, titlebar: 'Round Trip Agent' }
    writeFileSync(configPath, JSON.stringify(config))
    const rendered = renderProductIdentityModule({ BRAND_CONFIG: configPath })
    assert.match(rendered, /titlebar: "Round Trip Agent"/u)
    assert.doesNotMatch(
      readFileSync(join(repositoryRoot, 'dsh-sensteed-product/src/generated-product-identity.ts'), 'utf8'),
      /Round Trip Agent/u,
    )
  } finally {
    rmSync(configDir, { recursive: true, force: true })
  }
})
