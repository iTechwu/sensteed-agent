// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { HubPage } from '../src/client/HubPage.tsx'
import { DOFE_ACCESS_COPY } from '../src/client/dofe-access.ts'
let root: Root | undefined, node: HTMLDivElement
const plugin = { kind: 'plugin', itemId: 'plugin', displayName: 'Finance', version: '1.0', required: false, initialInstall: true, enabled: true, disposition: 'INSTALL', reason: null, bytes: 1 }
const skill = { ...plugin, kind: 'skill', itemId: 'skill', displayName: 'Reporting', required: true }
const check = { channel: 'stable', profileId: 'p', activeGenerationDigest: null, entries: [plugin, skill], activeItems: [] }
afterEach(async () => { await act(async () => root?.unmount()); node?.remove(); vi.unstubAllGlobals() })
async function mount(kind: 'plugin' | 'skill') {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let account: string | undefined = 'alice'
  const listeners = new Set<() => void>()
  const settingsScope = { getSnapshot: () => ({ value: { authMode: 'feishu', identity: { ssoSub: account } } }), subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn) } }
  const create = vi.fn().mockResolvedValue(undefined), loadSkills = vi.fn().mockResolvedValue([{ name: 'my-skill', description: 'Personal skill' }])
  node = document.createElement('div'); document.body.append(node); root = createRoot(node)
  await act(async () => root!.render(createElement(HubPage, { kind, settingsScope: settingsScope as never, t: key => DOFE_ACCESS_COPY.zh[key], subscribeReconnect: () => () => {}, create, loadSkills })))
  return { create, loadSkills, logout() { account = undefined; listeners.forEach(fn => fn()) } }
}
async function click(text: string) { await act(async () => [...node.querySelectorAll('button')].find(button => button.textContent === text)!.click()) }
it('shows separate plugin cards but sends the complete plugin and skill plan after filtering', async () => {
  const fetcher = vi.fn(async (url: string, _options: RequestInit) => Response.json(url.endsWith('/check') ? check : { intentId: 'i', confirmationNonce: 'n', planDigest: 'd', expiresAt: new Date(Date.now() + 300000).toISOString(), items: [], totalBytes: 2 }))
  vi.stubGlobal('fetch', fetcher)
  await mount('plugin')
  expect(node.querySelector('.dshHubCatalog')?.textContent).toContain('Finance')
  expect(node.querySelector('.dshHubCatalog')?.textContent).not.toContain('Reporting')
  const input = node.querySelector<HTMLInputElement>('input[type=search]')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'no matches'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  expect(node.textContent).toContain(DOFE_ACCESS_COPY.zh.catalogNoMatches)
  await click(DOFE_ACCESS_COPY.zh.hubPreview)
  const request = fetcher.mock.calls.find(([url]) => url.endsWith('/preview'))!
  expect(JSON.parse(request[1].body as string).requested.map((entry: { kind: string }) => entry.kind)).toEqual(['plugin', 'skill'])
})
it('opens the real skill catalog and creation callback and clears account-owned content on logout', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(check)))
  const h = await mount('skill')
  expect(node.querySelector('.dshHubCatalog')?.textContent).toContain('Reporting')
  expect(node.querySelector('.dshHubCatalog')?.textContent).not.toContain('Finance')
  await click(DOFE_ACCESS_COPY.zh.localSkillsTab)
  expect(node.textContent).toContain('/my-skill')
  await click(DOFE_ACCESS_COPY.zh.createSkillAction)
  expect(h.create).toHaveBeenCalledOnce()
  await act(async () => h.logout())
  expect(node.textContent).toBe(DOFE_ACCESS_COPY.zh.settingsLoginRequired)
  expect(node.textContent).not.toContain('my-skill')
})
