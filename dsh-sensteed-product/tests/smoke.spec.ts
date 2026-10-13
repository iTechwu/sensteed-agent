import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PRODUCT_PACKAGE_NAME } from '../src/index.ts'

describe('product package skeleton', () => {
  it('declares the launcher-owned bundle contract', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as {
      name: string
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.name).toBe(PRODUCT_PACKAGE_NAME)
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
  })
})
