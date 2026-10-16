import React from 'react'
import { createRoot } from 'react-dom/client'
const source = await fetch('/__finance_source__').then(r => r.text())
let plugin
const primitives = new Proxy({}, { get: (_target, key) => key === 'Tooltip' ? props => props.children : () => React.createElement('span', { 'aria-hidden': true }, '◈') })
window.__ModuleLoader__ = { load(definition) { plugin = definition.factory(name => {
  if (name === 'react') return React
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error('Unknown dependency: ' + name)
}) } }
new Function(source)()
const components = new Map()
let dictionaries
let selectedPanel = null
const panelListeners = new Set()
const layout = { selectPanel(value) { selectedPanel = value; panelListeners.forEach(listener => listener()) } }
window.analysisPrompts = []
const sessions = {
  create: async () => 'session-' + (window.analysisPrompts.length + 1),
  list: { getSnapshot: () => ({ ids: ['session-1'] }) },
  retainInfo: () => ({ getSnapshot: () => ({ retainedBy: { mainView: 1 } }) }),
  using: async (_id, _options, run) => run({ ready: Promise.resolve() }),
  scope: () => ({ get: name => name === 'conversation' ? { send: async prompt => window.analysisPrompts.push(prompt) } : undefined }),
}
plugin.apply({
  effect: setup => setup(),
  get: name => name === 'sessions' ? sessions : name === 'uiWorkspace' ? { openSession() { layout.selectPanel(null) } } : undefined,
  layout,
  locale: { register: (_ns, value) => { dictionaries = value }, bind: () => key => dictionaries.zh?.[key] ?? key },
  slots: { inject: (_name, setup) => setup(), register: (options, component) => { components.set(options.name, { component, options }) } },
})
const buttonSlot = components.get('sidebar.footer.action')
const pageSlot = components.get('main')
function Harness() {
  const panel = React.useSyncExternalStore(listener => { panelListeners.add(listener); return () => panelListeners.delete(listener) }, () => selectedPanel)
  return <>
    {React.createElement(buttonSlot.component, { ...buttonSlot.options.inject(), wide: true })}
    {panel === pageSlot.options.key ? React.createElement(pageSlot.component, pageSlot.options.inject()) : null}
  </>
}
createRoot(document.getElementById('root')).render(<Harness />)
