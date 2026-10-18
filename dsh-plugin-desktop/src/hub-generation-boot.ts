/** Reconstruct local generation authority inside either Host process without serializing capabilities. */
import { isAbsolute, join, resolve } from 'node:path'
import { HubGenerationStore, type HubGenerationIdentity, type HubManagedPackageSelection } from './hub-generation-store.ts'

/** Main-to-Host facts. No bearer, ticket, authorization decision or loaded-health assertion. */
export interface HubGenerationBootReference {
  readonly schemaVersion: 1
  readonly root: string
  readonly identity: HubGenerationIdentity
  readonly generationId: string
  readonly descriptorDigest: string
  readonly logicalProfileDirectory: string
}
export interface HubGenerationBoot {
  readonly reference: HubGenerationBootReference
  readonly selection: HubManagedPackageSelection
  readonly skillsRoot: string
  readonly generationId: string
}
function fail(): never { throw new Error('Hub generation boot reference does not match active Profile') }
/** Main selects local facts only after its independent authorization/activation decisions. */
export function hubGenerationBootReference(store: HubGenerationStore, logicalProfileDirectory: string): HubGenerationBootReference {
  if (!isAbsolute(logicalProfileDirectory) || resolve(logicalProfileDirectory) !== logicalProfileDirectory) fail()
  const state = store.readState()
  if (state.active === null) fail()
  store.activeDescriptor()
  return Object.freeze({ schemaVersion: 1, root: store.root, identity: store.identity, generationId: state.active.generationId,
    descriptorDigest: state.active.descriptorDigest, logicalProfileDirectory })
}
/** Host must supply launcher-owned expected identity and logical Profile anchor, not renderer values. */
export function reopenHubGenerationBoot(reference: HubGenerationBootReference, expectedIdentity: HubGenerationIdentity, expectedProfileDirectory: string): HubGenerationBoot {
  if (!reference || typeof reference !== 'object'
    || Object.keys(reference).sort().join(',') !== ['schemaVersion', 'root', 'identity', 'generationId', 'descriptorDigest', 'logicalProfileDirectory'].sort().join(',')
    || reference.schemaVersion !== 1 || reference.logicalProfileDirectory !== expectedProfileDirectory) fail()
  const store = new HubGenerationStore(reference.root, expectedIdentity)
  // Canonical field comparison, independent of object key order.
  for (const key of ['origin', 'tenantId', 'actorRef', 'deviceId', 'profileId'] as const) if (reference.identity[key] !== expectedIdentity[key]) fail()
  const state = store.readState()
  if (state.active?.generationId !== reference.generationId || state.active.descriptorDigest !== reference.descriptorDigest) fail()
  const descriptor = store.activeDescriptor()
  if (descriptor === undefined) fail()
  return Object.freeze({ reference, selection: store.managedSelection(expectedProfileDirectory),
    skillsRoot: join(store.generationDirectory(descriptor.generationId), descriptor.skillsRoot), generationId: descriptor.generationId })
}
