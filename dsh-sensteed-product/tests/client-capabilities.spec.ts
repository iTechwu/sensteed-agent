// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { DofeCapabilitiesSection, DofeUserSection } from '../src/client/DofeAccessSection.tsx'
import { DOFE_ACCESS_COPY } from '../src/client/dofe-access.ts'
import type { DofeAccessSettings } from '../src/dofe-plugins.ts'

vi.mock('../src/generated-product-identity.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/generated-product-identity.ts')>(), BRAND_VARIANT: 'sensteed',
}))
afterEach(() => vi.unstubAllGlobals())

it('shows task groups, refreshes effective grants and saves independently chosen business capabilities', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let snapshot: { value: DofeAccessSettings } = { value: {
    setupComplete: true, validationVersion: 5, authMode: 'feishu', identity: { ssoSub: 'user', name: '管理员' },
    enabledPlugins: ['tools'], modelId: 'model-a', protocol: 'messages',
    entitlements: { plugins: ['tools'], financeAccess: 'unavailable', defaultModel: 'model-a', allowedProtocols: ['messages'] },
  } }
  const listeners = new Set<() => void>()
  const update = (patch: Partial<DofeAccessSettings>) => {
    snapshot = { value: { ...snapshot.value, ...patch } }
    listeners.forEach(listener => listener())
  }
  let refreshFails = false
  let saveFails = false
  const fetcher = vi.fn(async (path: string) => {
    if (path.endsWith('/refresh')) {
      if (refreshFails) return Response.json({ status: 'error' })
      const entitlements = { ...snapshot.value.entitlements!, plugins: ['tools', 'finance'], financeAccess: 'allowed' as const }
      update({ entitlements })
      return Response.json({ status: 'bound', user: { ssoSub: 'user' }, entitlements })
    }
    if (path.endsWith('/validate')) return Response.json({ valid: true })
    return Response.json({ models: [{ id: 'model-a' }] })
  })
  vi.stubGlobal('fetch', fetcher)
  const settingsApi = {
    describe: async () => ({ ok: true, value: { namespaces: ['dofe-access'].map(ns => ({ ns, revision: 1 })) } }),
    mutate: vi.fn(async (ns: string, ops: Array<{ path: string[]; value: unknown }>) => {
      if (saveFails) return { ok: false, error: { message: 'unavailable' } }
      if (ns === 'dofe-access') update(Object.fromEntries(ops.map(op => [op.path[0], op.value])))
      return { ok: true }
    }),
  }
  const props = {
    settingsApi, settingsScope: { getSnapshot: () => snapshot, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) } },
    credentials: { describe: vi.fn(async () => { throw new Error('model service unavailable') }) },
    t: (key: keyof typeof DOFE_ACCESS_COPY.zh) => DOFE_ACCESS_COPY.zh[key],
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const card = (name: string) => [...container.querySelectorAll('.dshDofeAccessCapability')].find(node => node.textContent?.includes(name))!
  const checkbox = (name: string) => card(name).querySelector('input') as HTMLInputElement
  const refresh = () => [...container.querySelectorAll('button')].find(button => button.textContent === '刷新权限')!
  try {
    await act(async () => root.render(createElement(DofeCapabilitiesSection, props as never)))
    expect(fetcher).not.toHaveBeenCalled()
    expect(props.credentials.describe).not.toHaveBeenCalled()
    expect(container.querySelector('#dofe-model-select')).toBeNull()
    expect([...container.querySelectorAll('h4')].map(node => node.textContent)).toEqual(['检索与调研', '内容创作', '协作与素材', '知识与经营分析'])
    const filter = (name: string) => [...container.querySelectorAll('.dshDofeAccessFilters button')].find(button => button.textContent === name) as HTMLButtonElement
    await act(async () => filter('知识与经营分析').click())
    expect(container.querySelectorAll('.dshDofeAccessCapability')).toHaveLength(3)
    expect(container.textContent).not.toContain('人才发现')
    await act(async () => filter('全部能力').click())
    const search = container.querySelector('input[type="search"]') as HTMLInputElement
    const searchFor = async (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, value)
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await searchFor('供应商')
    expect(container.querySelectorAll('.dshDofeAccessCapability')).toHaveLength(1)
    await searchFor('不存在的能力')
    expect(container.textContent).toContain('没有找到匹配的能力')
    await searchFor('')
    expect(card('人才发现').querySelector('input')).toBeNull()
    expect(card('图片生成').textContent).toContain('默认启用')
    expect(checkbox('财务经营分析').disabled).toBe(true)
    expect(card('财务经营分析').textContent).toContain('权限暂时无法确认')
    expect(checkbox('供应商情报与风险').disabled).toBe(false)
    await act(async () => checkbox('供应商情报与风险').click())
    // Sidebar navigation unmounts each page; keep an unsaved draft on return.
    await act(async () => root.render(createElement(DofeUserSection, props as never)))
    expect(container.querySelector('.dshDofeAccessCapabilities')).toBeNull()
    await act(async () => root.render(createElement(DofeCapabilitiesSection, props as never)))
    expect(checkbox('供应商情报与风险').checked).toBe(true)
    expect(container.querySelector('.dshDofeAccessStatus')?.textContent).toBe('有未保存的更改')
    await act(async () => refresh().click())
    expect(checkbox('供应商情报与风险').checked).toBe(true)
    // A delayed settings subscription from the Host must not overwrite the draft.
    await act(async () => update({ enabledPlugins: [...snapshot.value.enabledPlugins] }))
    expect(checkbox('供应商情报与风险').checked).toBe(true)
    expect(checkbox('财务经营分析').disabled).toBe(false)
    expect(card('财务经营分析').textContent).toContain('可启用')
    await act(async () => checkbox('财务经营分析').click())
    await act(async () => (container.querySelector('.dshDofeAccessTools input') as HTMLInputElement).click())
    expect(card('人才发现').textContent).toContain('可启用')
    await act(async () => (container.querySelector('.dshDofeAccessPrimary') as HTMLButtonElement).click())
    expect(snapshot.value.enabledPlugins).toEqual(expect.arrayContaining(['finance', 'supplier-intelligence']))
    expect(snapshot.value.enabledPlugins).not.toContain('tools')
    expect(settingsApi.mutate.mock.calls).toHaveLength(1)
    expect(settingsApi.mutate.mock.calls[0]![0]).toBe('dofe-access')
    expect(settingsApi.mutate.mock.calls[0]![1].map(op => op.path)).toEqual([['enabledPlugins']])
    expect(container.querySelector('.dshDofeAccessStatus')?.textContent).toBe('能力设置已保存')
    expect(snapshot.value.modelId).toBe('model-a')
    expect(fetcher.mock.calls.every(([path]) => path.endsWith('/refresh'))).toBe(true)
    saveFails = true
    await act(async () => checkbox('财务经营分析').click())
    await act(async () => (container.querySelector('.dshDofeAccessPrimary') as HTMLButtonElement).click())
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('能力设置保存失败，请稍后重试。')
    expect(checkbox('财务经营分析').checked).toBe(false)
    expect(snapshot.value.enabledPlugins).toContain('finance')
    await act(async () => checkbox('财务经营分析').click())
    refreshFails = true
    await act(async () => refresh().click())
    expect(container.querySelector('.dshDofeAccessPermissionActions [role="alert"]')?.textContent).toBe('权限刷新失败，请稍后重试。')
    expect(checkbox('财务经营分析').checked).toBe(true)
  } finally { await act(async () => root.unmount()); container.remove() }
})
