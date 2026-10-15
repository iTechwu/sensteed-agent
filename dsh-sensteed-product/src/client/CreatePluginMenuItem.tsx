/** Start a real Creator conversation from the Plugins page. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { IconAgentPresetOutlineRegular, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { sensteedCreatePlugin: unknown }
}

const SKILL = 'dsh-sensteed-create-plugin'
const INITIAL_PROMPT = `/${SKILL}\n\n我想创建一个 DSH 插件。请先问我需要描述的插件目标、使用场景、输入和期望结果。`

interface CreatePluginMenuItemInjected {
  readonly startCreator: () => Promise<void>
}

type CreatePluginMenuItemProps = PropsRuntime<'plugins.add.actions'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<CreatePluginMenuItemInjected>

/** Pick the workspace containing the current main-view Session. */
function currentWorkspaceId(ctx: Context): WorkspaceId | undefined {
  return ctx.workspaces.list.getSnapshot().items[0]?.workspaceId
}

/** Create, select, and prompt a fresh Creator session. */
export async function startCreatorConversation(ctx: Context): Promise<SessionId> {
  const workspaceId = currentWorkspaceId(ctx)
  const sessionId = await ctx.sessions.create({
    ...(workspaceId === undefined ? {} : { workspaceId }),
    agentPreset: 'cordis',
  })
  ctx.uiWorkspace.openSession(sessionId)
  const reference = ctx.sessions.retain(sessionId, { source: 'sensteedCreatePlugin' })
  try {
    const binding = await reference.ready
    const result = await binding.session.prompt([{ type: 'text', text: INITIAL_PROMPT }], 'queue')
    if (!result.ok) throw new Error(result.error.message)
    return sessionId
  } finally {
    reference.release()
  }
}

/** Replace the upstream draft-only action with an action that sends the skill invocation. */
export function CreatePluginMenuItem({ t, onDismiss, startCreator }: CreatePluginMenuItemProps) {
  return (
    <MenuItemButton icon={<IconAgentPresetOutlineRegular size={14} />} onSelect={() => {
      onDismiss()
      void startCreator().catch(reason => console.error('Creator session failed:', reason))
    }}>
      <span>
        <span>{t('createPlugin')}</span>
        <span>{t('createPluginDescription')}</span>
      </span>
    </MenuItemButton>
  )
}

