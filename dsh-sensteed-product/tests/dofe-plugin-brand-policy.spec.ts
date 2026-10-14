import { describe, expect, it } from 'vitest'
import { dofePluginsForBrand, normalizeDofePluginIds, dofePluginCanEnable, dofeCapabilitiesForBrand, DOFE_CAPABILITY_GROUPS } from '../src/dofe-plugins.ts'

describe('DoFe brand capability policy', () => {
  it('keeps retired GEO capabilities out of the desktop catalog', () => {
    for (const variant of ['yootun', 'sensteed'] as const) {
      expect(dofePluginsForBrand(variant).map(plugin => plugin.id)).not.toContain('geoflow')
      expect(dofePluginsForBrand(variant).map(plugin => plugin.id)).not.toContain('georank')
    }
  })

  it('keeps the sensteed datasource bundles exclusive to sensteed and marks them built-in', () => {
    const sensteed = dofePluginsForBrand('sensteed')
    const finance = sensteed.find(plugin => plugin.id === 'finance')
    const supplier = sensteed.find(plugin => plugin.id === 'supplier-intelligence')
    expect(finance?.builtIn).toBe(true)
    expect(supplier?.builtIn).toBe(true)
    expect(dofePluginsForBrand('yootun').map(plugin => plugin.id))
      .toEqual(expect.not.arrayContaining(['finance', 'supplier-intelligence']))
  })

  it('removes stale cross-brand selections before activation', () => {
    expect(normalizeDofePluginIds(['geoflow', 'georank', 'openmontage', 'openmontage'], 'sensteed'))
      .toEqual(['openmontage'])
  })
})

it('uses Tools authorization for supplier intelligence, without granting unrelated finance', () => {
  expect(dofePluginCanEnable('supplier-intelligence', 'sensteed', ['tools'])).toBe(true)
  expect(dofePluginCanEnable('supplier-intelligence', 'sensteed', [])).toBe(false)
  expect(dofePluginCanEnable('finance', 'sensteed', ['tools'])).toBe(false)
  expect(dofePluginCanEnable('finance', 'sensteed', ['finance'])).toBe(true)
})
it('covers each Tools domain with task-oriented categories', () => {
  const items = dofeCapabilitiesForBrand('sensteed')
  expect(new Set(items.map(item => item.group))).toEqual(new Set(DOFE_CAPABILITY_GROUPS))
  expect(items.filter(item => item.plugin === 'tools')).toHaveLength(8)
  expect(items.map(item => item.name)).toEqual(expect.arrayContaining(['人才发现', '客户线索发现与监测', '小红书与抖音运营', '文件上传与素材链接']))
})
