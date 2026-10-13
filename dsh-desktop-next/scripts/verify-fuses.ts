/** Verify every final Next executable: fuses, the sealed archive, a RunAsNode import smoke and a real Host boot. */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyElectronExecutableFuses } from '../../dsh-plugin-desktop/scripts/verify-electron-fuses.ts'
import { withoutMacReleaseSecrets } from '../../dsh-plugin-desktop/scripts/release-preflight.ts'
import { withoutWindowsSigningSecrets } from '../../dsh-plugin-desktop/scripts/package-win.ts'
import { nextPackagingTarget, verifyNextRuntime } from './packaged-payload.ts'
import { verifyNextRuntimeTree } from './prepare-runtime.ts'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))

/** Version the payload must declare: the drill override, otherwise the source manifest. */
function expectedVersion(): string {
  const source = (JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as { version: string }).version
  return process.env.DSH_NEXT_BUILD_VERSION ?? source
}

function runPackagedNode(path: string, args: readonly string[], timeout: number, failure: string): void {
  const result = spawnSync(path, args, {
    env: { ...withoutWindowsSigningSecrets(withoutMacReleaseSecrets(process.env)), ELECTRON_RUN_AS_NODE: '1' },
    timeout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`${failure}: exit ${String(result.status)} signal ${String(result.signal)}\n${result.stderr}`)
  }
}

export default async function afterAllArtifactBuild(result: { outDir: string }): Promise<string[]> {
  const paths = ['mac/DSH NEXT.app/Contents/MacOS/DSH NEXT', 'mac-arm64/DSH NEXT.app/Contents/MacOS/DSH NEXT',
    'mac-universal/DSH NEXT.app/Contents/MacOS/DSH NEXT', 'win-unpacked/DSH NEXT.exe', 'linux-unpacked/dsh-desktop-next']
  const executables = paths.map(path => join(result.outDir, path)).filter(existsSync)
  if (!executables.length) throw new Error('No packaged Next executable to verify')
  for (const path of executables) {
    // Upstream Desktop keeps both archive fuses off; the archive is sealed by code signing instead.
    await verifyElectronExecutableFuses(path, undefined, false)
    const darwin = path.includes('.app/')
    const resources = darwin ? join(dirname(path), '../Resources') : join(dirname(path), 'resources')
    const root = join(resources, 'app.asar')
    // electron-builder signs unpacked Mach-O files and nested bundles after afterPack sealed the
    // payload, so the final tree is checked with code-signing tolerance; verify-mac-release.ts
    // validates the signatures themselves.
    const target = nextPackagingTarget(darwin ? 'darwin' : path.endsWith('.exe') ? 'win32' : 'linux')
    const descriptor = verifyNextRuntime(resources, expectedVersion(), target, { afterCodeSigning: true })
    console.log(`Verified the sealed Next payload at ${root}: ${String(descriptor.files.length)} files, dsh ${descriptor.release.dshVersion}`)
    // The interpreter payloads are pre-signed resources; code signing must have left them as prepared.
    const runtimes = verifyNextRuntimeTree(join(resources, 'runtime'), target.platform, expectedVersion())
    if (runtimes.length > 0) console.log(`Verified the bundled primary runtimes: ${runtimes.map(runtime => runtime.arch).join(', ')}`)
    // Electron's Node mode reads the archive like a directory, as the Host and CLI will.
    runPackagedNode(path, ['--input-type=module', '-e', `
      import { createRequire } from 'node:module';
      import { pathToFileURL } from 'node:url';
      const root = process.argv[1];
      const require = createRequire(root + '/package.json');
      if (require('./package.json').name !== 'dsh-desktop-next') throw new Error('Wrong packaged application');
      await import(pathToFileURL(root + '/lib/profiles.js'));
      await import(pathToFileURL(root + '/lib/desktop-runtime.js'));
      require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html');
    `, root], 30_000, 'Packaged Next runtime failed')
    // The same Electron, in Node mode, starts the real Host from the archive with a private home.
    runPackagedNode(path, ['--expose-internals', join(desktopRoot, 'scripts', 'packaged-host-smoke.mjs'), root], 300_000, 'Packaged Next Host smoke failed')
  }
  return []
}
