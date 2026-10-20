// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { HubContext, createHubNavigation, nativeHubNavigation } from '../src/client/HubNavigation.tsx'

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

it('reads a real method-bound settings scope when mounting the context', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  class Scope {
    store = { value: undefined }
    getSnapshot() { return this.store }
    subscribe(_listener: () => void) { expect(this.store).toBeDefined(); return () => {} }
  }
  const container = document.createElement('div'), root = createRoot(container)
  try {
    await act(async () => root.render(createElement(HubContext, { kind: 'plugin', navigation: createHubNavigation(), settingsScope: new Scope() as never, selectPanel: vi.fn(), create: async () => {} })))
    expect(container.textContent).toContain('发现与安装')
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals() }
})

it('selects a specific built-in capability rather than opening the whole installed list', () => {
  const navigation = createHubNavigation()
  navigation.openPlugin('finance')
  expect(navigation.getSnapshot()).toBe('installed')
  expect(navigation.selectedPlugin.getSnapshot()).toBe('finance')
  navigation.select('installed')
  expect(navigation.selectedPlugin.getSnapshot()).toBeNull()
  const setView = vi.fn(), setTab = vi.fn()
  const native = nativeHubNavigation({ getSnapshot: () => ({ tab: 'installed', view: { kind: 'item', id: 'dofe-finance' } }), subscribe: () => () => {}, actions: { setTab, setView } })
  expect(native.selectedPlugin.getSnapshot()).toBe('finance')
  native.openPlugin('knowledge')
  expect(setView).toHaveBeenCalledWith({ kind: 'item', id: 'dofe-knowledge' })
})

it('exposes Tools categories as individual routes with a shared package entitlement', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const { DOFE_ACCESS_VALIDATION_VERSION } = await import('../src/dofe-plugins.ts')
  const navigation = createHubNavigation()
  const snapshot = { value: { identity: { ssoSub: 'review' }, setupComplete: true, validationVersion: DOFE_ACCESS_VALIDATION_VERSION, enabledPlugins: ['tools'], entitlements: { plugins: ['tools'] } } }
  const container = document.createElement('div'), root = createRoot(container)
  try {
    await act(async () => root.render(createElement(HubContext, { kind: 'plugin', navigation, settingsScope: { getSnapshot: () => snapshot, subscribe: () => () => {} } as never, selectPanel: vi.fn(), create: async () => {} })))
    const choice = [...container.querySelectorAll('button')].find(button => button.textContent === '热点检索与事件')!
    expect(choice).toBeDefined()
    expect(container.textContent).toContain('供应链与企业')
    expect([...container.querySelectorAll('button')].some(button => button.textContent === 'DoFe Tools')).toBe(false)
    await act(async () => choice.click())
    expect(navigation.selectedPlugin.getSnapshot()).toBe('tools-svc-research-hotspots')
    expect(choice.getAttribute('aria-current')).toBe('page')
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals() }
})
