/** Next owns its enterprise composition and child lifecycle; signed execution stays shared. */
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { bundlePatchPaths, composeEntries, loadOverlayPatches, PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { loadNextProfile, readNextProfilePatches } from './profiles.ts'
import { HubHostSupervisor, type HubHostLifetime } from '../../dsh-plugin-desktop/src/hub-host-supervisor.ts'
import { HubSupervisorRequestSchema, type HubGenerationSupervisor, type HubSupervisorRequest } from '../../dsh-plugin-desktop/src/hub-supervisor-protocol.ts'
import { HubGenerationStore } from '../../dsh-plugin-desktop/src/hub-generation-store.ts'
import { HubExecutionJournal } from '../../dsh-plugin-desktop/src/hub-execution-journal.ts'
import { inspectSavedHubPlan } from '../../dsh-plugin-desktop/src/hub-saved-plan.ts'
import { verifyHubBootAuthorization } from '../../dsh-plugin-desktop/src/hub-boot-authorization.ts'
import { verifyHubGenerationContent } from '../../dsh-plugin-desktop/src/hub-generation-content.ts'
import { hubGenerationBootReference } from '../../dsh-plugin-desktop/src/hub-generation-boot.ts'
import { prepareHubHostBoot, type HubTrustedHostBootInput } from '../../dsh-plugin-desktop/src/hub-host-boot.ts'
import { withDesktopMaintenance } from '../../dsh-plugin-desktop/src/desktop-maintenance.ts'
import { HubSyncTargetSchema, type HubReleaseTrust, type HubSyncTarget } from '../../dsh-plugin-desktop/src/hub-sync-verifier.ts'
import { hubBaseComposition } from '../../dsh-plugin-desktop/src/hub-base-composition.ts'
import type { HubLoadedEvidence } from '../../dsh-plugin-desktop/src/hub-generation-health.ts'

export interface NextHubBootPlanOptions {
  mode: 'standard' | 'enterprise'; home: string; profileDirectory: string; installAnchor: string
  target?: HubSyncTarget; supervisor?: HubGenerationSupervisor; generation?: HubTrustedHostBootInput
  /** Launcher-owned overlays only. */
  patchFiles?: readonly string[]
}
export async function nextHubBootPlan(options: NextHubBootPlanOptions) {
  if (options.mode === 'standard') {
    const profile = loadNextProfile(options.profileDirectory, options.home, options.installAnchor)
    return { runner: 'runProfile' as const, patches: [...profile.layers.flatMap(layer => layer.patches), ...profile.patches],
      readPatches: () => readNextProfilePatches(options.profileDirectory, options.home, options.patchFiles ?? []) }
  }
  if (!options.target) throw Error('HUB_NEXT_TARGET_REQUIRED')
  HubSyncTargetSchema.parse(options.target)
  if (!options.supervisor) throw Error('HUB_NEXT_SUPERVISOR_REQUIRED')
  const require = createRequire(options.installAnchor)
  // Load fixed installation bundles directly. Never ask a user manifest which code belongs to the seal.
  const bundles = [...PROFILE_TEMPLATES.web!.bundles, 'dsh-desktop-next', '@dofe/dsh-sensteed-product']
  const patches = bundles.flatMap(name => {
    const manifestPath = name === 'dsh-desktop-next' ? options.installAnchor : require.resolve(`${name}/package.json`)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dsh?: { bundle?: { patch: string | string[] } } }
    if (!manifest.dsh?.bundle) throw Error('HUB_NEXT_SEALED_BUNDLE_MISSING')
    return bundlePatchPaths(dirname(manifestPath), manifest.dsh.bundle).flatMap(file => loadOverlayPatches('dsh-desktop-next', file))
  })
  patches.push(...(options.patchFiles ?? []).flatMap(file => loadOverlayPatches('dsh-desktop-next', file)))
  const base: PatchOptions[] = hubBaseComposition([{ insert: [...composeEntries([patches])] }])
  const boot = options.generation ? prepareHubHostBoot(options.generation, options.profileDirectory, base) : undefined
  return { runner: 'sealed' as const, patches: boot?.patches ?? base, boot, readPatches: () => boot?.compose(base) ?? base }
}

export interface NextHubSupervisorOptions {
  target: HubSyncTarget; trust: HubReleaseTrust; userData: string; profileDirectory: string
  ensureMutationAllowed?(): Promise<void>
  rendererTimeoutMs?: number
  lifecycle: {
    start(input: HubTrustedHostBootInput | undefined, bind: (host: HubHostLifetime) => void): Promise<void>
    waitRendererHealthy(generationId: string): Promise<void>
    inspectHealth(): Promise<HubLoadedEvidence>
  }
}
export class NextHubSupervisor implements HubGenerationSupervisor {
  private readonly owner = new HubHostSupervisor()
  private tail: Promise<void> = Promise.resolve()
  private readonly cancelled=new AbortController()
  constructor(private readonly options: NextHubSupervisorOptions) {}
  start(): Promise<void> { return this.owner.replace(async () => {}, bind => this.options.lifecycle.start(undefined, bind)) }
  async waitRendererHealthy(id: string): Promise<void> {
    const signal=this.cancelled.signal;signal.throwIfAborted()
    let timer:ReturnType<typeof setTimeout>|undefined,abort=()=>{}
    try{await Promise.race([this.options.lifecycle.waitRendererHealthy(id),new Promise<never>((_yes,no)=>{abort=()=>no(signal.reason);signal.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>no(Error('HUB_NEXT_RENDERER_TIMEOUT')),this.options.rendererTimeoutMs??45000);timer.unref()})])}
    finally{clearTimeout(timer);signal.removeEventListener('abort',abort)}
  }

  request(input: HubSupervisorRequest, isCurrent:()=>boolean=()=>true): Promise<void> {
    const work = this.tail.then(() => withDesktopMaintenance('hub-generation', () => {this.cancelled.signal.throwIfAborted();return isCurrent()?this.switch(input):Promise.resolve()}, this.options.userData))
    this.tail = work.catch(() => {}); return work
  }
  private async switch(raw: HubSupervisorRequest): Promise<void> {
    const request = HubSupervisorRequestSchema.parse(raw), { lifecycle, target, trust, userData, profileDirectory } = this.options
    const base = (mutate: () => Promise<void> = async () => {}) => this.owner.replace(mutate, bind => lifecycle.start(undefined, bind))
    if (request.kind === 'base') { await base(); return }
    const store = new HubGenerationStore(userData, request.identity), journal = new HubExecutionJournal(store)
    const rollback = async () => { const state = store.readState(); if (state.phase === 'verifying' || state.phase === 'stable' && state.previous !== null) await store.rollback() }
    if (request.kind === 'activate') {
      await this.options.ensureMutationAllowed?.()
      const record = journal.read(), state = store.readState()
      if (!record || record.operationId !== request.operationId || record.phase !== 'STAGED' || record.pendingReceipt !== null || state.phase !== 'prepared' || state.pending?.descriptorDigest !== record.descriptorDigest) throw Error('HUB_RESTART_NOT_READY')
      inspectSavedHubPlan(record, request.identity, target, trust)
      try { await base(async () => { await store.activate() }) }
      catch (cause) {
        // A failed old-child stop never changed the pointer and retains ownership.
        if (store.readState().phase !== 'prepared') await base(rollback)
        throw cause
      }
      return
    }
    const active = store.readState().active, pending = journal.read(), record = pending?.descriptorDigest === active?.descriptorDigest ? pending : journal.readHealthyInventory()
    if (!record || record.generationDigest !== request.generationDigest || record.phase !== 'COMMITTED' && record.phase !== 'ACTIVATED') throw Error('HUB_NEXT_MANAGED_MISMATCH')
    const saved = inspectSavedHubPlan(record, request.identity, target, trust)
    verifyHubBootAuthorization(request.lease, trust, { ...request.identity, target, generationDigest: request.generationDigest, minimumPolicyRevision: saved.plan.policyRevision })
    verifyHubGenerationContent(store, saved.plan, trust)
    const reference = hubGenerationBootReference(store, profileDirectory)
    const input = { reference, expectedIdentity: request.identity, skillProviderName: `hub-${reference.generationId}` }
    try {
      await this.owner.replace(async () => {}, bind => lifecycle.start(input, bind))
      await this.waitRendererHealthy(reference.generationId)
      const evidence = await lifecycle.inspectHealth()
      if (evidence.generationId !== reference.generationId) throw Error('HUB_NEXT_HEALTH_MISMATCH')
    } catch (cause) {if(this.cancelled.signal.aborted)await this.owner.replace(rollback,async()=>{});else await base(rollback);throw cause }
  }
  async dispose(): Promise<void> { this.cancelled.abort(Error('HUB_NEXT_SUPERVISOR_STOPPED'));await this.tail;await this.owner.dispose() }
}
