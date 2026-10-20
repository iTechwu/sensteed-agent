/** The sealed enterprise CLI has no independent business/installer authority. */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BRAND_VARIANT } from './generated-product-identity.ts'
import { readPackagedHubBuildIdentity, type HubBuildFileAccess } from './hub-build-identity.ts'

export async function sealedSensteedCliPolicy(options: {
  readonly moduleUrl: string; readonly brand: string; readonly resourcesPath: string | undefined
  readonly args: readonly string[]; readonly verify: (appPath: string, resourcesPath: string) => Promise<unknown>
}): Promise<string | undefined> {
  const filename = fileURLToPath(options.moduleUrl)
  const archive = filename.match(/^(.*[/\\]app\.asar)(?:[/\\])/u)?.[1]
  if (options.brand !== 'sensteed' || archive === undefined) return undefined
  // Environment-selected Profile/DSH_HOME/RunAsNode never determine this boundary.
  if (options.resourcesPath === undefined || join(options.resourcesPath, 'app.asar') !== archive) {
    throw new Error('Sensteed sealed CLI: installed application identity unavailable; open the desktop Hub settings.')
  }
  await options.verify(archive, options.resourcesPath)
  if (options.args.length === 1 && ['--help', '-h', 'help'].includes(options.args[0]!)) {
    return '哪吒Agent: manage enterprise plugins and skills in Desktop → Plugins & Skills. Business CLI startup and independent installation are unavailable. Personal user-local skills remain in your local skills directory.\n'
  }
  if (options.args.length === 1 && ['--version', '-V'].includes(options.args[0]!)) {
    return '哪吒Agent sealed Hub CLI (desktop-managed)\n'
  }
  throw new Error('Sensteed sealed CLI: business startup and plugin management require Desktop Hub authorization. Open Desktop → Plugins & Skills; no command was executed.')
}

export async function enforceSealedSensteedCli(moduleUrl: string, args: readonly string[]): Promise<string | undefined> {
  return sealedSensteedCliPolicy({ moduleUrl, args, brand: BRAND_VARIANT,
    resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
    verify: async (appPath, resourcesPath) => {
      const fs = createRequire(import.meta.url)('original-fs') as { lstatSync: HubBuildFileAccess['lstat']; readdirSync: HubBuildFileAccess['readdir']; readFileSync: HubBuildFileAccess['readFile']; createReadStream: HubBuildFileAccess['createReadStream'] }
      await readPackagedHubBuildIdentity(appPath, resourcesPath, { lstat: fs.lstatSync, readdir: fs.readdirSync, readFile: fs.readFileSync, createReadStream: fs.createReadStream })
    } })
}
