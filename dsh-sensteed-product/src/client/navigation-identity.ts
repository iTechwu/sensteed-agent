/** Notify UI modules without putting account identifiers or credentials on the event bus. */
interface IdentitySource {
  getSnapshot(): { value?: { authMode?: unknown; identity?: { ssoSub?: unknown; groups?: readonly string[] } } | undefined }
  subscribe(listener: () => void): () => void
}

export const NAVIGATION_IDENTITY_EVENT = 'sensteed:identity-changed'

export function observeNavigationIdentity(source: IdentitySource, changed: () => void): () => void {
  const signature = () => {
    const value = source.getSnapshot().value
    return JSON.stringify([value?.authMode, value?.identity?.ssoSub, [...(value?.identity?.groups ?? [])].sort()])
  }
  let previous = signature()
  return source.subscribe(() => {
    const next = signature()
    if (next === previous) return
    previous = next
    changed()
  })
}
