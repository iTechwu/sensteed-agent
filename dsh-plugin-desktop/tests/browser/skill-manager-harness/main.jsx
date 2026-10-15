import React from 'react'
import { createRoot } from 'react-dom/client'
import { Modal } from '../../../../deepseek-harness/packages/client/ui-primitives/src/Modal.tsx'
import { Menu, MenuItemButton } from '../../../../deepseek-harness/packages/client/ui-primitives/src/Menu.tsx'
import * as icons from '../../../../deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx'
import '../../../../deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css'
import '../../../../deepseek-harness/packages/client/ui-theme/src/styles/base.css'
import '../../../../deepseek-harness/packages/client/ui-theme/src/styles/gradient-shadow-text.css'

// Run the installed file dependency with the real shared menu/modal components.
let plugin
window.__ModuleLoader__ = { load(definition) {
  plugin = definition.factory(name => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Modal, Menu, MenuItemButton, ...icons }
    throw new Error(`Unexpected dependency: ${name}`)
  })
} }
new Function(await fetch('/__skill_source__').then(response => response.text()))()
delete window.__ModuleLoader__

let dictionary, Page, pageProps
window.skillEvents = []
const services = {
  workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'workspace-fixture' }] }) } },
  sessions: {
    async create(options) {
      window.skillEvents.push({ type: 'create', options })
      if (window.failSkillCreation) throw new Error('fixture creation failure')
      return 'skill-session-fixture'
    },
    retain(id) {
      return {
        ready: Promise.resolve({ session: { async prompt(messages, mode) {
          window.skillEvents.push({ type: 'prompt', id, messages, mode })
          return { ok: true }
        } } }),
        release() { window.skillEvents.push({ type: 'release', id }) },
      }
    },
  },
  uiWorkspace: { openSession(id) {
    window.skillEvents.push({ type: 'open', id })
    window.dispatchEvent(new CustomEvent('skill-session-open', { detail: id }))
  } },
}
const context = {
  get: name => services[name],
  effect: setup => setup(),
  locale: {
    register(_namespace, values) { dictionary = values.zh; return () => {} },
    bind: () => (key, values = {}) => Object.entries(values).reduce((copy, [name, value]) => copy.replace(`{${name}}`, value), dictionary[key] ?? key),
  },
  slots: {
    inject: (_name, setup) => setup(),
    register(spec, component) { if (spec.name === 'main') { Page = component; pageProps = spec.inject() } return () => {} },
  },
}
plugin.apply(context)
function Frame() {
  const [session, setSession] = React.useState(null)
  React.useEffect(() => {
    const open = event => setSession(event.detail)
    window.addEventListener('skill-session-open', open)
    return () => window.removeEventListener('skill-session-open', open)
  }, [])
  return <div className="shell">
    <aside><strong>哪吒 Agent</strong><p>＋ 新会话</p><p>插件</p><p className="active">技能管理</p><p>自动化任务</p></aside>
    {session ? <main className="conversation"><h2>创建技能</h2><p>技能引导会话已打开</p></main> : <Page {...pageProps} />}
  </div>
}
createRoot(document.getElementById('root')).render(<Frame />)
