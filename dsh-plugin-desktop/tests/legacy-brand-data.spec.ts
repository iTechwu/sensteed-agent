import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { legacyBrandUserData } from '../src/legacy-brand-data.ts'
describe('brand data compatibility', () => {
  it('prefers data already created under the new name', () => expect(legacyBrandUserData('/new', '/apps', 'beta', () => true)).toBe('/new'))
  it('reuses the old channel data without copying credentials', () => expect(legacyBrandUserData('/new', '/apps', 'beta', p => p === join('/apps', 'Sensteed-Agent Beta'))).toBe(join('/apps', 'Sensteed-Agent Beta')))
  it('ignores an empty directory Electron created before migration', () => expect(legacyBrandUserData('/new', '/apps', 'beta', p => p === '/new' || p === join('/apps', 'Sensteed-Agent Beta'))).toBe(join('/apps', 'Sensteed-Agent Beta')))
  it('uses the new path for a fresh installation', () => expect(legacyBrandUserData('/new', '/apps', 'stable', () => false)).toBe('/new'))
})
