import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_BOOT_SPLASH_ID,
  DESKTOP_BOOT_SPLASH_LEAVING,
  DESKTOP_BOOT_SPLASH_MAX_LIFETIME_MS,
  dismissBootSplash,
  installBootSplash,
} from '../src/boot-splash.ts'
import { dismissBootSplashWhenSurfacesReady } from '../src/client/boot-splash-dismiss.ts'

interface FakeElement {
  id: string
  textContent: string
  attributes: Map<string, string>
  parent: FakeElement | null
  children: FakeElement[]
  getElementById?(id: string): FakeElement | null
  appendChild(child: FakeElement): void
  setAttribute(name: string, value: string): void
  getAttribute(name: string): string | null
  remove(): void
}

function makeElement(): FakeElement {
  const element: FakeElement = {
    id: '',
    textContent: '',
    attributes: new Map(),
    parent: null,
    children: [],
    appendChild(child) {
      child.parent = element
      element.children.push(child)
    },
    setAttribute(name, value) { element.attributes.set(name, value) },
    getAttribute(name) { return element.attributes.get(name) ?? null },
    remove() {
      if (element.parent === null) return
      const siblings = element.parent.children
      const at = siblings.indexOf(element)
      if (at >= 0) siblings.splice(at, 1)
      element.parent = null
    },
  }
  return element
}

/** Root holding an id index that tracks appended children, like a live document. */
function makeRoot(): FakeElement {
  const root = makeElement()
  const byId = new Map<string, FakeElement>()
  root.getElementById = (id: string) => byId.get(id) ?? null
  const appendChild = root.appendChild.bind(root)
  root.appendChild = (child: FakeElement) => {
    appendChild(child)
    if (child.id !== '') byId.set(child.id, child)
  }
  return root
}

function stubDocument() {
  const head = makeRoot()
  const body = makeRoot()
  vi.stubGlobal('document', {
    head,
    body,
    documentElement: makeElement(),
    getElementById: (id: string) => head.getElementById!(id) ?? body.getElementById!(id),
    createElement: () => makeElement(),
  })
  return { head, body }
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('boot splash', () => {
  it('installs one styled overlay carrying the brand name and a lifetime cap', () => {
    vi.useFakeTimers()
    const { head, body } = stubDocument()
    installBootSplash('山子Agent')

    expect(head.children).toHaveLength(1)
    expect(body.children).toHaveLength(1)
    const splash = body.children[0]!
    expect(splash.id).toBe(DESKTOP_BOOT_SPLASH_ID)
    expect(splash.children[0]?.textContent).toContain('山子Agent')

    // Re-running the preload against the same document must stay one splash.
    installBootSplash('山子Agent')
    expect(body.children).toHaveLength(1)

    // The lifetime cap dismisses a splash the client never dismissed.
    vi.advanceTimersByTime(DESKTOP_BOOT_SPLASH_MAX_LIFETIME_MS + 1)
    expect(splash.getAttribute(DESKTOP_BOOT_SPLASH_LEAVING)).toBe('true')
  })

  it('fades out once on dismissal and ignores later calls during the fade', () => {
    vi.useFakeTimers()
    const { body } = stubDocument()
    installBootSplash('山子Agent')
    const splash = body.children[0]!

    dismissBootSplash()
    expect(splash.getAttribute(DESKTOP_BOOT_SPLASH_LEAVING)).toBe('true')
    expect(splash.parent).not.toBeNull()

    dismissBootSplash()
    vi.advanceTimersByTime(300)
    expect(splash.parent).toBeNull()
  })

  it('is inert without a document', () => {
    vi.stubGlobal('document', undefined)
    expect(() => installBootSplash('山子Agent')).not.toThrow()
    expect(() => dismissBootSplash()).not.toThrow()
  })
})

describe('boot splash dismissal', () => {
  it('waits for readiness, then dismisses after two animation frames', () => {
    vi.useFakeTimers()
    stubDocument()
    installBootSplash('山子Agent')
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    let missing: string | undefined = 'main:conversation'
    dismissBootSplashWhenSurfacesReady(() => missing)

    vi.advanceTimersByTime(500)
    expect(frames).toHaveLength(0)

    missing = undefined
    vi.advanceTimersByTime(200)
    expect(frames).toHaveLength(1)
    frames[0]!(performance.now())
    expect(frames).toHaveLength(2)
    frames[1]!(performance.now())
    expect(document.getElementById(DESKTOP_BOOT_SPLASH_ID)?.getAttribute(DESKTOP_BOOT_SPLASH_LEAVING)).toBe('true')
  })

  it('stops polling at the deadline and leaves the splash lifetime cap in charge', () => {
    vi.useFakeTimers()
    stubDocument()
    const readiness = vi.fn(() => 'sidebar.workspaces')
    dismissBootSplashWhenSurfacesReady(readiness, 1_000)

    vi.advanceTimersByTime(5_000)
    const polls = readiness.mock.calls.length
    expect(polls).toBeGreaterThan(0)
    expect(polls).toBeLessThan(25)

    vi.advanceTimersByTime(30_000)
    expect(readiness.mock.calls.length).toBe(polls)
  })
})

type FrameRequestCallback = (time: number) => void
