/** Build-time shared source, inlined into each plugin. No loader/package entry. */
function createDesktopNavigationBridge(React) {
  let state = Object.freeze({ status: 'loading', items: [], activeId: null, page: 'overview', attached: false, epoch: 0 })
  let scope = null, route = null, select = null, leave = null, epoch = 0, attached = 0
  let menuScroll = 0
  const fields = new Map()
  let controller = new AbortController()
  const listeners = new Set()
  const emit = patch => {
    const next = { ...state, ...patch }
    if (JSON.stringify(next) === JSON.stringify(state)) return
    state = Object.freeze(next)
    for (const listener of listeners) listener()
  }
  const bridge = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    getSnapshot: () => state,
    get signal() { return controller.signal },
    get epoch() { return epoch },
    remember(value) { if (state.status === 'ready') route = value },
    recall: () => route,
    adoptScope(value) {
      if (typeof value !== 'string' || !value || value === scope) return false
      const changed = scope !== null
      scope = value
      if (changed) bridge.invalidate('loading')
      return changed
    },
    invalidate(status = 'denied') {
      controller.abort(); controller = new AbortController(); epoch++
      route = null; select = null; leave = null; menuScroll = 0; fields.clear()
      emit({ status, items: [], activeId: null, page: 'overview', epoch })
    },
    publish(items, activeId, navigate, guard) {
      if (state.status === 'denied') return
      select = navigate; leave = guard
      emit({ status: 'ready', items: items.map(({ id, label, group }) => ({ id, label, ...(group ? { group } : {}) })), activeId })
    },
    clearSource() { select = null; leave = null; emit({ status: state.status === 'denied' ? 'denied' : 'loading', items: [], activeId: null }) },
    unavailable() { if (state.status !== 'ready' && state.status !== 'denied') emit({ status: 'unavailable' }) },
    resume() { if (state.status === 'denied') emit({ status: 'loading' }) },
    select(id) { if (state.status !== 'ready' || !state.items.some(item => item.id === id) || !select) return false; select(id); return true },
    leave(action) { if (leave) leave(action); else action() },
    attach() { attached++; emit({ attached: true }); return () => { attached--; emit({ attached: attached > 0 }) } },
    accessUnavailable(reason) { return reason === 'supply_chain_unavailable' || reason === 'connection_unavailable' },
    useAccess(url, onScope) {
      const [allowed, setAllowed] = React.useState(null)
      const snapshot = React.useSyncExternalStore(bridge.subscribe, bridge.getSnapshot, bridge.getSnapshot)
      React.useEffect(() => {
        let disposed = false, pending = false, timer
        const local = new AbortController()
        const check = async () => {
          if (disposed || pending) return
          pending = true; clearTimeout(timer)
          const generation = epoch
          try {
            const response = await fetch(url, { credentials: 'same-origin', redirect: 'error', signal: AbortSignal.any([local.signal, bridge.signal, AbortSignal.timeout(30000)]) })
            const body = await response.json()
            if (disposed || generation !== epoch) return
            if (response.status === 401 || response.status === 403 || body.allowed === false && !bridge.accessUnavailable(body.reason)) { setAllowed(false); bridge.invalidate(); return }
            if (!response.ok || body.allowed !== true) throw new Error('access_unavailable')
            if (onScope) onScope(body.scopeId); else bridge.adoptScope(body.scopeId)
            bridge.resume(); setAllowed(true)
          } catch { if (!disposed && generation === epoch) bridge.unavailable() }
          finally { pending = false; if (!disposed) timer = setTimeout(check, generation !== epoch ? 0 : 15000) }
        }
        const reset = () => { setAllowed(null); void check() }
        const refresh = () => { void check() }
        refresh(); window.addEventListener('focus', refresh); window.addEventListener('online', refresh); window.addEventListener('sensteed:identity-changed', reset)
        return () => { disposed = true; clearTimeout(timer); local.abort(); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); window.removeEventListener('sensteed:identity-changed', reset) }
      }, [url, onScope])
      return { allowed, epoch: snapshot.epoch }
    },
    useField(key, initial) {
      const generation = epoch
      const [value, setValue] = React.useState(() => fields.has(key) ? fields.get(key) : initial)
      React.useEffect(() => { setValue(fields.has(key) ? fields.get(key) : initial) }, [generation, key])
      return [value, next => { if (generation !== epoch) return; setValue(previous => { if (generation !== epoch) return previous; const resolved = typeof next === 'function' ? next(previous) : next; fields.set(key, resolved); return resolved }) }]
    },
    usePage() {
      const current = React.useSyncExternalStore(bridge.subscribe, bridge.getSnapshot, bridge.getSnapshot)
      return [current.page, value => { if (state.status === 'denied') return; if (state.items.length && !state.items.some(item => item.id === value)) return; emit({ page: value }) }, current.attached]
    },
    Menu({ onAccessDenied, registerLeaveGuard }) {
      const current = React.useSyncExternalStore(bridge.subscribe, bridge.getSnapshot, bridge.getSnapshot)
      const menu = React.useRef(null)
      React.useEffect(() => bridge.attach(), [])
      React.useEffect(() => { if (current.status !== 'loading') return; const timer = setTimeout(() => bridge.unavailable(), 10000); return () => clearTimeout(timer) }, [current.status])
      React.useEffect(() => { if (menu.current) menu.current.scrollTop = menuScroll }, [current.status])
      React.useEffect(() => registerLeaveGuard(action => bridge.leave(action)), [registerLeaveGuard])
      React.useEffect(() => { if (current.status === 'denied') onAccessDenied() }, [current.status, onAccessDenied])
      const h = React.createElement
      if (current.status !== 'ready') return h('p', { role: 'status', className: 'sensteedBusinessNavigationStatus' }, current.status === 'denied' ? '当前模块不可访问' : current.status === 'unavailable' ? '暂时无法加载导航，请在工作区重新连接。' : '正在加载导航…')
      let group
      return h('nav', { ref: menu, onScroll: event => { menuScroll = event.currentTarget.scrollTop }, className: 'sensteedBusinessNavigation', 'aria-label': '业务导航' }, ...current.items.flatMap(item => {
        const heading = item.group && item.group !== group ? h('h3', { key: `group-${item.group}` }, item.group) : null
        group = item.group
        return [heading, h('button', { key: item.id, type: 'button', 'aria-current': current.activeId === item.id ? 'page' : undefined, onClick: () => bridge.select(item.id) }, item.label)].filter(Boolean)
      }))
    },
  }
  return bridge
}
