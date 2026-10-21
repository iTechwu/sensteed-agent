// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopVersionsSection, type DesktopVersionsSectionProps } from '../src/client/DesktopVersionsSection.tsx'
import { zh } from '../src/client/desktop-settings-locales.ts'

let root: Root | undefined
let container: HTMLDivElement | undefined

async function mount(
  checkForUpdates: () => Promise<void>,
  inspectUpdates?: () => Promise<import('../src/update-status.ts').DesktopUpdateStatus>,
): Promise<HTMLDivElement> {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const props = {
    t: (key: keyof typeof zh) => zh[key],
    api: { checkForUpdates, inspectUpdates },
    version: '2.0.3',
  } as unknown as DesktopVersionsSectionProps
  await act(async () => { root!.render(createElement(DesktopVersionsSection, props)) })
  return container
}

function updateSection(node: HTMLElement): HTMLElement | null {
  return node.querySelector<HTMLElement>('[aria-labelledby="dsh-desktop-updates-title"]')
}

function updateButton(section: HTMLElement): HTMLButtonElement {
  return section.querySelector<HTMLButtonElement>('button')!
}

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  vi.unstubAllGlobals()
})

describe('Versions settings section', () => {
  it('shows the section header, installed version, and runs the interactive update flow', async () => {
    const check = vi.fn(async () => {})
    const node = await mount(check)
    expect(node.textContent).toContain(zh.versionsTitle)
    expect(node.textContent).toContain(zh.versionsIntro)
    const section = updateSection(node)
    expect(section).not.toBeNull()
    expect(section!.textContent).toContain(zh.updatesTitle)
    expect(section!.textContent).toContain(zh.currentVersion)
    expect(section!.textContent).toContain('v2.0.3')
    const button = updateButton(section!)
    expect(button.textContent).toBe(zh.checkForUpdates)

    await act(async () => { button.click() })

    expect(check).toHaveBeenCalledOnce()
    expect(button.disabled).toBe(false)
    expect(updateButton(updateSection(node)!).textContent).toBe(zh.checkForUpdates)
  })

  it('reports a failed check inline and keeps the installed version visible', async () => {
    const node = await mount(async () => { throw new Error('offline') })
    const section = updateSection(node)!

    await act(async () => { updateButton(section).click() })

    expect(section.querySelector('[role="alert"]')?.textContent).toBe(zh.checkForUpdatesError)
    expect(section.textContent).toContain('v2.0.3')
  })

  it('shows unpublished channel inline and retries without native dialogs', async () => {
    const check = vi.fn(async () => {})
    const inspect = vi.fn(async () => ({ status: 'failed' as const, channel: 'beta' as const,
      failure: 'unpublished' as const, checkedAt: '2026-10-20T06:00:00Z' }))
    const node = await mount(check, inspect)
    await act(async () => { updateButton(updateSection(node)!).click() })
    expect(node.textContent).toContain(zh.updateUnpublished)
    expect(node.textContent).toContain(zh.updateBeta)
    expect(node.querySelector('time')?.dateTime).toBe('2026-10-20T06:00:00Z')
    expect(check).not.toHaveBeenCalled()
    expect(node.querySelector('[role="alert"]')).toBeNull()
    await act(async () => { updateButton(updateSection(node)!).click() })
    expect(inspect).toHaveBeenCalledTimes(2)
  })

  it('offers download only after discovery and prevents duplicate pending checks', async () => {
    const check = vi.fn(async () => {})
    let complete!: (value: import('../src/update-status.ts').DesktopUpdateStatus) => void
    const inspect = vi.fn(() => new Promise<import('../src/update-status.ts').DesktopUpdateStatus>(resolve => { complete = resolve }))
    const node = await mount(check, inspect)
    const section = updateSection(node)!
    await act(async () => { updateButton(section).click(); updateButton(section).click() })
    expect(inspect).toHaveBeenCalledOnce()
    expect(updateButton(section).disabled).toBe(true)
    await act(async () => { complete({ status: 'update-available', channel: 'beta', latestVersion: '0.2.1-rc.2-beta.202610201500', checkedAt: '2026-10-20T06:00:00Z' }) })
    expect(section.textContent).toContain('0.2.1-rc.2-beta.202610201500')
    const download = [...section.querySelectorAll('button')].find(button => button.textContent === zh.updateDownload)!
    expect(check).not.toHaveBeenCalled()
    await act(async () => { download.click() })
    expect(check).toHaveBeenCalledOnce()
  })
})
