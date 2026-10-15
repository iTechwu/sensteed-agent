import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

// Exercise the shipped element tree, including state changes, without a host
// session or network. This catches valid-JS nesting mistakes that syntax checks
// cannot detect (for example, putting the entire page inside its flex header).
export function createPage(skills = [], sharedSkills = []) {
  const states = [skills, sharedSkills, '', false, 'ready']
  let cursor = 0
  let component
  let dictionary
  let css = ''
  const react = {
    createElement: (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat(Infinity).filter(child => child != null && child !== false) }),
    useEffect() {},
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = initial
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
  }
  const module = { exports: {} }
  runInNewContext(readFileSync(new URL('../src/client.js', import.meta.url), 'utf8'), {
    module,
    require: name => name === 'react' ? react : {},
    document: {
      createElement: () => ({ dataset: {}, remove() {} }),
      head: { appendChild: style => { css = style.textContent } },
    },
    requestAnimationFrame() {},
  })
  module.exports.apply({
    effect: callback => callback(),
    locale: { register: (_namespace, copy) => { dictionary = copy.zh }, bind: () => key => dictionary[key] },
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, value) => { if (options.name === 'main') component = value },
    },
  })
  return {
    get css() { return css },
    render() { cursor = 0; return component({ t: key => dictionary[key], createSkill: async () => {} }) },
  }
}

export function find(node, className) {
  if (typeof node !== 'object') return undefined
  if (node.props.className?.split(' ').includes(className)) return node
  return node.children.map(child => find(child, className)).find(Boolean)
}

const fixture = [{ name: 'release-notes', description: 'Prepare release notes', source: 'user-dsh', provider: 'filesystem' }]

test('keeps the header, toolbar, installed list and shared section as separate page blocks', () => {
  const page = createPage(fixture)
  const root = page.render()
  assert.deepEqual(Array.from(root.children, node => node.props.className), ['sm-header', 'sm-toolbar', 'sm-installed', 'sm-shared'])
  assert.deepEqual(Array.from(find(root, 'sm-header').children, node => node.props.className), ['sm-heading-copy', 'sm-actions'])
  assert.equal(find(find(root, 'sm-row'), 'sm-row-meta').children.length, 2)
})

test('opens the add menu inside its trigger and places creation and install forms below the header', () => {
  const page = createPage(fixture)
  find(page.render(), 'sm-add-more').props.onClick()
  const menu = find(page.render(), 'sm-add-menu')
  assert.equal(menu.children.length, 2)
  menu.children[1].props.onClick()
  let root = page.render()
  assert.equal(root.children[1].props.className, 'sm-create-form')
  assert.equal(find(find(root, 'sm-header'), 'sm-create-form'), undefined)
  find(root, 'sm-add-primary').props.onClick()
  root = page.render()
  assert.equal(root.children[1].props.className, 'sm-install-form')
  assert.equal(find(root, 'sm-create-form'), undefined)
})
