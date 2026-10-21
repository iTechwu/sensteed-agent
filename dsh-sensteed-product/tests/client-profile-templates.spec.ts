// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProfileTemplatesSection } from '../src/client/profile-templates.tsx'
import { DOFE_ACCESS_COPY } from '../src/client/dofe-access.ts'
import type { HubInstantiateResult } from '../src/client/hub-setup-state.ts'

const t = (key: keyof typeof DOFE_ACCESS_COPY.en): string => DOFE_ACCESS_COPY.en[key]
const template = {
  id: '11111111-1111-4111-8111-111111111111', key: 'content-creation', revision: 3,
  displayName: '内容创作', description: '一句话介绍', useCases: ['写作', '翻译'], iconKey: 'pen',
  counts: { skills: 2, plugins: 1, mcpEndpoints: 1 }, updatedAt: '2026-10-22T00:00:00.000Z',
}

function jsonResponse(body: unknown): Response {
  // 本机意图通道直接返回 manager 结果，无 {code,data} 信封
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
}

describe('ProfileTemplatesSection', () => {
  const roots: Root[] = []
  afterEach(() => { for (const root of roots.splice(0)) root.unmount(); vi.unstubAllGlobals() })

  async function mount(onRegistered?: (result: HubInstantiateResult) => void): Promise<HTMLElement> {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    roots.push(root)
    await act(async () => root.render(createElement(ProfileTemplatesSection, { t, ...(onRegistered ? { onRegistered } : {}) })))
    return host
  }

  const flush = async (): Promise<void> => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) }) }

  it('lists published templates without an exact-match fetch to per-item endpoints', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/api/desktop/hub/generations/templates')
      return jsonResponse({ list: [template], total: 1 })
    })
    vi.stubGlobal('fetch', fetcher)
    const host = await mount()
    await flush()
    expect(host.textContent).toContain('内容创作')
    // 收起态只展示计数徽标；描述与场景 chips 在展开区
    await act(async () => { host.querySelectorAll<HTMLButtonElement>('.dshHubCardHeading')[0]!.click() })
    await flush()
    expect(host.textContent).toContain('一句话介绍')
    expect(host.textContent).toContain('写作')
  })

  it('renders nothing when no templates are published', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ list: [], total: 0 })))
    const host = await mount()
    await flush()
    expect(host.querySelector('section')).toBeNull()
  })

  it('creates with a trimmed name, surfaces registration and notifies the parent', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/instantiate')) {
        expect(JSON.parse(String(init?.body))).toEqual({ templateId: template.id, profileName: '内容创作' })
        return jsonResponse({
          profileId: '55555555-5555-4555-8555-555555555555', templateId: template.id, revision: 3,
          profileName: '内容创作', items: [], mcpEndpoints: [], skippedItems: [], entries: [],
        })
      }
      return jsonResponse({ list: [template], total: 1 })
    })
    vi.stubGlobal('fetch', fetcher)
    const onRegistered = vi.fn()
    const host = await mount(onRegistered)
    await flush()
    await act(async () => { host.querySelectorAll<HTMLButtonElement>('.dshHubCardHeading')[0]!.click() })
    const input = host.querySelector<HTMLInputElement>('input[type="text"]')!
    await act(async () => {
      // React 受控输入：须用原型 setter 赋值再派发 input 事件
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '  内容创作  ')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { host.querySelector<HTMLButtonElement>('.dshHubSecondary')!.click() })
    await flush()
    expect(host.textContent).toContain(t('templateRegistered'))
    expect(onRegistered).toHaveBeenCalledOnce()
  })
})
