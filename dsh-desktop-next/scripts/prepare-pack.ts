/** Electron Builder's beforePack hook: the platform's omissions and the Office closure join the archive configuration. */
import { nextPackagingTarget } from './packaged-payload.ts'
import { officeUnpackPatterns } from './office-packages.ts'

interface PackContext {
  electronPlatformName: string
  packager: { projectDir: string; config: { files?: unknown; asarUnpack?: unknown } }
}

/**
 * Files one platform never loads. node-pty ships every platform's prebuilds in one package, so
 * the build keeps only the target platform's directories.
 * @param platform - Electron platform being packaged.
 * @returns Negated file globs for that platform.
 */
export function platformFileExclusions(platform: NodeJS.Platform): string[] {
  if (platform === 'darwin') return ['!node_modules/node-pty/prebuilds/{linux,win32}-*/**']
  if (platform === 'win32') return ['!node_modules/node-pty/prebuilds/{darwin,linux}-*/**', '!node_modules/node-pty/prebuilds/win32-arm64/**']
  return ['!node_modules/node-pty/prebuilds/{darwin,win32}-*/**']
}

/**
 * Append the platform's omissions to the application file set.
 * electron-builder normalizes the top-level `files` into one `{ filter }` set, while a
 * platform-level `files` list that holds only negations becomes a second matcher, and a
 * matcher with only negations includes every other file. The omissions therefore have to
 * join the first set. A universal macOS build packs each CPU in turn; each pattern is added once.
 * @param files - `config.files` as electron-builder loaded it.
 * @param platform - Electron platform being packaged.
 * @returns The patterns this call added.
 */
export function applyPlatformFileExclusions(files: unknown, platform: NodeJS.Platform): string[] {
  const set: unknown = Array.isArray(files) ? files[0] : undefined
  if (typeof set !== 'object' || set === null || !Array.isArray((set as { filter?: unknown }).filter)) {
    throw new Error('Next packaging: expected the normalized application file set in config.files')
  }
  const filter = (set as { filter: string[] }).filter
  const added: string[] = []
  for (const pattern of platformFileExclusions(platform)) {
    if (filter.includes(pattern)) continue
    filter.push(pattern)
    added.push(pattern)
  }
  return added
}

/**
 * Unpack the Office package closure of every CPU the package carries. The bundled standalone Node
 * runs the LibreOffice Kit CLI and its JavaScript dependencies from physical files, so the closure
 * resolved from the installed tree joins `asarUnpack`; each pattern is added once.
 * @param config - electron-builder configuration being packed.
 * @param projectDir - Installed application directory.
 * @param platform - Electron platform being packaged.
 * @returns The patterns this call added.
 */
export function applyOfficeUnpack(config: { asarUnpack?: unknown }, projectDir: string, platform: NodeJS.Platform): string[] {
  const existing = config.asarUnpack
  const patterns = typeof existing === 'string' ? [existing] : Array.isArray(existing) ? existing.filter((value): value is string => typeof value === 'string') : []
  const added = officeUnpackPatterns(projectDir, platform, nextPackagingTarget(platform).archs).filter(pattern => !patterns.includes(pattern))
  config.asarUnpack = [...patterns, ...added]
  return added
}

export default async function beforePack(context: PackContext): Promise<void> {
  const platform = context.electronPlatformName as NodeJS.Platform
  const added = applyPlatformFileExclusions(context.packager.config.files, platform)
  if (added.length > 0) console.log(`Next ${context.electronPlatformName} payload omits ${added.join(', ')}`)
  const office = applyOfficeUnpack(context.packager.config, context.packager.projectDir, platform)
  if (office.length > 0) console.log(`Next ${context.electronPlatformName} payload unpacks the Office closure: ${String(office.length)} packages`)
  await Promise.resolve()
}
