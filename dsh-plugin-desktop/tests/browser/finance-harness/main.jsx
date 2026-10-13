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
window.analysisPrompts = []
const sessions = {
  list: { getSnapshot: () => ({ ids: ['session-1'] }) },
  retainInfo: () => ({ getSnapshot: () => ({ retainedBy: { mainView: 1 } }) }),
  using: async (_id, _options, run) => run({ ready: Promise.resolve() }),
  scope: () => ({ conversation: { send: async prompt => window.analysisPrompts.push(prompt) } }),
}
plugin.apply({
  effect: setup => setup(),
  get: name => name === 'sessions' ? sessions : name === 'uiWorkspace' ? { openSession() {} } : undefined,
  locale: { register: (_ns, value) => { dictionaries = value }, bind: () => key => dictionaries.zh?.[key] ?? key },
  slots: { inject: (_name, setup) => setup(), register: (options, component) => { components.set(options.name, component) } },
})
const Button = components.get('sidebar.footer.action')
const Overlay = components.get('shell.overlay')
const t = key => dictionaries.zh?.[key] ?? key
createRoot(document.getElementById('root')).render(<><Button wide t={t}/><Overlay t={t}/></>)
