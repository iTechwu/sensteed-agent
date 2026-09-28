// dsh-soup 预览浮层行为测试：Escape 关闭与关闭后焦点归还触发元素。
// 桌面 UX 审计基线要求 dismissible 浮层具备 Escape 退出与焦点恢复，
// 本测试用可编程 React stub 直接驱动 PreviewOverlay 的副作用生命周期。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFilesView } from '../lib/client/files-view.js'

function setupHarness({ files, activeElement }) {
  const listeners = new Map()
  const documentStub = {
    addEventListener: (type, fn) => { listeners.set(type, fn) },
    removeEventListener: (type) => { listeners.delete(type) },
    activeElement,
  }
  const effects = []
  const React = {
    useEffect: (fn, deps) => { effects.push({ fn, deps }) },
    useRef: (init) => ({ current: init }),
  }
  let rafCallback = null
  globalThis.requestAnimationFrame = (fn) => { rafCallback = fn }
  globalThis.document = documentStub

  const setFilesCalls = []
  const ctx = {
    React,
    create: (type, props, ...children) => ({ type, props: props || {}, children: children.filter(c => c !== false && c !== null && c !== undefined) }),
    useStore: () => ({ files }),
    findFileEntry: (path) => ({ path, dirty: false }),
    setFiles: (patch) => { setFilesCalls.push(patch) },
    FileToolbar: () => null,
    FileContent: () => null,
    closeFileTab: () => {},
    T: (key) => key,
  }
  const { PreviewOverlay } = createFilesView(ctx)
  return { PreviewOverlay, effects, listeners, setFilesCalls, focusSpy: activeElement.focus, raf: () => rafCallback }
}

test('浮层打开时注册 Escape 关闭副作用', () => {
  const { PreviewOverlay, effects, listeners } = setupHarness({
    files: { overlay: true, active: '/a.md', overlayMax: false, overlayReturn: 'tab' },
    activeElement: { focus: () => {} },
  })
  const node = PreviewOverlay()
  assert.ok(node, '浮层打开时应渲染节点')
  assert.equal(effects.length, 1)
  effects[0].fn()
  assert.ok(listeners.has('keydown'), '应挂载 keydown 监听')
})

test('按下 Escape 以关闭浮层补丁回写 store', () => {
  const { PreviewOverlay, effects, listeners, setFilesCalls } = setupHarness({
    files: { overlay: true, active: '/a.md' },
    activeElement: { focus: () => {} },
  })
  PreviewOverlay()
  effects[0].fn()
  listeners.get('keydown')({ key: 'Escape' })
  assert.deepEqual(setFilesCalls, [{ overlay: false, overlayMax: false, overlayReturn: null }])
  listeners.get('keydown')({ key: 'Enter' })
  assert.equal(setFilesCalls.length, 1, '非 Escape 按键不应关闭')
})

test('副作用清理时移除监听并把焦点还给触发元素', () => {
  const focusCalls = []
  const { PreviewOverlay, effects, listeners, raf } = setupHarness({
    files: { overlay: true, active: '/a.md' },
    activeElement: { focus: () => { focusCalls.push('trigger') } },
  })
  PreviewOverlay()
  const cleanup = effects[0].fn()
  assert.equal(typeof cleanup, 'function')
  cleanup()
  assert.ok(!listeners.has('keydown'), '清理应移除 keydown 监听')
  raf()()
  assert.deepEqual(focusCalls, ['trigger'])
})

test('浮层未打开时不注册任何副作用', () => {
  const { PreviewOverlay, effects } = setupHarness({
    files: { overlay: false, active: null },
    activeElement: { focus: () => {} },
  })
  const node = PreviewOverlay()
  assert.equal(node, null)
  assert.equal(effects[0].deps[0], false, 'overlayActive 为 false')
  effects[0].fn()
  assert.equal(effects.length, 1)
})
