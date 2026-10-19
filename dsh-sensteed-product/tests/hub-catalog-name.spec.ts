import { describe, expect, it } from 'vitest'
import { catalogDisplayName } from '../src/client/HubCatalog.tsx'

describe('catalog display titles', () => {
  it('uses business labels only for known plugin fallback IDs', () => {
    expect(catalogDisplayName({ kind: 'plugin', itemId: 'dsh-sensteed-finance', displayName: 'dsh-sensteed-finance' })).toBe('财务管理')
    expect(catalogDisplayName({ kind: 'plugin', itemId: 'dsh-sensteed-finance', displayName: '团队预算中心' })).toBe('团队预算中心')
    expect(catalogDisplayName({ kind: 'skill', itemId: 'dsh-sensteed-finance', displayName: 'dsh-sensteed-finance' })).toBe('dsh-sensteed-finance')
    expect(catalogDisplayName({ kind: 'plugin', itemId: 'custom', displayName: 'custom' })).toBe('custom')
  })
})
