/** Host-side execution input is accepted only from the launcher, after its separate grant validation. */
import { HubGenerationStore, type HubGenerationIdentity } from './hub-generation-store.ts'
import { reopenHubGenerationBoot, type HubGenerationBootReference } from './hub-generation-boot.ts'
import { hubGenerationPatch, inspectHubGenerationLoaded, type HubLoaderObservation, type HubSkillObservation } from './hub-generation-health.ts'
import { managedProfilePackageUrls } from './module-resolution.ts'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

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
}
export function prepareHubHostBoot(input: HubTrustedHostBootInput, logicalProfileDirectory: string, existingEntryIds: readonly string[]) {
  const boot = reopenHubGenerationBoot(input.reference, input.expectedIdentity, logicalProfileDirectory)
  const store = new HubGenerationStore(input.reference.root, input.expectedIdentity)
  const patch = hubGenerationPatch(store)
  if (patch.insert.some(entry => existingEntryIds.includes(entry.id))) throw new Error('Hub composition collides with existing entry')
  return {
    ...boot, store, patch,
    async inspectLoaded(loader: HubLoaderObservation, skills: HubSkillObservation, providerName: string) {
      return await inspectHubGenerationLoaded(store, boot.selection, logicalProfileDirectory, loader, skills, providerName,
        name => managedProfilePackageUrls(pathToFileURL(join(logicalProfileDirectory, 'package.json')).href, boot.selection, name))
    },
  }
}
