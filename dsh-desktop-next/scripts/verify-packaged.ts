/** Check, audit and seal the assembled `app.asar` payload before signing, without a GUI. */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { archivedPayload, auditNextPayload, nextPackagingTarget, nextPayloadRelease, sealNextPayload, verifyNextPayload } from './packaged-payload.ts'
import { expectedNextVersion, verifyNextRuntimeTree } from './prepare-runtime.ts'

interface PackContext {
  appOutDir: string
  electronPlatformName: string
  packager: { projectDir: string }
}

/** Electron release the package embeds, read from the packaging workspace. */
function packagedElectronVersion(projectDir: string): string {
  const require = createRequire(join(projectDir, 'package.json'))
  return (JSON.parse(readFileSync(require.resolve('electron/package.json'), 'utf8')) as { version: string }).version
}

/**
 * Electron Builder's afterPack hook: the archive must be complete and resolvable, carry nothing
 * the Desktop file policy omits, keep native and shell-executed files unpacked, and seal
 * `desktop-runtime.json` beside it before signing; the interpreter payloads copied as extra
 * resources must declare this platform, every CPU and the product version. Universal macOS builds
 * run this once per CPU and once more on the merged application; the archives and descriptors are
 * identical, which the merge requires.
 * @param context - Electron Builder's afterPack context.
 */
export default async function afterPack(context: PackContext): Promise<void> {
  const resources = context.electronPlatformName === 'darwin' ? join(context.appOutDir, 'DSH NEXT.app/Contents/Resources') : join(context.appOutDir, 'resources')
  if (!existsSync(join(resources, 'app.asar'))) throw new Error('Next must package its application into app.asar like upstream Desktop')
  if (existsSync(join(resources, 'app'))) throw new Error('Next must not ship an unpacked application directory beside app.asar')
  const platform = context.electronPlatformName as NodeJS.Platform
  const source = archivedPayload(resources)
  try {
    verifyNextPayload(source)
    const target = nextPackagingTarget(platform)
    const problems = auditNextPayload(source, target)
    if (problems.length > 0) throw new Error(`Next payload audit failed:\n${problems.join('\n')}`)
    const release = nextPayloadRelease(source, packagedElectronVersion(context.packager.projectDir))
    const descriptor = sealNextPayload(resources, source, release, target)
    const unpacked = descriptor.files.filter(file => file.unpacked).length
    console.log(`Sealed the Next payload: ${String(descriptor.files.length)} files (${String(unpacked)} unpacked) for ${descriptor.platform} ${descriptor.archs.join('/')}; `
      + `DSH NEXT ${release.version}, dsh ${release.dshVersion}, Electron ${release.electronVersion}, pnpm ${release.pnpmVersion}`)
  } finally { source.close() }
  const runtimes = verifyNextRuntimeTree(join(resources, 'runtime'), platform, expectedNextVersion(context.packager.projectDir))
  for (const runtime of runtimes) console.log(`Verified the ${runtime.arch} primary runtime: Python ${runtime.manifest.python}, Node ${runtime.manifest.node}, pnpm ${runtime.manifest.pnpm}`)
  await Promise.resolve()
}
