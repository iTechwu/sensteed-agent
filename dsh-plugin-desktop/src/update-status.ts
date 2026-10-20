/** Safe update outcomes shared by the Host and settings renderer. */
export type DesktopUpdateFailure = 'network' | 'timeout' | 'unpublished' | 'service' | 'invalid-response' | 'invalid-version' | 'download' | 'unsupported-target' | 'manual-migration-required'
export interface DesktopUpdateStatus {
  readonly status: 'up-to-date' | 'update-available' | 'failed'
  readonly checkedAt: string
  readonly channel: 'stable' | 'beta' | 'next'
  readonly latestVersion?: string
  readonly failure?: DesktopUpdateFailure
}
