/** Blocking-phase reminder dialog: pure decision + copy (Electron seam stays in main). */

import type { CachedMandatoryUpdatePolicy } from './mandatory-policy-cache.ts'

/** Single-flight cooldown between two blocking reminders. */
export const MANDATORY_BLOCKING_PROMPT_COOLDOWN_MS = 30 * 60_000

/**
 * Whether a blocking reminder should fire now: the Host reported a blocking
 * phase and the cooldown has elapsed. Notice phases never prompt (tray,
 * notification, and the mutation gates already carry the message).
 */
export function shouldPromptMandatoryBlocking(options: {
  readonly policy: CachedMandatoryUpdatePolicy | undefined
  readonly now: number
  readonly lastPromptAt: number
}): boolean {
  const policy = options.policy
  if (policy?.phase !== 'blocking') return false
  return options.now - options.lastPromptAt >= MANDATORY_BLOCKING_PROMPT_COOLDOWN_MS
}

/** Locale-resolved copy for the blocking reminder dialog. */
export function mandatoryBlockingDialogCopy(
  locale: string,
  minVersion: string | undefined,
): { readonly title: string; readonly message: string; readonly detail?: string; readonly confirm: string; readonly cancel: string } {
  const zh = !locale.startsWith('en')
  return {
    title: zh ? '必须更新后才能继续使用' : 'Update required',
    message: zh ? '必须更新后才能继续使用' : 'Update required',
    ...(minVersion === undefined ? {} : {
      detail: zh ? `当前版本低于服务端要求的最低版本 ${minVersion}。` : `This build is below the required minimum ${minVersion}.`,
    }),
    confirm: zh ? '立即下载更新' : 'Download update now',
    cancel: zh ? '稍后' : 'Later',
  }
}
