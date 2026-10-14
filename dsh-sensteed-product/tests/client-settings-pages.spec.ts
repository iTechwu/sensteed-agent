// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { DofeModelSection, DofeUserSection } from '../src/client/DofeAccessSection.tsx'
import { DOFE_ACCESS_COPY } from '../src/client/dofe-access.ts'
import type { DofeAccessSettings } from '../src/dofe-plugins.ts'

vi.mock('../src/generated-product-identity.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/generated-product-identity.ts')>(), BRAND_VARIANT: 'sensteed',
}))
afterEach(() => vi.unstubAllGlobals())

it('separates account and model pages and never replaces capability choices when saving a model', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let snapshot: { value: DofeAccessSettings } = { value: {
    setupComplete: true, validationVersion: 5, authMode: 'feishu', identity: { ssoSub: 'user', name: '管理员', groups: ['admin'], groupNames: { admin: '管理员' } },
    enabledPlugins: ['tools'], modelId: 'saved-model', protocol: 'messages',
    entitlements: { plugins: ['tools', 'finance'], defaultModel: 'tenant-default', allowedProtocols: ['messages'] },
  } }
  const listeners = new Set<() => void>()
  const update = (patch: Partial<DofeAccessSettings>) => {
    snapshot = { value: { ...snapshot.value, ...patch } }
    listeners.forEach(listener => listener())
  }
  let modelFailure = false
  const fetcher = vi.fn(async () => modelFailure
    ? Response.json({}, { status: 503 })
    : Response.json({ models: [{ id: 'tenant-default' }, { id: 'saved-model' }] }))
  vi.stubGlobal('fetch', fetcher)
  const settingsApi = {
    describe: async () => ({ ok: true, value: { namespaces: ['dofe-access', 'llm-pi-ai', 'agent-default-model'].map(ns => ({ ns, revision: 1 })) } }),
    mutate: vi.fn(async (ns: string, ops: Array<{ path: string[]; value?: unknown }>) => {
      if (ns === 'dofe-access') update(Object.fromEntries(ops.map(op => [op.path[0], op.value])))
      return { ok: true }
    }),
  }
  const props = {
    settingsApi, settingsScope: { getSnapshot: () => snapshot, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) } },
    credentials: { describe: vi.fn(async () => ({ ok: true, value: { MODELS_API_KEY: { configured: true } } })) },
    t: (key: keyof typeof DOFE_ACCESS_COPY.zh) => DOFE_ACCESS_COPY.zh[key], close: vi.fn(),
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(DofeUserSection, props as never)))
    expect(container.querySelector('h2')?.textContent).toBe('用户设置')
    expect(container.querySelector('dl')?.textContent).toContain('管理员')
    expect(container.querySelector('#dofe-model-select')).toBeNull()
    expect(container.querySelector('.dshDofeAccessCapabilities')).toBeNull()
    expect(props.credentials.describe).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()

    modelFailure = true
    await act(async () => root.render(createElement(DofeModelSection, props as never)))
    expect(container.querySelector('h2')?.textContent).toBe('模型设置')
    expect(container.querySelector('.dshDofeAccessIdentityCard')).toBeNull()
    expect(container.querySelector('.dshDofeAccessCapabilities')).toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('暂时无法获取')
    expect((container.querySelector('.dshDofeAccessPrimary') as HTMLButtonElement).disabled).toBe(true)
    modelFailure = false
    await act(async () => ([...container.querySelectorAll('button')].find(button => button.textContent === '获取可用模型') as HTMLButtonElement).click())
    expect((container.querySelector('#dofe-model-select') as HTMLSelectElement).value).toBe('saved-model')
    // A separate capabilities editor changes the live document while Models is open.
    await act(async () => update({ enabledPlugins: ['finance', 'supplier-intelligence'] }))
    await act(async () => (container.querySelector('.dshDofeAccessPrimary') as HTMLButtonElement).click())
    expect(settingsApi.mutate.mock.calls.map(([ns]) => ns)).toEqual(['llm-pi-ai', 'agent-default-model', 'dofe-access'])
    expect(settingsApi.mutate.mock.calls.at(-1)![1].some(op => op.path[0] === 'enabledPlugins')).toBe(false)
    expect(snapshot.value.enabledPlugins).toEqual(['finance', 'supplier-intelligence'])
    expect(snapshot.value.modelId).toBe('saved-model')
    expect(props.close).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('模型设置已保存')
  } finally { await act(async () => root.unmount()); container.remove() }
})
