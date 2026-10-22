/** Run the actual preload bridge against an IPC fixture, without a browser or Electron launch. */
import { afterEach, expect, it, vi } from 'vitest'
import { IPC } from '../src/ipc.ts'
const fixture = vi.hoisted(() => ({
  exposed: new Map<string, any>(),
  invoke: vi.fn(),
}))
vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld(name: string, value: unknown) {
      fixture.exposed.set(name, value)
    },
  },
  ipcRenderer: { invoke: fixture.invoke },
  webUtils: { getPathForFile: () => '' },
}))
vi.mock('../src/preload-platform.ts', () => ({ markDocumentPlatform() {} }))
vi.mock('../src/preload-theme.ts', () => ({ syncNativeTheme() {} }))
vi.mock('../src/preload-windows.ts', () => ({ syncWindowsAppearance() {} }))
vi.mock('../src/preload-material.ts', () => ({ syncWindowMaterial() {} }))
vi.mock('../src/preload-locale.ts', () => ({ syncNativeLocale() {} }))
vi.mock('../src/preload-permissions.ts', () => ({
  permissionBridge: () => ({}),
}))
vi.mock('../src/preload-settings.ts', () => ({ onOpenSettings() {} }))
vi.mock('../src/preload-keyboard.ts', () => ({
  createDesktopKeyboardBridge: () => ({}),
}))
vi.mock('../src/preload-browser.ts', () => ({
  createDesktopBrowserBridge: () => ({}),
}))
afterEach(() => {
  vi.unstubAllGlobals()
  fixture.exposed.clear()
  fixture.invoke.mockReset()
  vi.resetModules()
})

it('never replaces one document capability when ready is called again after the Host changed', async () => {
  vi.stubGlobal('location', { protocol: 'dsh-app:', hostname: 'app' })
  let boots = 0
  fixture.invoke.mockImplementation(async (channel: string) =>
    channel === IPC.boot
      ? { hubDocumentNonce: ++boots === 1 ? 'document-a' : 'document-b' }
      : undefined,
  )
  await import('../src/preload-app.ts')
  await fixture.exposed.get('dshDesktopBoot').ready()
  await fixture.exposed.get('dshDesktopBoot').ready()
  await fixture.exposed.get('desktopNext').reportHubHealthy()
  expect(
    fixture.invoke.mock.calls.filter(([channel]) => channel === IPC.boot),
  ).toHaveLength(1)
  expect(fixture.invoke).toHaveBeenLastCalledWith(
    'dsh-next:hub-renderer-healthy',
    'document-a',
  )
})
