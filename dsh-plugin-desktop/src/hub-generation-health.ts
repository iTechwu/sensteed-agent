/** Exact local loaded evidence. Authorization, network health and renderer completion are separate gates. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hubManagedPackageManifest, type HubGenerationStore, type HubManagedPackageSelection } from './hub-generation-store.ts'

export interface HubLoaderObservation {
  entries(): Iterable<{ readonly options: { readonly id?: string; readonly name: string }; readonly disabled: boolean; readonly fiber?: { readonly state: number } }>
}
export interface HubSkillObservation {
  list(): Promise<readonly { readonly name: string; readonly path?: string; readonly provider: string; readonly source: string }[]>
}
export interface HubLoadedEvidence {
  readonly generationId: string
  readonly entryIds: readonly string[]
  readonly skillNames: readonly string[]
}
/** Returns insertion rows from the same sealed descriptor; caller must reject collisions with existing rows. */
export function hubGenerationPatch(store: HubGenerationStore): { insert: { id: string; name: string; config: Readonly<Record<string, unknown>> }[] } {
  const value = store.activeDescriptor()
  if (value?.schemaVersion !== 2 || value.verifiedComposition === undefined) throw new Error('Hub generation lacks verified composition')
  return { insert: value.verifiedComposition.entries.map(entry => ({ id: entry.id, name: entry.packageName, config: entry.config })) }
}
/** Must run in the actual Host after Loader settles and generation skill provider is mounted. */
export async function inspectHubGenerationLoaded(store: HubGenerationStore, selection: HubManagedPackageSelection,
  logicalProfileDirectory: string, loader: HubLoaderObservation, skills: HubSkillObservation, expectedProvider: string, observedModuleUrls: (packageName: string) => readonly string[]): Promise<HubLoadedEvidence> {
  const value = store.activeDescriptor()
  if (value?.schemaVersion !== 2 || value.verifiedComposition === undefined) throw new Error('Hub generation lacks verified composition')
  const actual = [...loader.entries()], entryIds: string[] = []
  for (const expected of value.verifiedComposition.entries) {
    const candidates = actual.filter(entry => entry.options.id === expected.id)
    if (candidates.length !== 1) throw new Error('Hub entry is missing or ambiguous')
    const entry = candidates[0]!
    if (entry.options.name !== expected.packageName || entry.disabled || entry.fiber?.state !== 2) throw new Error('Hub entry is not active')
    const pkg = value.packages.find(item => item.name === expected.packageName)
    if (pkg === undefined || hubManagedPackageManifest(selection, expected.packageName, logicalProfileDirectory) !== join(store.generationDirectory(value.generationId), pkg.manifest)) throw new Error('Hub entry package provenance mismatch')
    const packageRoot = dirname(join(store.generationDirectory(value.generationId), pkg.manifest))
    if (!observedModuleUrls(expected.packageName).some(url => {
      if (!url.startsWith('file:')) return false
      const path = fileURLToPath(url), offset = relative(packageRoot, path)
      return offset.length > 0 && !isAbsolute(offset) && offset !== '..' && !offset.startsWith(`..${sep}`) && !path.endsWith('/package.json')
    })) throw new Error('Hub package has no observed loaded module path')
    entryIds.push(expected.id)
  }
  const discovered = await skills.list(), skillNames: string[] = []
  for (const expected of value.verifiedComposition.skills) {
    const path = join(store.generationDirectory(value.generationId), expected.path)
    const candidates = discovered.filter(skill => skill.name === expected.name)
    if (candidates.length !== 1 || candidates[0]?.path !== path || candidates[0].provider !== expectedProvider || candidates[0].source !== 'hub') throw new Error('Hub skill discovery provenance mismatch')
    if (createHash('sha256').update(readFileSync(path)).digest('hex') !== expected.sha256) throw new Error('Hub discovered skill digest mismatch')
    skillNames.push(expected.name)
  }
  // Reject a transaction switch while discovery was awaiting asynchronous providers.
  if (store.activeDescriptor()?.generationId !== value.generationId) throw new Error('Hub generation changed during health inspection')
  return Object.freeze({ generationId: value.generationId, entryIds: Object.freeze(entryIds), skillNames: Object.freeze(skillNames) })
}
