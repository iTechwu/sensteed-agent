/** L0 owns the complete managed skill roots; ordinary agent settings cannot extend them. */
import type { Context } from '@deepseek-ai/cordis'
import * as filesystemSkills from '@deepseek-ai/dsh-skill-filesystem'
import type { prepareHubHostBoot } from './hub-host-boot.ts'
import { bundledSkillRoot } from './bundled-skill-root.ts'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

type RootPolicy = {
  generationId: string
  providerName: string
  roots: readonly { path: string; source: string; rank: number }[]
  userRoots?: readonly string[]
}

type FilesystemSkillModule = typeof filesystemSkills & {
  installFilesystemSkillRootPolicy?: (ctx: Context, policy: RootPolicy) => () => void
}

function installRootPolicy(ctx: Context, policy: RootPolicy): () => void {
  const installer = (filesystemSkills as FilesystemSkillModule).installFilesystemSkillRootPolicy
  return installer === undefined ? () => {} : installer(ctx, policy)
}

function hasRootPolicy(): boolean {
  return (filesystemSkills as FilesystemSkillModule).installFilesystemSkillRootPolicy !== undefined
}

function providerConfig(providerName: string, roots: readonly { path: string }[], userRoots: readonly string[] | undefined) {
  const config = {
    providerName,
    includeDefaultRoots: false,
    watch: false,
  }
  return hasRootPolicy() ? config : {
    ...config,
    customSkillDirs: [...roots, ...(userRoots ?? []).map(path => ({ path }))].map(root => root.path),
  }
}

type SealedSkillOptions = { readonly bundledRoot?: string | null }
function sealedBundledRoots(disabled: ReadonlySet<string> = new Set(), options:SealedSkillOptions={}) {
 const path = options.bundledRoot === undefined ? bundledSkillRoot() : options.bundledRoot
 if (path == null) return []
 if (disabled.size === 0) return [{ path, source: 'bundled' as const, rank: 600 }]
 // Individual sealed roots let the existing filesystem policy omit disabled
 // fallback names without copying or modifying the installation's originals.
 return readdirSync(path, { withFileTypes: true }).filter(entry => entry.isDirectory() && !disabled.has(entry.name))
  .map(entry => ({ path: join(path, entry.name), source: 'bundled' as const, rank: 600 }))
}

export function registerHubBootstrapSkillRoots(ctx:Context,userRoot?:string,options:SealedSkillOptions={}):void {
 const roots = sealedBundledRoots(new Set(),options)
 const dispose=installRootPolicy(ctx,{generationId:'bootstrap',providerName:'hub-bootstrap',roots,...(userRoot?{userRoots:[userRoot]}:{})})
 ctx.effect(()=>dispose,'Desktop sealed bundled fallback skill roots')
 ctx.inject(['skills'],async scope=>{await scope.plugin(filesystemSkills,providerConfig('hub-bootstrap',roots,userRoot === undefined ? undefined : [userRoot]))})
 if(userRoot)registerUserSkillProvider(ctx)
}

function registerUserSkillProvider(ctx:Context):void {ctx.inject(['skills'],async scope=>{await scope.plugin(filesystemSkills,{providerName:'user-local',includeDefaultRoots:false,watch:false})})}

export function registerHubSkillRoots(ctx: Context, boot: ReturnType<typeof prepareHubHostBoot>,userRoot?:string,options:SealedSkillOptions={}): void {
  const descriptor = boot.store.activeDescriptor()
  if (!descriptor || descriptor.generationId !== boot.generationId) throw new Error('Hub skill generation changed before root registration')
  const disabled = new Set([...(descriptor.suppressedSkills ?? []), ...Object.keys(descriptor.files).flatMap(path => {
    const match = /^disabled-skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/u.exec(path)
    return match ? [match[1]!] : []
  })])
  const roots = [{ path: boot.skillsRoot, source: 'hub' as const, rank: 100 }, ...sealedBundledRoots(disabled,options)]
  const dispose = installRootPolicy(ctx, {
    ...(userRoot?{userRoots:[userRoot]}:{}),
    generationId: boot.generationId,
    providerName: boot.skillProviderName,
    roots,
  })
  ctx.effect(() => dispose, 'Desktop immutable Hub skill roots')
  if(userRoot)registerUserSkillProvider(ctx)
  ctx.inject(['skills'], async scope => {
    await scope.plugin(filesystemSkills, providerConfig(boot.skillProviderName, roots, userRoot === undefined ? undefined : [userRoot]))
  })
}
