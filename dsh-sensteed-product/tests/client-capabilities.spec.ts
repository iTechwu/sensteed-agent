// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { DofeAccessSection } from '../src/client/DofeAccessSection.tsx'
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
    describe: async () => ({ ok: true, value: { namespaces: ['dofe-access', 'llm-pi-ai', 'agent-default-model'].map(ns => ({ ns, revision: 1 })) } }),
    mutate: vi.fn(async (ns: string, ops: Array<{ path: string[]; value: unknown }>) => {
      if (ns === 'dofe-access') update(Object.fromEntries(ops.map(op => [op.path[0], op.value])))
      return { ok: true }
    }),
  }
  const props = {
    settingsApi, settingsScope: { getSnapshot: () => snapshot, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) } },
    credentials: { describe: async () => ({ ok: true, value: { MODELS_API_KEY: { configured: true } } }) },
    t: (key: keyof typeof DOFE_ACCESS_COPY.zh) => DOFE_ACCESS_COPY.zh[key],
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const card = (name: string) => [...container.querySelectorAll('.dshDofeAccessCapability')].find(node => node.textContent?.includes(name))!
  const checkbox = (name: string) => card(name).querySelector('input') as HTMLInputElement
  const refresh = () => [...container.querySelectorAll('button')].find(button => button.textContent === '刷新权限')!
  try {
    await act(async () => root.render(createElement(DofeAccessSection, props as never)))
    expect([...container.querySelectorAll('h4')].map(node => node.textContent)).toEqual(['检索与调研', '内容创作', '协作与素材', '知识与经营分析'])
    expect(card('人才发现').querySelector('input')).toBeNull()
    expect(card('图片生成').textContent).toContain('默认启用')
    expect(checkbox('财务经营分析').disabled).toBe(true)
    expect(card('财务经营分析').textContent).toContain('权限暂时无法确认')
    expect(checkbox('供应商情报与风险').disabled).toBe(false)
    await act(async () => checkbox('供应商情报与风险').click())
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
    refreshFails = true
    await act(async () => refresh().click())
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('权限刷新失败，请稍后重试。')
    expect(checkbox('财务经营分析').checked).toBe(true)
  } finally { await act(async () => root.unmount()); container.remove() }
})
