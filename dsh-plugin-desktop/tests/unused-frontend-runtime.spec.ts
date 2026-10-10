import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { finished } from 'node:stream/promises'
import { createPackage, uncache } from '@electron/asar'
import { describe, expect, it } from 'vitest'
import { referencesPrunedFrontendPackage, verifyUnusedFrontendRuntime } from '../scripts/unused-frontend-runtime.ts'

describe('unused frontend dependency artifact guard', () => {
  it('distinguishes embedded bundle comments from real resolver inputs', () => {
    expect(referencesPrunedFrontendPackage('// node_modules/react-icons/si/index.mjs\nexport const Icon = () => null')).toBeUndefined()
    for (const source of [
      'import { Icon } from "react-icons/si"',
      'require("react-icons")',
      'import(`react-icons/${family}`)',
      'resolve("react-\\x69cons/si")',
    ]) expect(referencesPrunedFrontendPackage(source)).toBe('react-icons')
  })

  it('checks real archive bytes and rejects new externalization or retained unused code', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sensteed-unused-frontend-'))
    try {
      const source = join(root, 'source')
      mkdirSync(source)
      for (const [index, code] of ['// react-icons bundled\nexport const Icon = 1',
        'export { Icon } from "react-icons/si"'].entries()) {
        writeFileSync(join(source, 'client.js'), code)
        const archive = join(root, `${index}.asar`)
        await finished(await createPackage(source, archive))
        if (index === 0) expect(() => verifyUnusedFrontendRuntime(archive)).not.toThrow()
        else expect(() => verifyUnusedFrontendRuntime(archive)).toThrow('restore its packaging rule')
        uncache(archive)
      }
      mkdirSync(join(source, 'node_modules/react-icons'), { recursive: true })
      writeFileSync(join(source, 'client.js'), 'export const Icon = 1')
      writeFileSync(join(source, 'node_modules/react-icons/index.js'), 'export const unused = 1')
      const archive = join(root, 'unused.asar')
      await finished(await createPackage(source, archive))
      expect(() => verifyUnusedFrontendRuntime(archive)).toThrow('unused frontend code remains')
      uncache(archive)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
