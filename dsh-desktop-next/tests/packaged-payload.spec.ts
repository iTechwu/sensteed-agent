import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPackageWithOptions } from '@electron/asar'
import { afterEach, expect, it } from 'vitest'
import { archivedPayload, auditNextPayload, nextPackagingTarget, nextPayloadRelease, sealNextPayload, verifyNextPayload, verifyNextRuntime } from '../scripts/packaged-payload.ts'
import { applyPlatformFileExclusions, platformFileExclusions } from '../scripts/prepare-pack.ts'
import { DESKTOP_RUNTIME_FILE, readDesktopRuntime } from '../src/runtime-tree.ts'
import { FIXTURE_RELEASE, FIXTURE_SHARED, writeApplication, writePackage } from './runtime-fixture.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const machO = (body: string): Buffer => Buffer.concat([Buffer.from([0xCF, 0xFA, 0xED, 0xFE]), Buffer.from(body)])
const unix = process.platform !== 'win32'

/** A complete Next application directory, archived the way Electron Builder lays it out. */
async function assembled(extra: (app: string) => void = () => {}): Promise<{ resources: string; app: string }> {
  const root = mkdtempSync(join(tmpdir(), 'desktop-archived-'))
  roots.push(root)
  const app = join(root, 'app')
  writeApplication(app)
  const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
  manifest.dependencies['native-pkg'] = '*'
  manifest.dependencies['@deepseek-ai/dsh-web-frontend'] = '*'
  writeFileSync(join(app, 'package.json'), JSON.stringify(manifest) + '\n')
  for (const path of ['lib/host.js', 'lib/client.js', 'lib/preload-app.cjs', 'lib/preload-shell.cjs', 'lib/native-ui/index.html',
    'cordis.patch.yml', 'host.cordis.patch.yml', 'scripts/node-bin/node', 'scripts/node-bin/node.cmd',
    'assets/tray-iconTemplate.png', 'assets/tray-icon-blue.png', 'build/app-icon.png']) {
    mkdirSync(join(app, path, '..'), { recursive: true })
    writeFileSync(join(app, path), `payload:${path}\n`)
  }
  if (unix) chmodSync(join(app, 'scripts', 'node-bin', 'node'), 0o755)
  const modules = join(app, 'node_modules')
  const frontend = writePackage(modules, '@deepseek-ai/dsh-web-frontend')
  mkdirSync(join(frontend, 'dist'))
  writeFileSync(join(frontend, 'dist', 'index.html'), '<html></html>')
  mkdirSync(join(modules, 'pnpm', 'bin'), { recursive: true })
  writeFileSync(join(modules, 'pnpm', 'bin', 'pnpm.mjs'), 'export {}\n')
  const native = writePackage(modules, 'native-pkg')
  mkdirSync(join(native, 'bin'))
  writeFileSync(join(native, 'bin', 'uv'), machO('uv'))
  writeFileSync(join(native, 'addon.node'), machO('addon'))
  if (unix) chmodSync(join(native, 'bin', 'uv'), 0o755)
  extra(app)
  const resources = join(root, 'Resources')
  mkdirSync(resources)
  await createPackageWithOptions(app, join(resources, 'app.asar'), {
    unpack: '{**/*.node,**/bin/uv}', unpackDir: '{scripts/node-bin,assets,build,node_modules/pnpm}',
  })
  return { resources, app }
}
const target = nextPackagingTarget(process.platform, process.arch)

it('describes the architectures each release target carries', () => {
  expect(nextPackagingTarget('darwin')).toEqual({ platform: 'darwin', archs: ['arm64', 'x64'] })
  expect(nextPackagingTarget('win32')).toEqual({ platform: 'win32', archs: ['x64'] })
  expect(nextPackagingTarget('linux', 'arm64')).toEqual({ platform: 'linux', archs: ['arm64'] })
})

it('reads archive entries from their offsets and unpacked entries from the physical sibling', async () => {
  const { resources, app } = await assembled()
  const source = archivedPayload(resources)
  try {
    const paths = source.list().map(entry => entry.path)
    expect(paths).toEqual([...paths].sort())
    expect(paths).toContain('lib/main.js')
    expect(source.entry('lib/main.js')).toMatchObject({ unpacked: false, executable: false })
    expect(source.entry('lib/main.js')!.read().toString('utf8')).toBe('export {}\n')
    expect(source.entry('node_modules/native-pkg/addon.node')).toMatchObject({ unpacked: true })
    expect(source.entry('node_modules/native-pkg/bin/uv')).toMatchObject({ unpacked: true, executable: unix })
    expect(source.entry('scripts/node-bin/node')).toMatchObject({ unpacked: true, executable: unix })
    expect(source.entry('node_modules/pnpm/bin/pnpm.mjs')).toMatchObject({ unpacked: true })
    expect(source.entry('node_modules/@deepseek-ai/dsh/index.js')!.read().toString('utf8')).toBe('export const identity = {}\n')
    expect(source.entry(DESKTOP_RUNTIME_FILE)).toBeUndefined()
    expect(existsSync(join(resources, 'app.asar.unpacked', 'node_modules', 'native-pkg', 'bin', 'uv'))).toBe(true)
    expect(existsSync(join(resources, 'app.asar.unpacked', 'lib', 'main.js'))).toBe(false)
    expect(() => verifyNextPayload(source)).not.toThrow()
    expect(auditNextPayload(source, target)).toEqual([])
    expect(nextPayloadRelease(source, '44.0.0')).toEqual(FIXTURE_RELEASE)
  } finally { source.close() }
  rmSync(join(resources, 'app.asar.unpacked', 'node_modules', 'native-pkg', 'addon.node'))
  expect(() => archivedPayload(resources)).toThrow(/no physical file/u)
  expect(app).toBeTruthy()
})

it('reports stray root entries, policy leftovers, packed native code and packed shell-executed files', async () => {
  const { resources } = await assembled((app) => {
    mkdirSync(join(app, '.desktop-next', 'home'), { recursive: true })
    writeFileSync(join(app, '.desktop-next', 'home', 'desktop-next.json'), '{}')
    writeFileSync(join(app, 'README.md'), '# leak\n')
    writeFileSync(join(app, 'node_modules', '@deepseek-ai', 'dsh', 'index.js.map'), '{}')
    writeFileSync(join(app, 'node_modules', 'native-pkg', 'helper'), machO('helper'))
    mkdirSync(join(app, 'node_modules', '@agents-anywhere', 'dsh-bridge-next', 'lib', 'bundled-connector'), { recursive: true })
    writeFileSync(join(app, 'node_modules', '@agents-anywhere', 'dsh-bridge-next', 'lib', 'bundled-connector', 'main.py'), 'print()\n')
  })
  const source = archivedPayload(resources)
  try {
    expect(auditNextPayload(source, target)).toEqual([
      '.desktop-next: outside the declared application files',
      'README.md: outside the declared application files',
      'node_modules/@agents-anywhere/dsh-bridge-next/lib/bundled-connector/main.py: must be unpacked beside app.asar',
      'node_modules/@deepseek-ai/dsh/index.js.map: source map must not be packaged',
      'node_modules/native-pkg/helper: native code is packed inside app.asar',
    ])
  } finally { source.close() }
})

it('rejects an archive missing a declared dependency or a shell-owned file', async () => {
  const { resources } = await assembled((app) => {
    rmSync(join(app, 'node_modules', '@deepseek-ai', 'cordis'), { recursive: true })
  })
  const source = archivedPayload(resources)
  try { expect(() => verifyNextPayload(source)).toThrow(/Missing packaged dependency @deepseek-ai\/cordis/u) } finally { source.close() }
  const { resources: without } = await assembled((app) => { rmSync(join(app, 'host.cordis.patch.yml')) })
  const missing = archivedPayload(without)
  try { expect(() => verifyNextPayload(missing)).toThrow(/Missing Next payload: host\.cordis\.patch\.yml/u) } finally { missing.close() }
})

it('seals the archive beside app.asar and verifies it before and after code signing', async () => {
  const { resources } = await assembled()
  const source = archivedPayload(resources)
  let sealed
  try {
    sealed = sealNextPayload(resources, source, nextPayloadRelease(source, '44.0.0'), target)
  } finally { source.close() }
  expect(sealed.sharedPackages.map(entry => entry.name)).toEqual([...FIXTURE_SHARED, '@deepseek-ai/dsh-web-frontend', 'native-pkg'].sort())
  expect(sealed.files.filter(file => file.unpacked).map(file => file.path)).toEqual(expect.arrayContaining(['node_modules/native-pkg/addon.node', 'scripts/node-bin/node', 'assets/tray-icon-blue.png']))
  expect(sealed.files.find(file => file.path === 'node_modules/native-pkg/addon.node')).toMatchObject({ machO: true, unpacked: true })
  expect(sealed.files.find(file => file.path === 'lib/main.js')).toMatchObject({ machO: false, unpacked: false })
  expect(readDesktopRuntime(join(resources, DESKTOP_RUNTIME_FILE))).toEqual(sealed)
  expect(lstatSync(join(resources, DESKTOP_RUNTIME_FILE)).isFile()).toBe(true)
  expect(verifyNextRuntime(resources, FIXTURE_RELEASE.version, target)).toEqual(sealed)
  // Signing rewrites the unpacked Mach-O file in place.
  writeFileSync(join(resources, 'app.asar.unpacked', 'node_modules', 'native-pkg', 'addon.node'), machO('addon, now signed'))
  expect(() => verifyNextRuntime(resources, FIXTURE_RELEASE.version, target)).toThrow(/integrity/u)
  expect(verifyNextRuntime(resources, FIXTURE_RELEASE.version, target, { afterCodeSigning: true })).toEqual(sealed)
  expect(() => verifyNextRuntime(resources, '2.0.1-next', target, { afterCodeSigning: true })).toThrow(/not the expected 2\.0\.1-next/u)
  // A changed shell shim is never acceptable.
  writeFileSync(join(resources, 'app.asar.unpacked', 'scripts', 'node-bin', 'node'), 'tampered')
  expect(() => verifyNextRuntime(resources, FIXTURE_RELEASE.version, target, { afterCodeSigning: true })).toThrow(/changed scripts\/node-bin\/node/u)
})

it('refuses to seal a payload whose pnpm has no version', async () => {
  const { resources } = await assembled((app) => { writeFileSync(join(app, 'node_modules', 'pnpm', 'package.json'), '{"name":"pnpm"}') })
  const source = archivedPayload(resources)
  try { expect(() => nextPayloadRelease(source, '44.0.0')).toThrow(/pnpm has no version/u) } finally { source.close() }
})

it("adds each platform's omissions to the normalized application file set exactly once", () => {
  const files = [{ filter: ['lib/**', 'package.json'] }]
  expect(applyPlatformFileExclusions(files, 'darwin')).toEqual(['!node_modules/node-pty/prebuilds/{linux,win32}-*/**'])
  expect(applyPlatformFileExclusions(files, 'darwin')).toEqual([])
  expect(files[0]!.filter).toEqual(['lib/**', 'package.json', '!node_modules/node-pty/prebuilds/{linux,win32}-*/**'])
  expect(platformFileExclusions('win32')).toEqual(['!node_modules/node-pty/prebuilds/{darwin,linux}-*/**', '!node_modules/node-pty/prebuilds/win32-arm64/**'])
  expect(platformFileExclusions('linux')).toEqual(['!node_modules/node-pty/prebuilds/{darwin,win32}-*/**'])
  for (const files of [undefined, [], ['lib/**'], [{ from: 'x' }]]) {
    expect(() => applyPlatformFileExclusions(files, 'darwin')).toThrow(/normalized application file set/u)
  }
})
