/** Headless version checks against the branded release service. */

import {
  assertDesktopInstallationId,
  DESKTOP_INSTALLATION_ID_HEADER,
  type DesktopInstallationId,
} from './desktop-installation-id.ts'
import {
  MAX_VERSION_RESPONSE_BYTES,
  compareParsedSemVer,
  parseCanonicalChannelVersion,
  parseCanonicalSupportedVersion,
  type DesktopReleaseChannel,
  type ParsedSemVer,
} from '@dofe/dsh-sensteed-product/desktop-version-semver'
import { BRAND_UPDATE_SERVICE } from './generated-product-identity.ts'

/** Public endpoint returning the latest Desktop version for a requested channel. */
export type { DesktopReleaseChannel, ParsedSemVer } from '@dofe/dsh-sensteed-product/desktop-version-semver'
export { MAX_VERSION_RESPONSE_BYTES, compareSemVerVersions, compareParsedSemVer, parseCanonicalChannelVersion, parseCanonicalSupportedVersion, parseSemVer } from '@dofe/dsh-sensteed-product/desktop-version-semver'

export const DESKTOP_VERSION_ENDPOINT = BRAND_UPDATE_SERVICE.endpoint

/** Header carrying the installed Desktop version to the fixed version endpoint. */
export const DESKTOP_CURRENT_VERSION_HEADER = BRAND_UPDATE_SERVICE.versionHeader

/** Header selecting an isolated Desktop release stream. */
export const DESKTOP_RELEASE_CHANNEL_HEADER = BRAND_UPDATE_SERVICE.channelHeader

/** Release streams supported by the Desktop service. */
export type UpdateRequest = (url: string, init: RequestInit) => Promise<Response>

/** Inputs for one channel-scoped version check. */
export interface UpdateCheckOptions {
  /** Installed application version, expressed as canonical SemVer. */
  readonly currentVersion: string
  /** Release stream that must be returned by the service. */
  readonly channel: DesktopReleaseChannel
  /** Channel of the installed application when explicitly switching streams. */
  readonly currentChannel?: DesktopReleaseChannel
  /** Treat a different older version as selectable for an explicit channel switch. */
  readonly allowDowngrade?: boolean
  /** Caller-owned cancellation signal; the checker does not create its own timeout. */
  readonly signal?: AbortSignal
  /** Optional fetch implementation for a host adapter or test. */
  readonly request?: UpdateRequest
  /** Installation UUID attached only to the fixed version-check endpoint. */
  readonly installationId?: DesktopInstallationId
}

/** Successful comparison returned by the stable version service. */
export type UpdateCheckResult = {
  /** Whether the service reports a version newer than the installed application. */
  readonly status: 'up-to-date' | 'update-available'
  /** Canonical installed version, including any prerelease identifiers. */
  readonly currentVersion: string
  /** Canonical latest stable version returned by the service. */
  readonly latestVersion: string
  /**
   * Optional per-platform hex SHA-256 digests of the published installers.
   * Whenever the service publishes them, the download path enforces them as
   * a hard integrity gate before execution; they are optional only because
   * the version endpoint does not publish digests yet.
   */
  readonly installerSha256?: Readonly<Partial<Record<'win32' | 'darwin', string>>>
}

export async function checkForDesktopUpdate(
  options: UpdateCheckOptions,
): Promise<UpdateCheckResult | null> {
  const current = parseCanonicalChannelVersion(
    options.currentVersion,
    options.currentChannel ?? options.channel,
  )
  if (current === null) return null

  let headers: HeadersInit
  try {
    headers = desktopVersionRequestHeaders(options.installationId, current.version, options.channel)
  } catch {
    return null
  }

  const init: RequestInit = {
    method: 'GET',
    headers,
    cache: 'no-store',
    redirect: 'error',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
  const request = options.request ?? defaultRequest

  let response: Response
  try {
    response = await request(DESKTOP_VERSION_ENDPOINT, init)
  } catch {
    return null
  }
  if (response.status !== 200) return null

  let body: string
  try {
    body = await readLimitedBody(response)
  } catch {
    return null
  }

  let digestInput: unknown
  try {
    digestInput = JSON.parse(body)
  } catch {
    digestInput = undefined
  }
  const latest = parseVersionResponse(body, options.channel)
  if (latest === null) return null
  const comparison = compareParsedSemVer(latest, current)
  const digests = parseInstallerDigestResponse(digestInput)
  return {
    status: comparison > 0 || (options.allowDowngrade === true && comparison !== 0)
      ? 'update-available'
      : 'up-to-date',
    currentVersion: current.version,
    latestVersion: latest.version,
    ...(digests === undefined ? {} : { installerSha256: digests }),
  }
}

/** Backward-compatible stable-channel entry point for existing callers. */
export function checkForStableUpdate(
  options: Omit<UpdateCheckOptions, 'channel'>,
): Promise<UpdateCheckResult | null> {
  return checkForDesktopUpdate({ ...options, channel: 'stable' })
}

/** Build the complete header set for the fixed version-check request only. */
export function desktopVersionRequestHeaders(
  installationId?: string,
  currentVersion?: string,
  channel?: DesktopReleaseChannel,
): Readonly<Record<string, string>> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (channel !== undefined) headers[DESKTOP_RELEASE_CHANNEL_HEADER] = channel
  if (currentVersion !== undefined) {
    const parsed = channel === undefined
      ? parseCanonicalChannelVersion(currentVersion, 'stable')
      : parseCanonicalSupportedVersion(currentVersion)
    if (parsed === null) {
      throw new Error(channel === undefined
        ? 'Desktop current version must be canonical stable SemVer.'
        : 'Desktop current version must be canonical SemVer.')
    }
    headers[DESKTOP_CURRENT_VERSION_HEADER] = parsed.version
  }
  if (installationId !== undefined) {
    headers[DESKTOP_INSTALLATION_ID_HEADER] = assertDesktopInstallationId(installationId)
  }
  return headers
}

async function defaultRequest(url: string, init: RequestInit): Promise<Response> {
  return globalThis.fetch(url, init)
}

async function readLimitedBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null
    && /^[0-9]+$/u.test(declaredLength)
    && BigInt(declaredLength) > BigInt(MAX_VERSION_RESPONSE_BYTES)) {
    throw new Error('version response is too large')
  }

  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytesRead = 0
  let body = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytesRead += chunk.value.byteLength
      if (bytesRead > MAX_VERSION_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error('version response is too large')
      }
      body += decoder.decode(chunk.value, { stream: true })
    }
    return body + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

function parseVersionResponse(body: string, expectedChannel: DesktopReleaseChannel): ParsedSemVer | null {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  if (!isRecord(value) || typeof value.version !== 'string') return null
  if (expectedChannel !== 'stable' && value.channel !== expectedChannel) return null
  if (value.channel !== undefined && value.channel !== expectedChannel) return null
  return parseCanonicalChannelVersion(value.version, expectedChannel)
}

function parseInstallerDigestResponse(value: unknown): UpdateCheckResult['installerSha256'] | undefined {
  if (!isRecord(value) || !isRecord(value.sha256)) return undefined
  const digests: Partial<Record<'win32' | 'darwin', string>> = {}
  const normalize = (digest: unknown): string | undefined => {
    if (typeof digest !== 'string') return undefined
    const normalized = digest.trim().toLowerCase()
    return /^[0-9a-f]{64}$/u.test(normalized) ? normalized : undefined
  }
  const windows = normalize(value.sha256.windows)
  const mac = normalize(value.sha256.mac)
  if (windows !== undefined) digests.win32 = windows
  if (mac !== undefined) digests.darwin = mac
  return Object.keys(digests).length > 0 ? digests : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
