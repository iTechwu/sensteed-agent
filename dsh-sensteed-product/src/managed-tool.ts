import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { DofePluginId } from './dofe-plugins.ts'
import type {} from './dofe-managed.ts'

export function managedPluginAllowed(ctx: Context, plugin: DofePluginId): boolean {
  const gate = ctx.dofeAccess()
  return gate.ready && gate.enabledPlugins?.includes(plugin) === true
    && gate.entitlements?.plugins.includes(plugin) === true
}

/** Hide the tool on revocation and recheck captured definitions before execution. */
export function registerManagedTool(ctx: Context, plugin: DofePluginId, tool: ToolDefinition): () => void {
  let dispose: (() => void) | undefined
  const reconcile = () => {
    if (!managedPluginAllowed(ctx, plugin)) {
      dispose?.()
      dispose = undefined
    } else if (!dispose) {
      dispose = ctx.tools.register({ ...tool, execute: (args, execution) => {
        if (!managedPluginAllowed(ctx, plugin)) throw new Error('This capability is not enabled for the current user')
        return tool.execute(args, execution)
      } })
    }
  }
  reconcile()
  const stop = ctx.on('dofe/access-changed', reconcile)
  return () => { stop(); dispose?.(); dispose = undefined }
}
