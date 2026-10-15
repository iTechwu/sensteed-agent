/** Desktop creation action for the existing upstream task-management page. */
import { createElement, useState, type ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-schedule/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'

export const AUTOMATION_SKILL = 'sensteed-automation'

/** The leading slash invokes the skill deterministically at the Host pre-step boundary. */
export function automationPrompt(locale: string, timeZone: string): string {
  return locale.startsWith('zh')
    ? `/${AUTOMATION_SKILL} 帮我新建自动化任务。请先询问我要执行的内容和时间，再使用调度工具保存并核验结果。我的当前时区是 ${timeZone}。`
    : `/${AUTOMATION_SKILL} Help me create an automation. Ask what to run and when, then save it with the scheduling tools and verify the result. My current time zone is ${timeZone}.`
}

export interface AutomationStarter {
  /** Concurrent clicks share one creation; a failed send retries in the same Session. */
  start(): Promise<void>
}

/** Create and retain a fresh Session until its skill invocation has been admitted. */
export function createAutomationStarter(ctx: Context): AutomationStarter {
  let pending: Promise<void> | undefined
  let retrySession: SessionId | undefined
  return {
    start() {
      if (pending !== undefined) return pending
      const run = async (): Promise<void> => {
        if (retrySession === undefined) {
          // Inherit the most recently used project, without reusing a user's blank draft.
          const summaries = ctx.sessions.list.getSnapshot().byId
          const workspaces = ctx.workspaces.list.getSnapshot().items
          const workspace = workspaces.toSorted((left, right) => {
            const latest = (ids: readonly SessionId[]) => Math.max(0, ...ids.map(id => summaries[id]?.updatedAt ?? 0))
            return latest(right.sessionIds) - latest(left.sessionIds)
          })[0]
          retrySession = await ctx.sessions.create(workspace === undefined ? {} : { workspaceId: workspace.workspaceId })
        }
        const id = retrySession
        await ctx.sessions.using(id, { source: 'controllerOperation' }, async (reference) => {
          const binding = await reference.ready
          // Session scopes do not inherit this plugin's injected services.
          // The retained binding already addresses the intended Session.
          const result = await binding.session.prompt([{ type: 'text', text: automationPrompt(
            ctx.locale.getSnapshot().active,
            Intl.DateTimeFormat().resolvedOptions().timeZone,
          ) }], 'queue')
          if (!result.ok) throw new Error(`Automation prompt failed: ${result.error.code}: ${result.error.message}`)
          ctx.uiWorkspace.openSession(id)
        })
        retrySession = undefined
      }
      pending = run().finally(() => { pending = undefined })
      return pending
    },
  }
}

/**
 * Shadow the public `main:schedules` seat while retaining the upstream page,
 * catalog hooks, locale, and all detail actions. Follow registration lifetimes
 * so startup ordering and plugin reloads cannot leave a stale catalog mounted.
 */
export function applyDesktopAutomation(ctx: Context): void {
  const starter = createAutomationStarter(ctx)
  ctx.effect(() => {
    let source: StoredEntry | undefined
    let remove: (() => void) | undefined
    let updating = false
    const refresh = (): void => {
      if (updating) return
      const original = ctx.slots.entries('main').find(entry => entry.options.key === 'schedules'
        && entry.registrant !== 'desktop-automation')
      if (original === source) return
      updating = true
      try {
        remove?.()
        remove = undefined
        source = original
        if (original === undefined) return
        const Page = original.component as ComponentType<Record<string, unknown>>
        function AutomationPage(props: Record<string, unknown>) {
          const [busy, setBusy] = useState(false)
          const [failed, setFailed] = useState(false)
          const zh = ctx.locale.getSnapshot().active.startsWith('zh')
          const start = (): void => {
            setBusy(true)
            setFailed(false)
            void starter.start().catch(() => { setFailed(true) }).finally(() => { setBusy(false) })
          }
          return <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0 }} aria-busy={busy}>
            {busy && <div role="status" style={{ position: 'absolute', bottom: 16, left: 24, zIndex: 1 }}>
              {zh ? '正在准备自动化任务会话…' : 'Preparing an automation conversation…'}
            </div>}
            {failed && <div role="alert" style={{ position: 'absolute', bottom: 16, left: 24, right: 24, zIndex: 1,
              padding: 12, borderRadius: 8, background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)',
              border: '1px solid var(--dsw-alias-label-tertiary)' }}>
              {zh ? '无法开始创建自动化任务，请重试。' : 'Could not start creating an automation. Please retry.'}
              <button type="button" disabled={busy} onClick={start}>{zh ? '重试' : 'Retry'}</button>
            </div>}
            {createElement(Page, { ...props, onNewTask: start })}
          </div>
        }
        remove = ctx.slots.register({
          name: 'main', key: 'schedules', priority: -100, registrant: 'desktop-automation',
          locale: 'schedule.manager',
          inject: () => original.inject?.() ?? {},
        }, AutomationPage)
      } finally { updating = false }
    }
    const unsubscribe = ctx.on('slots/changed', key => { if (key === 'main') refresh() })
    refresh()
    return () => { unsubscribe(); remove?.() }
  }, 'Desktop automation creation')
}
