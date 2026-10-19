import { expect, it, vi } from 'vitest'
import { createHubNavigation, nativeHubNavigation } from '../src/client/HubNavigation.tsx'

it('shares catalog selection between the context and the main page and releases subscribers', () => {
  const navigation = createHubNavigation(), listener = vi.fn()
  const off = navigation.subscribe(listener)
  expect(navigation.getSnapshot()).toBe('catalog')
  navigation.select('installed')
  expect(navigation.getSnapshot()).toBe('installed')
  expect(listener).toHaveBeenCalledOnce()
  navigation.select('installed')
  expect(listener).toHaveBeenCalledOnce()
  off(); navigation.select('catalog')
  expect(listener).toHaveBeenCalledOnce()
})

it('routes context choices through the native manager when the legacy page wins', () => {
  const setTab = vi.fn(), setView = vi.fn()
  const navigation = nativeHubNavigation({ getSnapshot: () => ({ tab: 'installed' }), subscribe: () => () => {}, actions: { setTab, setView } })
  expect(navigation.getSnapshot()).toBe('installed')
  navigation.select('catalog')
  expect(setView).toHaveBeenCalledWith({ kind: 'list' })
  expect(setTab).toHaveBeenCalledWith('sensteed-enterprise')
})
