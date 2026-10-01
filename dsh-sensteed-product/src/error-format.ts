/** Bounded error rendering for product diagnostics; independent of the shell copy. */

/**
 * Render one error with its aggregate members and cause chain. Mirrors the
 * shell's `formatDesktopErrorDetails` (deliberate copy: the two evolve
 * independently across the shell boundary).
 */
export function formatDesktopErrorDetails(error: unknown, seen = new Set<unknown>()): string {
  if (error instanceof AggregateError) {
    const parts = error.errors.map(part => formatDesktopErrorDetails(part, seen))
    return `${error.message} [errors: ${parts.join(' | ')}]`
  }
  if (!(error instanceof Error)) return String(error)
  if (seen.has(error)) return `${error.message} [circular cause]`
  seen.add(error)
  const details = [error.stack ?? error.message]
  const cause = (error as { cause?: unknown }).cause
  if (cause !== undefined) {
    details.push(`cause=${formatDesktopErrorDetails(cause, seen)}`)
  }
  return details.join('\n')
}
