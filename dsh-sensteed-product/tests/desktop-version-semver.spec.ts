import { describe, expect, it } from 'vitest'
import { compareSemVerVersions, parseCanonicalChannelVersion, parseSemVer } from '../src/desktop-version-semver.ts'

describe('desktop version semver', () => {
  it('parses strict semver with an optional v prefix and rejects leading zeros', () => {
    expect(parseSemVer('v2.0.11')?.version).toBe('2.0.11')
    expect(parseSemVer('2.01.0')).toBeNull()
    expect(parseSemVer('2.0.11-beta.18')?.prerelease).toEqual(['beta', '18'])
  })

  it('compares precedence without numeric overflow', () => {
    expect(compareSemVerVersions('2.10.0', '2.9.0')).toBeGreaterThan(0)
    expect(compareSemVerVersions('2.0.0-beta', '2.0.0')).toBeLessThan(0)
    expect(compareSemVerVersions('nope', '2.0.0')).toBeNull()
  })

  it('applies channel prerelease rules', () => {
    expect(parseCanonicalChannelVersion('2.0.11-beta.18', 'beta')?.version).toBe('2.0.11-beta.18')
    expect(parseCanonicalChannelVersion('2.0.11-beta.18', 'stable')).toBeNull()
    expect(parseCanonicalChannelVersion('2.0.11', 'stable')?.version).toBe('2.0.11')
  })
})
