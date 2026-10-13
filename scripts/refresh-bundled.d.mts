/** Bundled content (skills + plugins) manifest loaded from `bundled.json`. */
export interface BundledManifest {
  readonly version: number
  readonly skills: BundledSkillEntry[]
  readonly plugins: BundledPluginEntry[]
}

export interface BundledSkillEntry {
  readonly name: string
  readonly repository: string
  readonly ref?: string | null
  readonly snapshotDir: string
  readonly resolvedSha?: string
  readonly refreshedAt?: string
}

export interface BundledPluginEntry {
  readonly name: string
  readonly package: string
  readonly source: 'sibling' | 'github'
  readonly snapshotDir: string
  readonly upstream?: string
  readonly siblingDir?: string
  readonly siblingRepository?: string
}

/** One normalized skill output detected inside a cloned skill repository. */
export interface BundledSkillTarget {
  readonly name: string
  readonly kind: 'dir' | 'flat'
  readonly from: string
}

export function loadManifest(root: string, manifestPath?: string): Promise<BundledManifest>

export function normalizeSkillName(raw: string): string

export function fetchRepository(
  root: string,
  repository: string,
  ref?: string,
): { cache: string, sha: string }

export function planSkillTargets(
  repoDir: string,
  options?: { fallbackName?: string },
): BundledSkillTarget[]

export function refreshBundledContents(
  root: string,
  options?: {
    write?: boolean
    network?: boolean
    force?: boolean
    select?: (kind: 'skill' | 'plugin', name: string) => boolean
    log?: (line: string) => void
  },
): Promise<{
  refreshed: string[]
  degraded: string[]
  writtenBack: string[]
  shaByRepository: Map<string, string>
}>

export function verifyBundled(root: string): Promise<string[]>

export const BUNDLED_SKILLS_ROOT: string
export const BUNDLED_MANIFEST: string
