/** Desktop-wide pnpm policy applied to every package-manager operation. */

/**
 * Sensteed-Agent accepts explicitly requested package versions immediately.
 * Keep this process-local: never rewrite a user's pnpm configuration file.
 */
export const PNPM_IGNORE_MINIMUM_RELEASE_AGE = '--config.minimumReleaseAge=0'

/** Prefix a direct pnpm argv without adding the same Desktop policy twice. */
export function withDesktopPnpmPolicy(argv: readonly string[]): string[] {
  if (argv.includes(PNPM_IGNORE_MINIMUM_RELEASE_AGE)) return [...argv]
  return [PNPM_IGNORE_MINIMUM_RELEASE_AGE, ...argv]
}

const PNPM_STORE_DIR_FLAG = '--store-dir'

/** Append the selected pnpm store unless the caller already supplied one. */
export function withDesktopPnpmStoreDir(argv: readonly string[], storeDir: string): string[] {
  if (argv.some(argument => argument === PNPM_STORE_DIR_FLAG || argument.startsWith(`${PNPM_STORE_DIR_FLAG}=`))) return [...argv]
  return [...argv, PNPM_STORE_DIR_FLAG, storeDir]
}

/**
 * `dsh plugin` ultimately resolves the Desktop pnpm shim, which owns the one
 * policy argument. Remove an eagerly forwarded copy before that boundary.
 */
export function withoutForwardedDesktopPnpmPolicy(argv: readonly string[]): string[] {
  if (argv[0] !== 'plugin') return [...argv]
  return argv.filter((argument, index) => index === 0 || argument !== PNPM_IGNORE_MINIMUM_RELEASE_AGE)
}
