/** Quit gate: one fail-closed inspection between a quit request and the shutdown coordinator. */

/**
 * The inspection answer from the Host's product layer. `source` distinguishes
 * a definitive "no inspection capability" (the product row is absent — known
 * safe, silent quit) from an unknown answer (timeout/error — fail closed).
 */
export interface DesktopQuitInspectionResult {
  readonly source: 'ready' | 'unavailable' | 'unknown'
  readonly activeTasks?: boolean
  readonly scheduledTasks?: boolean
}

/** The prompt decision the gate resolves for one quit request. */
export type DesktopQuitPromptDecision =
  | 'quit'
  | 'ask-active'
  | 'ask-scheduled'
  | 'ask-both'
  | 'ask-unknown'

/**
 * Resolve one inspection result into a prompt decision.
 *
 * Semantics follow the upstream `resolveDesktopQuitPrompt` (unknown is fail
 * closed), extended with the `unavailable` source: a known-absent product
 * layer reproduces the pre-gate behavior exactly (silent quit, zero
 * regression) instead of interrogating the user on every exit.
 */
export function resolveDesktopQuitPrompt(result: DesktopQuitInspectionResult): DesktopQuitPromptDecision {
  if (result.source === 'unavailable') return 'quit'
  if (result.source === 'unknown') return 'ask-unknown'
  const active = result.activeTasks === true
  const scheduled = result.scheduledTasks === true
  if (active && scheduled) return 'ask-both'
  if (active) return 'ask-active'
  if (scheduled) return 'ask-scheduled'
  return 'quit'
}

/** Locale-resolved copy for the confirmation dialog. */
export interface DesktopQuitGateCopy {
  readonly title: string
  readonly detail: string
  readonly confirm: string
  readonly cancel: string
}

export function desktopQuitGateCopy(
  decision: Exclude<DesktopQuitPromptDecision, 'quit'>,
  locale: string,
): DesktopQuitGateCopy {
  const zh = locale.startsWith('zh')
  const copy: Record<string, { readonly title: string; readonly detail: string }> = {
    'ask-active': {
      title: zh ? '有正在运行的任务' : 'Tasks are still running',
      detail: zh ? '退出会中断正在运行的任务。仍要退出吗？' : 'Quitting now interrupts running tasks. Quit anyway?',
    },
    'ask-scheduled': {
      title: zh ? '有已排定的提醒' : 'Scheduled reminders are pending',
      detail: zh ? '退出会丢弃尚未触发的提醒。仍要退出吗？' : 'Quitting now discards reminders that have not fired yet. Quit anyway?',
    },
    'ask-both': {
      title: zh ? '有运行中的任务与已排定的提醒' : 'Tasks and scheduled reminders are pending',
      detail: zh ? '退出会中断运行中的任务并丢弃未触发的提醒。仍要退出吗？' : 'Quitting now interrupts tasks and discards pending reminders. Quit anyway?',
    },
    'ask-unknown': {
      title: zh ? '无法确认任务状态' : 'Task status could not be confirmed',
      detail: zh ? '暂时无法读取任务状态。仍要退出吗？' : 'Task status is temporarily unavailable. Quit anyway?',
    },
  }
  return {
    title: copy[decision]!.title,
    detail: copy[decision]!.detail,
    confirm: zh ? '仍要退出' : 'Quit anyway',
    cancel: zh ? '取消' : 'Cancel',
  }
}

export interface DesktopQuitGateOptions {
  /** Whether the gate is enabled at all (`DSH_DESKTOP_QUIT_GATE=0` disables it). */
  readonly enabled: boolean
  /** Browser-locale tag used to pick the dialog copy. */
  readonly locale: () => string
  /** Whether the app is far enough along to show a dialog at all. */
  readonly canPrompt: () => boolean
  /** Host inspection probe; missing probe means the Host never registered one. */
  readonly inspect: () => Promise<DesktopQuitInspectionResult>
  /** Native dialog seam (Electron dialog.showMessageBox). */
  readonly confirm: (copy: DesktopQuitGateCopy) => Promise<boolean>
}

export interface DesktopQuitGate {
  /** Run the gate for one quit request; true = proceed to shutdown. */
  run(): Promise<boolean>
}

/**
 * Single-flight gate: concurrent quit requests share one inspection and one
 * dialog, and a cancelled dialog leaves the process running untouched.
 */
export function createDesktopQuitGate(options: DesktopQuitGateOptions): DesktopQuitGate {
  let inflight: Promise<boolean> | undefined
  return {
    run(): Promise<boolean> {
      inflight ??= (async () => {
        if (!options.enabled || !options.canPrompt()) return true
        let result: DesktopQuitInspectionResult
        try {
          result = await options.inspect()
        } catch {
          result = { source: 'unknown' }
        }
        const decision = resolveDesktopQuitPrompt(result)
        if (decision === 'quit') return true
        if (!options.canPrompt()) return true
        return await options.confirm(desktopQuitGateCopy(decision, options.locale()))
      })().finally(() => { inflight = undefined })
      return inflight
    },
  }
}
