import { expect, it } from 'vitest'
import { pluginPresentations } from '../src/plugin-presentations.ts'
import { dofePluginsForBrand } from '../src/dofe-plugins.ts'

it('covers every Tools connection once or through an explicit shared source while preserving the package gate', () => {
  const entries = pluginPresentations('sensteed')
  const tools = entries.filter(entry => entry.plugin.id === 'tools')
  expect(tools).toHaveLength(10)
  expect(new Set(entries.map(entry => entry.key)).size).toBe(entries.length)
  expect(new Set(tools.flatMap(entry => entry.plugin.servers))).toEqual(new Set(dofePluginsForBrand('sensteed').find(plugin => plugin.id === 'tools')!.servers))
  expect(tools.every(entry => entry.plugin.access === 'business' && entry.plugin.builtIn === false)).toBe(true)
  expect(tools.some(entry => entry.key === 'tools')).toBe(false)
})
