/** Next enterprise Host bootstrap. Ordinary Next keeps the public runProfile path. */
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFileSync } from 'node:fs'
import { boot, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline, type AppReady } from '@deepseek-ai/dsh-cmdline'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import type { RunProfileOptions } from '@deepseek-ai/dsh/profile-boot'
import type { Context } from '@deepseek-ai/cordis'
import { nextHubBootPlan } from '../hub-integration.ts'
import { installProfilePackageResolver } from '../../../dsh-plugin-desktop/src/module-resolution.ts'
import { DesktopPluginPackages } from '../../../dsh-plugin-desktop/src/plugin-packages.ts'
import { findOverlayPackage } from '../../../dsh-plugin-desktop/src/package-overlay.ts'
import { registerHubHostService } from '../../../dsh-plugin-desktop/src/hub-host-service.ts'
import { registerHubGenerationManager } from '../../../dsh-plugin-desktop/src/hub-generation-manager.ts'
import { registerHubGenerationRoutes } from '../../../dsh-plugin-desktop/src/hub-generation-routes.ts'
import {
  registerHubBootstrapSkillRoots,
  registerHubSkillRoots,
} from '../../../dsh-plugin-desktop/src/hub-skill-roots.ts'
import {
  provideHubSupervisor,
  type HubGenerationSupervisor,
} from '../../../dsh-plugin-desktop/src/hub-supervisor-protocol.ts'
import { HubSyncTargetSchema } from '../../../dsh-plugin-desktop/src/hub-sync-verifier.ts'
import type { HubTrustedHostBootInput } from '../../../dsh-plugin-desktop/src/hub-host-boot.ts'
import { z } from 'zod'

export const nextHubBootstrapSchema = z.strictObject({
  target: HubSyncTargetSchema,
  userData: z.string().min(1),
  generation: z.unknown().optional(),
})
export type NextHubBootstrap = z.infer<typeof nextHubBootstrapSchema>
export async function runNextEnterpriseProfile(
  options: RunProfileOptions,
  home: string,
  input: NextHubBootstrap,
  supervisor: HubGenerationSupervisor,
  launcher: {
    openExternal(url: string): Promise<void>
    reportPolicy(policy: unknown): void
  },
) {
  if (!options.resolvedProfile) throw Error('HUB_NEXT_PROFILE_REQUIRED')
  const { profile, installAnchor } = options.resolvedProfile
  const plan = await nextHubBootPlan({
    mode: 'enterprise',
    home,
    profileDirectory: profile.dir,
    installAnchor,
    target: input.target,
    supervisor,
    ...(input.generation
      ? { generation: input.generation as HubTrustedHostBootInput }
      : {}),
    patchFiles: options.patchFiles,
  })
  const hub = plan.boot
  const releaseResolver = installProfilePackageResolver(
    pathToFileURL(join(profile.dir, 'package.json')).href,
    hub?.selection,
    true,
    pathToFileURL(installAnchor).href,
  )
  const releaseProxy = await installProxyFromEnvironment(
    options.environment,
    (message) => process.stderr.write(`${message}\n`),
  )
  const listeners = new Set<() => void>()
  let ready = false,
    ctx: Context | undefined,
    disposed = false
  const appReady: AppReady = {
    onReady(listener) {
      if (disposed) return () => {}
      if (ready) listener()
      else listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  const context: ProfileContext & {
    resolvePackageManifest(name: string): string | undefined
  } = {
    name: basename(profile.dir),
    dir: profile.dir,
    patchPath: profile.patchPath,
    installAnchor,
    home,
    cwd: process.cwd(),
    startedBundles: [],
    overlays: [],
    telemetryDisabledEnv: '1',
    ...(options.packageManager
      ? { packageManager: options.packageManager }
      : {}),
    readPatches: () => plan.readPatches(),
    resolvePackageManifest: (name) =>
      findOverlayPackage(name, {
        installPackageUrl: pathToFileURL(installAnchor).href,
        profilePackageUrl: pathToFileURL(join(profile.dir, 'package.json'))
          .href,
        hostOwnedOnly: true,
        ...(hub ? { managedSelection: hub.selection } : {}),
      })?.selected.manifestPath,
  }
  let stopping: Promise<void> | undefined
  const dispose = () =>
    (stopping ??= (async () => {
      disposed = true
      listeners.clear()
      try {
        await ctx?.fiber.dispose()
      } finally {
        releaseResolver()
        await releaseProxy()
      }
    })())
  const root = join(profile.dir, 'desktop-next.enterprise.yml')
  writeFileSync(root, '[]\n', { mode: 0o600 })
  try {
    ctx = await boot(
      'dsh-desktop-next',
      root,
      [...plan.patches],
      async (host) => {
        ctx = host
        host.loader.internal = undefined
        host.provide('desktopRuntime', {
          platform: process.platform,
          version: input.target.sensteedVersion,
          openExternal: launcher.openExternal,
          openOpenMontage: async () => {
            throw Error('HUB_NEXT_EXTERNAL_TOOL_UNAVAILABLE')
          },
          registerTrayItem: () => ({ refresh() {}, dispose() {} }),
          reportMandatoryUpdatePolicy: launcher.reportPolicy,
          updates: {
            releaseChannel: 'next',
            statePath: join(input.userData, 'updates', 'state.json'),
            target: {
              os: input.target.os,
              arch: input.target.arch,
              format:
                input.target.os === 'darwin'
                  ? 'dmg'
                  : input.target.os === 'win32'
                    ? 'exe'
                    : 'appimage',
              installationMode: 'installed',
            },
            downloadAndOpen: async () => {
              throw Error('HUB_NEXT_USE_NATIVE_UPDATE_SETTINGS')
            },
          },
        } as never)
        host.provide('profileContext', context)
        host.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment)
        await host.plugin(DesktopPluginPackages)
        provideCmdline(host, {
          args: options.args,
          exit: () => {
            void dispose()
          },
          ready: appReady,
        })
        provideHubSupervisor(
          host,
          supervisor.request,
          supervisor.waitRendererHealthy,
        )
        registerHubHostService(host)
        registerHubGenerationRoutes(host)
        registerHubGenerationManager(host, {
          target: input.target,
          userData: input.userData,
          profileDirectory: profile.dir,
          managed: hub !== undefined,
        })
        // Next has no Stable bundled root. Only its explicit local skills root is user-owned.
        if (hub) {
          registerHubSkillRoots(host, hub, join(home, 'skills'), {
            bundledRoot: null,
          })
          host.provide('hubGenerationBoot', {
            generationId: hub.generationId,
            skillsRoot: hub.skillsRoot,
            inspectLoaded: (skills, provider) =>
              hub.inspectLoaded(host.loader, skills, provider),
          })
        } else
          registerHubBootstrapSkillRoots(host, join(home, 'skills'), {
            bundledRoot: null,
          })
      },
    )
    ready = true
    for (const listener of listeners) listener()
    listeners.clear()
    return {
      ctx,
      shutdown: {
        shutdown: async (_code: number) => {
          await dispose()
        },
      },
    }
  } catch (cause) {
    await dispose()
    throw cause
  }
}
