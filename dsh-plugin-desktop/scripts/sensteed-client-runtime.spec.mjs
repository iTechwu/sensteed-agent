import assert from 'node:assert/strict'
import test from 'node:test'

import { smokeSensteedClientBundle } from './sensteed-client-runtime.mjs'

function bundle(id, applyBody) {
  return `window.__ModuleLoader__.load({
    id: ${JSON.stringify(id)},
    factory: () => ({
      apply(ctx) { ${applyBody} },
      inject: ['slots', 'locale'],
    }),
  })`
}

test('executes client effects and slot registrations', async () => {
  const pluginId = '@dofe/dsh-sensteed-fixture'
  const result = await smokeSensteedClientBundle({
    pluginId,
    clientPath: '/virtual/sensteed-fixture/client.js',
    source: bundle(pluginId, `
      ctx.effect(() => {
        const style = document.createElement('style')
        style.textContent = '.fixture{display:block}'
        document.head.appendChild(style)
        return () => style.remove()
      }, 'fixture styles')
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay' }, () => null))
    `),
  })

  assert.deepEqual(result.effects, ['fixture styles'])
  assert.deepEqual(result.slots, ['shell.overlay'])
  assert.deepEqual(result.styles, ['.fixture{display:block}'])
})

test('reports an undefined value inside an apply effect with plugin context', async () => {
  const pluginId = '@dofe/dsh-sensteed-broken'
  await assert.rejects(
    smokeSensteedClientBundle({
      pluginId,
      clientPath: '/virtual/sensteed-broken/client.js',
      source: bundle(pluginId, `
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = missingCss
          document.head.appendChild(style)
        }, 'broken styles')
      `),
    }),
    new RegExp(`${pluginId}: effect "broken styles" failed: missingCss is not defined`),
  )
})

test('rejects a bundle that registers a different plugin id', async () => {
  await assert.rejects(
    smokeSensteedClientBundle({
      pluginId: '@dofe/dsh-sensteed-expected',
      clientPath: '/virtual/sensteed-wrong/client.js',
      source: bundle('@dofe/dsh-sensteed-wrong', ''),
    }),
    /registered unexpected id @dofe\/dsh-sensteed-wrong/,
  )
})
