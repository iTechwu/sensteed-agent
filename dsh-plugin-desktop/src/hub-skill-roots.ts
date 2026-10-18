/** L0 owns the complete managed skill roots; ordinary agent settings cannot extend them. */
import type { Context } from '@deepseek-ai/cordis'
import * as filesystemSkills from '@deepseek-ai/dsh-skill-filesystem'
import type { prepareHubHostBoot } from './hub-host-boot.ts'

export function registerHubSkillRoots(ctx: Context, boot: ReturnType<typeof prepareHubHostBoot>): void {
  const dispose = filesystemSkills.installFilesystemSkillRootPolicy(ctx, {
    generationId: boot.generationId,
    providerName: boot.skillProviderName,
    roots: [{ path: boot.skillsRoot, source: 'hub', rank: 100 }],
  })
  ctx.effect(() => dispose, 'Desktop immutable Hub skill roots')
  ctx.inject(['skills'], async scope => {
    await scope.plugin(filesystemSkills, {
      providerName: boot.skillProviderName,
      includeDefaultRoots: false,
      watch: false,
    })
  })
}
