/** Proposed Next-owned public seam. This file is test scaffolding, not runtime implementation. */
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { HubTrustedHostBootInput } from '../../dsh-plugin-desktop/src/hub-host-boot.ts'
import type { HubLoadedEvidence } from '../../dsh-plugin-desktop/src/hub-generation-health.ts'
import type { HubReleaseTrust, HubSyncTarget } from '../../dsh-plugin-desktop/src/hub-sync-verifier.ts'
import type { HubGenerationSupervisor, HubSupervisorRequest } from '../../dsh-plugin-desktop/src/hub-supervisor-protocol.ts'
type NextHostLifetime = { fiber: { dispose(): void | Promise<void> } }

export interface NextHubBootPlanOptions {
  mode: 'standard' | 'enterprise'
  home: string
  profileDirectory: string
  installAnchor: string
  target?: HubSyncTarget
  supervisor?: HubGenerationSupervisor
  generation?: HubTrustedHostBootInput
}
export interface NextHubSupervisorOptions {
  target: HubSyncTarget
  trust: HubReleaseTrust
  userData: string
  profileDirectory: string
  lifecycle: {
    start(input: HubTrustedHostBootInput | undefined, bind: (host: NextHostLifetime) => void): Promise<void>
    waitRendererHealthy(generationId: string): Promise<void>
    inspectHealth(): Promise<HubLoadedEvidence>
  }
}
export interface NextHubSupervisorContract extends HubGenerationSupervisor {
  start(): Promise<void>
  request(input: HubSupervisorRequest): Promise<void>
  dispose(): Promise<void>
}
interface NextHubIntegration {
  nextHubBootPlan(options: NextHubBootPlanOptions): Promise<{
    runner: 'runProfile' | 'sealed'
    patches: readonly PatchOptions[]
    readPatches(): readonly PatchOptions[] | Promise<readonly PatchOptions[]>
  }>
  NextHubSupervisor: new(options: NextHubSupervisorOptions) => NextHubSupervisorContract
}
export async function loadNextHubIntegration(): Promise<NextHubIntegration> {
  // Dynamic lookup keeps all missing-feature tests individually RED before the module exists.
  const path = new URL('../src/hub-integration.ts', import.meta.url).href
  return await import(path) as NextHubIntegration
}
