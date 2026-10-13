/** Build the private sibling finance plugin before packaging its installed file dependency. */
import { execFileSync } from 'node:child_process'
import { cpSync, realpathSync, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const source = resolve(root, '../docker-helm.dofe.ai/plugins/dsh-sensteed-finance')
execFileSync(process.execPath, [resolve(source, 'scripts/build.mjs')], { cwd: source, stdio: 'inherit' })
const require = createRequire(resolve(root, 'dsh-plugin-desktop/package.json'))
const installed = resolve(require.resolve('@dofe/dsh-sensteed-finance/package.json'), '..')
if (realpathSync(installed) !== realpathSync(source)) {
  for (const file of ['index.js', 'cordis.patch.yml', 'lib', 'package.json']) cpSync(resolve(source, file), resolve(installed, file), { recursive: true, filter: (src, dest) => !existsSync(dest) || statSync(src).ino !== statSync(dest).ino || statSync(src).dev !== statSync(dest).dev })
}
