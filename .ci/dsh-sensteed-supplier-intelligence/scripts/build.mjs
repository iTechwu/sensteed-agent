import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const chunks = []
for (const file of ['src/head.js', 'src/styles.js', 'src/shell.js']) chunks.push(await readFile(resolve(root, file), 'utf8'))
const source = chunks.join('\n')
await mkdir(resolve(root, 'lib'), { recursive: true })
const indented = source.split('\n').map(line => line ? `    ${line}` : '').join('\n')
await writeFile(resolve(root, 'lib/client.js'), `window.__ModuleLoader__.load({\n  id: "@dofe/dsh-sensteed-supplier-intelligence",\n  factory: (require) => { var module = { exports: {} }; var exports = module.exports;\n${indented}\n    exports.apply = apply; exports.inject = ['slots', 'locale', 'sessions', 'uiWorkspace', 'layout']; return module.exports; },\n});\n`)
