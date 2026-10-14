// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import React, { act, createElement, type ComponentType, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

let root: Root | undefined
let container: HTMLDivElement
const disposers: Array<() => void> = []

async function mountFinance() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  const slots = new Map<string, ComponentType<{ wide: boolean; t: (key: string) => string }>>()
  let plugin!: { apply(ctx: unknown): void }
  const primitives = new Proxy({}, { get: (_target, key) => key === 'Tooltip'
    ? (props: { children: ReactNode }) => props.children : () => createElement('span') })
  vi.stubGlobal('__ModuleLoader__', { load(definition: { factory(require: (name: string) => unknown): typeof plugin }) {
    plugin = definition.factory(name => {
      if (name === 'react') return React
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
      throw new Error(`Unexpected dependency: ${name}`)
    })
  } })
  // Exercise the shipped snapshot through its actual browser module wrapper.
  new Function(readFileSync(resolve(process.cwd(), '../.ci/dsh-sensteed-finance/lib/client.js'), 'utf8'))()
  plugin.apply({
    effect(setup: () => () => void) { disposers.push(setup()) },
    locale: { register: () => () => {}, bind: () => (key: string) => key },
    slots: {
      inject: (_name: string, setup: () => void) => setup(),
      register: (options: { name: string }, component: ComponentType<{ wide: boolean; t: (key: string) => string }>) => slots.set(options.name, component),
    },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(createElement(slots.get('sidebar.footer.action')!, { wide: true, t: key => key })))
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  container?.remove()
  disposers.splice(0).reverse().forEach(dispose => dispose?.())
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it.each([401, 503])('recovers the finance entry after an initial HTTP %i without reloading', async status => {
  let ready = false
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(ready ? { ok: true, allowed: true } : { ok: false }, { status: ready ? 200 : status })))
  await mountFinance()
  expect(container.querySelector('button')).toBeNull()
  ready = true
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
  expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('open')
})

it('rechecks on focus, preserves access during outages and removes revoked access', async () => {
  let status = 200
  let allowed = true
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: status === 200, allowed }, { status })))
  await mountFinance()
  expect(container.querySelector('button')).not.toBeNull()
  status = 503
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(container.querySelector('button')).not.toBeNull()
  status = 200
  allowed = false
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(container.querySelector('button')).toBeNull()
  allowed = true
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
  expect(container.querySelector('button')).not.toBeNull()
})

it('aborts outstanding permission checks when the entry unmounts', async () => {
  let signal: AbortSignal | undefined
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
    signal = init.signal as AbortSignal
    return new Promise<Response>((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('aborted'))))
  }))
  await mountFinance()
  expect(signal?.aborted).toBe(false)
  await act(async () => { root!.unmount(); root = undefined })
  expect(signal?.aborted).toBe(true)
})

it.each([401, 403])('removes a previously authorized entry on HTTP %i', async revokedStatus => {
  let status = 200
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: status === 200, allowed: true }, { status })))
  await mountFinance()
  expect(container.querySelector('button')).not.toBeNull()
  status = revokedStatus
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(container.querySelector('button')).toBeNull()
})
