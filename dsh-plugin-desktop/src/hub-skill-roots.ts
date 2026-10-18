/** L0 owns the complete managed skill roots; ordinary agent settings cannot extend them. */
import type { Context } from '@deepseek-ai/cordis'
import * as filesystemSkills from '@deepseek-ai/dsh-skill-filesystem'
import type { prepareHubHostBoot } from './hub-host-boot.ts'
import { bundledSkillRoot } from './bundled-skill-root.ts'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

function sealedBundledRoots(disabled: ReadonlySet<string> = new Set()) {
 const path = bundledSkillRoot()
 if (path === undefined) return []
 if (disabled.size === 0) return [{ path, source: 'bundled' as const, rank: 600 }]
 // Individual sealed roots let the existing filesystem policy omit disabled
 // fallback names without copying or modifying the installation's originals.
 return readdirSync(path, { withFileTypes: true }).filter(entry => entry.isDirectory() && !disabled.has(entry.name))
  .map(entry => ({ path: join(path, entry.name), source: 'bundled' as const, rank: 600 }))
}

export function registerHubBootstrapSkillRoots(ctx:Context,userRoot?:string):void {
 const dispose=filesystemSkills.installFilesystemSkillRootPolicy(ctx,{generationId:'bootstrap',providerName:'hub-bootstrap',roots:sealedBundledRoots(),...(userRoot?{userRoots:[userRoot]}:{})})
 ctx.effect(()=>dispose,'Desktop sealed bundled fallback skill roots')
 ctx.inject(['skills'],async scope=>{await scope.plugin(filesystemSkills,{providerName:'hub-bootstrap',includeDefaultRoots:false,watch:false})})
 if(userRoot)registerUserSkillProvider(ctx)
}

function registerUserSkillProvider(ctx:Context):void {ctx.inject(['skills'],async scope=>{await scope.plugin(filesystemSkills,{providerName:'user-local',includeDefaultRoots:false,watch:false})})}

export function registerHubSkillRoots(ctx: Context, boot: ReturnType<typeof prepareHubHostBoot>,userRoot?:string): void {
  const descriptor = boot.store.activeDescriptor()
  if (!descriptor || descriptor.generationId !== boot.generationId) throw new Error('Hub skill generation changed before root registration')
  const disabled = new Set(Object.keys(descriptor.files).flatMap(path => {
    const match = /^disabled-skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/u.exec(path)
    return match ? [match[1]!] : []
  }))
  const dispose = filesystemSkills.installFilesystemSkillRootPolicy(ctx, {
    ...(userRoot?{userRoots:[userRoot]}:{}),
    generationId: boot.generationId,
    providerName: boot.skillProviderName,
    roots: [{ path: boot.skillsRoot, source: 'hub', rank: 100 }, ...sealedBundledRoots(disabled)],
  })
  ctx.effect(() => dispose, 'Desktop immutable Hub skill roots')
  if(userRoot)registerUserSkillProvider(ctx)
  ctx.inject(['skills'], async scope => {
    await scope.plugin(filesystemSkills, {
      providerName: boot.skillProviderName,
      includeDefaultRoots: false,
      watch: false,
    })
  })
}
