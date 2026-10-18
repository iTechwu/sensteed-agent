/** Host-side execution input is accepted only from the launcher, after its separate grant validation. */
import { HubGenerationStore, type HubGenerationIdentity } from './hub-generation-store.ts'
import { reopenHubGenerationBoot, type HubGenerationBootReference } from './hub-generation-boot.ts'
import { hubGenerationPatch, inspectHubGenerationLoaded, type HubLoaderObservation, type HubSkillObservation } from './hub-generation-health.ts'
import { managedProfilePackageUrls } from './module-resolution.ts'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { hubOverlayComposition } from './hub-base-composition.ts'

export interface HubGenerationHostHealth {
  readonly generationId: string
  readonly skillsRoot: string
  inspectLoaded(skills: HubSkillObservation, providerName: string): Promise<import('./hub-generation-health.ts').HubLoadedEvidence>
}
declare module '@deepseek-ai/cordis' { interface Context { hubGenerationBoot: HubGenerationHostHealth } }
export interface HubTrustedHostBootInput {
  readonly reference: HubGenerationBootReference
  /** Independently selected launcher identity, not derived from reference or renderer request. */
  readonly expectedIdentity: HubGenerationIdentity
  /** Host provider identity established by trusted roots policy, never a renderer field. */
  readonly skillProviderName: string
}
export function prepareHubHostBoot(input: HubTrustedHostBootInput, logicalProfileDirectory: string, basePatches: readonly PatchOptions[]) {
  if (input.skillProviderName !== `hub-${input.reference.generationId}`) throw new Error('Invalid Hub skill provider identity')
  const boot = reopenHubGenerationBoot(input.reference, input.expectedIdentity, logicalProfileDirectory)
  const store = new HubGenerationStore(input.reference.root, input.expectedIdentity)
  const patch = hubGenerationPatch(store)
  const compose = (base: readonly PatchOptions[]) => hubOverlayComposition(base, patch)
  const patches = compose(basePatches)
  return {
    ...boot, store, patch, patches, compose, skillProviderName: input.skillProviderName,
    async inspectLoaded(loader: HubLoaderObservation, skills: HubSkillObservation, providerName: string) {
      return await inspectHubGenerationLoaded(store, boot.selection, logicalProfileDirectory, loader, skills, providerName,
        name => managedProfilePackageUrls(pathToFileURL(join(logicalProfileDirectory, 'package.json')).href, boot.selection, name))
    },
  }
}
