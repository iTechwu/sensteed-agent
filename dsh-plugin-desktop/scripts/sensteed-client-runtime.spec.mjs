import assert from 'node:assert/strict'
import test from 'node:test'

import { smokeSensteedClientBundle } from './sensteed-client-runtime.mjs'

function bundle(id, applyBody) {
  return `window.__ModuleLoader__.load({
    id: ${JSON.stringify(id)},
    factory: require => ({
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
      ctx.effect(() => {
        const node = document.createElement('div')
        node.id = 'fixture-notice'
        document.body.append(node)
        if (document.body.children[0] !== node || document.getElementById('fixture-notice') !== node) throw Error('notice not attached')
        const root = require('react-dom/client').createRoot(node)
        root.render(require('react-dom').createPortal({ type: 'notice' }, document.body))
        return () => {
          root.unmount()
          node.remove()
          if (document.body.children.length || document.getElementById('fixture-notice')) throw Error('notice not removed')
        }
      }, 'fixture notice')
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay' }, () => null))
    `),
  })

  assert.deepEqual(result.effects, ['fixture styles', 'fixture notice'])
  assert.equal(result.roots, 1)
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
  await assert.rejects(smokeSensteedClientBundle({
    pluginId,
    clientPath: '/virtual/sensteed-broken/client.js',
    source: bundle(pluginId, `ctx.effect(() => {
      const node = document.createElement('div')
      document.body.append(node)
      const root = require('react-dom/client').createRoot(node)
      root.render({})
      return () => root.unmount()
    }, 'leaking notice')`),
  }), /client React root was not rendered, unmounted and detached/)

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
