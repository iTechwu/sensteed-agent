/** Strict SemVer parsing and channel rules shared by the update chain. */

export type DesktopReleaseChannel = 'stable' | 'beta' | 'next'

/** Maximum response body bytes accepted from the version service. */
export const MAX_VERSION_RESPONSE_BYTES = 4 * 1024

/** Strictly parsed SemVer components. Numeric components remain strings to avoid overflow. */
export interface ParsedSemVer {
  /** Canonical version without the optional leading `v`. */
  readonly version: string
  /** Major numeric identifier. */
  readonly major: string
  /** Minor numeric identifier. */
  readonly minor: string
  /** Patch numeric identifier. */
  readonly patch: string
  /** Ordered prerelease identifiers, or an empty list for a stable version. */
  readonly prerelease: readonly string[]
  /** Build identifiers, ignored for version precedence. */
  readonly build: readonly string[]
}

/** Fetch-compatible request function used by the headless checker. */


const SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u

/**
 * Parse strict SemVer with an optional lowercase `v` prefix.
 * @param input - complete version or release tag.
 * @returns parsed identifiers, or null when the input is not valid SemVer.
 */
export function parseSemVer(input: string): ParsedSemVer | null {
  const version = input.startsWith('v') ? input.slice(1) : input
  const match = SEMVER_PATTERN.exec(version)
  if (match === null) return null

  const prerelease = match[4]?.split('.') ?? []
  if (prerelease.some(identifier => isNumeric(identifier) && hasLeadingZero(identifier))) return null

  return {
    version,
    major: match[1]!,
    minor: match[2]!,
    patch: match[3]!,
    prerelease,
    build: match[5]?.split('.') ?? [],
  }
}

/**
 * Compare two strict SemVer strings without numeric overflow.
 * @param left - first strict SemVer value.
 * @param right - second strict SemVer value.
 * @returns negative, zero, or positive precedence, or null when either value is invalid.
 */
export function compareSemVerVersions(left: string, right: string): number | null {
  const leftVersion = parseSemVer(left)
  const rightVersion = parseSemVer(right)
  if (leftVersion === null || rightVersion === null) return null
  return compareParsedSemVer(leftVersion, rightVersion)
}

/**
 * Check the fixed Sensteed-Agent version endpoint for a release in one channel.
 * @param options - installed version, caller-owned signal, and optional request adapter.
 * @returns a successful comparison, or null when any request or validation step fails.
 */


export function parseCanonicalChannelVersion(
  input: string,
  channel: DesktopReleaseChannel,
): ParsedSemVer | null {
  const parsed = parseCanonicalVersion(input)
  if (parsed === null) return null
  if (channel === 'stable') return parsed.prerelease.length === 0 ? parsed : null
  if (channel === 'next' && parsed.prerelease.length === 1 && parsed.prerelease[0] === 'next') return parsed
  return parsed.prerelease.length === 2
    && parsed.prerelease[0] === channel
    && isNumeric(parsed.prerelease[1]!)
    ? parsed
    : null
}

/**
 * Extract optional per-platform installer digests from the parsed version
 * response: `{ "version": "2.0.2", "sha256": { "windows": "<hex>", "mac": "<hex>" } }`.
 * Hex digits are case-normalized; absent or malformed fields simply leave the
 * digest gate unset for that platform.
 */


export function parseCanonicalSupportedVersion(input: string): ParsedSemVer | null {
  return parseCanonicalChannelVersion(input, 'stable')
    ?? parseCanonicalChannelVersion(input, 'beta')
    ?? parseCanonicalChannelVersion(input, 'next')
}

function parseCanonicalVersion(input: string): ParsedSemVer | null {
  const parsed = parseSemVer(input)
  return parsed !== null && parsed.version === input ? parsed : null
}

export function compareParsedSemVer(left: ParsedSemVer, right: ParsedSemVer): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    const comparison = compareNumeric(left[key], right[key])
    if (comparison !== 0) return comparison
  }
  if (left.prerelease.length === 0) return right.prerelease.length === 0 ? 0 : 1
  if (right.prerelease.length === 0) return -1

  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index]
    const rightIdentifier = right.prerelease[index]
    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1
    if (leftIdentifier === rightIdentifier) continue

    const leftNumeric = isNumeric(leftIdentifier)
    const rightNumeric = isNumeric(rightIdentifier)
    if (leftNumeric && rightNumeric) return compareNumeric(leftIdentifier, rightIdentifier)
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    return leftIdentifier < rightIdentifier ? -1 : 1
  }
  return 0
}

function compareNumeric(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

function isNumeric(identifier: string): boolean {
  return /^[0-9]+$/u.test(identifier)
}

function hasLeadingZero(identifier: string): boolean {
  return identifier.length > 1 && identifier.startsWith('0')
}

