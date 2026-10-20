import { expect, it } from 'vitest'
import { pluginPresentations } from '../src/plugin-presentations.ts'
import { dofePluginsForBrand } from '../src/dofe-plugins.ts'
import { TOOL_CAPABILITY_VIEWS } from '../src/generated-tool-views.ts'

it('covers every Tools connection once or through an explicit shared source while preserving the package gate', () => {
  const entries = pluginPresentations('sensteed')
  const tools = entries.filter(entry => entry.plugin.id === 'tools')
  expect(tools).toHaveLength(TOOL_CAPABILITY_VIEWS.length)
  expect(tools.length).toBeGreaterThanOrEqual(30)
  expect(new Set(entries.map(entry => entry.key)).size).toBe(entries.length)
  expect(new Set(tools.flatMap(entry => entry.plugin.servers))).toEqual(new Set(dofePluginsForBrand('sensteed').find(plugin => plugin.id === 'tools')!.servers))
  expect(tools.every(entry => entry.plugin.access === 'business' && entry.plugin.builtIn === false)).toBe(true)
  expect(tools.some(entry => entry.key === 'tools')).toBe(false)
})

it('presents service-group cards with a unique taxonomy identity', () => {
  const tools = pluginPresentations('sensteed').filter(entry => entry.plugin.id === 'tools')
  expect(new Set(TOOL_CAPABILITY_VIEWS.map(view => view.serviceId)).size).toBe(TOOL_CAPABILITY_VIEWS.length)
  expect(new Set(TOOL_CAPABILITY_VIEWS.map(view => view.id)).size).toBe(TOOL_CAPABILITY_VIEWS.length)
  for (const entry of tools) {
    const card = TOOL_CAPABILITY_VIEWS.find(view => view.id === entry.key)!
    expect(card.group).toBeTruthy()
    expect(card.categoryId).toBeTruthy()
    expect(card.tools.length).toBeGreaterThanOrEqual(1)
  }
})
