/** Optional plugin-owned context navigation; never carries business records or credentials. */
export interface BusinessNavigationOwnerProps {
  /** Permission denial always returns home, without prompting to retain forbidden data. */
  onAccessDenied: () => void
  /** Install the current module's dirty/busy leave guard. Return its cleanup. */
  registerLeaveGuard: (guard: (action: () => void) => void) => () => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'desktop.navigation.context': { kind: 'keyed'; scope: 'root'; owner: BusinessNavigationOwnerProps }
  }
}
