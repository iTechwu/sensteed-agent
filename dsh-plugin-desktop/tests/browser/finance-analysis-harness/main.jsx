import React from 'react'
import { createRoot } from 'react-dom/client'
const source = await fetch('/__finance_source__').then(response => response.text())
let plugin, dictionaries, selectedPanel = null
const panelListeners = new Set()
const components = new Map()
const layout = { selectPanel(value) { selectedPanel = value; panelListeners.forEach(listener => listener()) } }
const skillNames = ['finance-monthly-risk', 'finance-cost-structure', 'finance-cash-pressure', 'finance-budget-review', 'finance-revenue-attainment', 'finance-data-quality', 'finance-cost-cash-forecast', 'finance-budget-version-health', 'finance-alert-rules-audit']
window.analysisFixture = { created: [], sent: [], opened: [], openAttempts: [], openMode: 'ready', catalogMode: 'ready', sendMode: 'ready' }
const fixture = window.analysisFixture
window.__ModuleLoader__ = { load(definition) { plugin = definition.factory(name => {
  if (name === 'react') return React
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return new Proxy({}, { get: (_target, key) => key === 'Tooltip' ? props => props.children : () => <span aria-hidden="true">◈</span> })
  throw new Error('Unknown dependency: ' + name)
}) } }
new Function(source)()
const sessions = {
  create: async () => { const id = 'analysis-' + (fixture.created.length + 1); fixture.created.push(id); return id },
  using: async (_id, _options, run) => run({ ready: Promise.resolve() }),
  scope: id => ({ get: name => name === 'conversation' ? { send: async prompt => {
    if (fixture.sendMode === 'rejected') throw new Error('synthetic transport rejection')
    fixture.sent.push({ id, prompt })
    if (fixture.sendMode === 'pending') await new Promise(resolve => { fixture.finishSend = resolve })
  } } : undefined }),
}
const skills = { list: async ({ sessionId }) => {
  if (!fixture.created.includes(sessionId)) throw new Error('incorrect session catalog')
  if (fixture.catalogMode === 'failed') return { ok: false }
  return { ok: true, value: { skills: fixture.catalogMode === 'missing' ? [] : skillNames.map(name => ({ name })) } }
} }
plugin.apply({
  effect: setup => setup(),
  get: name => name === 'sessions' ? sessions : name === 'remote.skills' ? skills : name === 'uiWorkspace' ? { async openSession(id) { fixture.openAttempts.push(id); await Promise.resolve(); if (fixture.openMode === 'failed') throw new Error('synthetic navigation failure'); fixture.opened.push(id); layout.selectPanel(null) } } : undefined,
  layout,
  locale: { register: (_ns, value) => { dictionaries = value }, bind: () => (key, values = {}) => (dictionaries.zh?.[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '') },
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
