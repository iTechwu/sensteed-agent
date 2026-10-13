/** Boot-time quick verification against the frozen Profile closure manifest. */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { desktopInstallAnchor } from './profile.ts'

/** Frozen first-party dependency snapshot written by `scripts/generate-profile-closure.mjs`. */
export interface DesktopProfileClosure {
  readonly schemaVersion: number
  readonly desktopVersion: string
  readonly dshVersion: string
  readonly packages: Record<string, string>
}

/**
 * Read the closure manifest sealed beside the install anchor.
 *
 * A missing or unreadable manifest degrades to `undefined`: development trees
 * and non-packaged embedders have no manifest by design, and the packaged
 * afterPack gate already guarantees one before signing.
 */
export function readDesktopProfileClosure(anchor: string = desktopInstallAnchor()): DesktopProfileClosure | undefined {
  let content: string
  try {
    content = readFileSync(join(dirname(anchor), 'lib', 'profile-closure.json'), 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(content)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const candidate = parsed as DesktopProfileClosure
    if (typeof candidate.desktopVersion !== 'string'
      || typeof candidate.dshVersion !== 'string'
      || candidate.packages === null
      || typeof candidate.packages !== 'object'
      || Array.isArray(candidate.packages)) {
      return undefined
    }
    return candidate
  } catch {
    return undefined
  }
}

/**
 * Compare the sealed snapshot against the anchor tree without spawning pnpm.
 *
 * Every pinned package must still resolve from the anchor with the exact
 * version recorded at packaging time. Violations mean the packaged tree and
 * its manifest disagree — a corruption signal for the recovery surface, never
 * a reason to install anything in the boot critical path.
 */
export function verifyDesktopProfileClosure(
  closure: DesktopProfileClosure,
  loadVersion: (packageName: string) => string = defaultLoadVersion,
): string[] {
  const violations: string[] = []
  for (const packageName of Object.keys(closure.packages).sort()) {
    const expected = closure.packages[packageName]
    if (expected === undefined) continue
    let actual: string
    try {
      actual = loadVersion(packageName)
    } catch {
      violations.push(`${packageName}@${expected} is missing from the packaged dependency tree`)
      continue
    }
    if (actual !== expected) {
      violations.push(`${packageName} resolves to ${actual} but the packaged closure pinned ${expected}`)
    }
  }
  return violations
}

function defaultLoadVersion(packageName: string): string {
  const require = createRequire(desktopInstallAnchor())
  const manifest = require(`${packageName}/package.json`) as { version?: string }
  if (typeof manifest.version !== 'string') {
    throw new Error(`desktop profile closure package ${packageName} has no version`)
  }
  return manifest.version
}
