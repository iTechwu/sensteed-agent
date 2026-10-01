/** Quit inspection: are there active or scheduled tasks that a quit would interrupt? */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-schedule'

/** The inspection answer consumed by the shell's quit gate. */
export interface DesktopQuitInspection {
  /** Any running/stopping job or agent work in flight. */
  readonly activeTasks: boolean
  /** Any active reminder/schedule that has not fired yet. */
  readonly scheduledTasks: boolean
}

/** Inputs summarized by {@link summarizeDesktopQuitInspection}. */
export interface DesktopQuitInspectionInputs {
  readonly runningJobs: number
  readonly stoppingJobs: number
  readonly activeSchedules: number
}

/** Pure predicate over the collected counters (unit-test seam). */
export function summarizeDesktopQuitInspection(inputs: DesktopQuitInspectionInputs): DesktopQuitInspection {
  return {
    activeTasks: inputs.runningJobs > 0 || inputs.stoppingJobs > 0,
    scheduledTasks: inputs.activeSchedules > 0,
  }
}

/**
 * Whether any active schedule fires within the lookahead window.
 * `lookaheadMs = 0` (the default) counts every still-armed schedule, matching
 * the fail-closed quit prompt: an unfired reminder would be lost by a quit.
 */
export function hasUpcomingScheduledWork(
  entries: readonly { scheduledAt: string; status: 'active' | 'inactive' }[],
  now: number,
  lookaheadMs = 0,
): boolean {
  return entries.some(entry => {
    if (entry.status !== 'active') return false
    const at = Date.parse(entry.scheduledAt)
    if (Number.isNaN(at)) return true
    return at >= now - lookaheadMs
  })
}

/** The Host-side inspection service consumed by the shell's quit gate. */
export interface SensteedQuitInspection {
  inspect(): Promise<DesktopQuitInspection>
}

/**
 * Host row: answer the quit-inspection probe from the live jobs roster and
 * the schedule catalog. `schedule` is probed, not injected — combinations
 * without the scheduler simply report `scheduledTasks: false` instead of
 * pending the whole row.
 */
export const name = 'dofe-product-quit-inspection'
export const inject = ['jobs']

export async function apply(ctx: Context): Promise<void> {
  const probeRuntime = (): { platform: NodeJS.Platform } | undefined => {
    try {
      return (ctx as { desktopRuntime?: { platform: NodeJS.Platform } }).desktopRuntime
    } catch {
      return undefined
    }
  }
  if (probeRuntime() === undefined) return

  const service: SensteedQuitInspection = {
    async inspect(): Promise<DesktopQuitInspection> {
      let runningJobs = 0
      let stoppingJobs = 0
      for (const job of ctx.jobs.list()) {
        if (job.status === 'running') runningJobs += 1
        if (job.status === 'stopping') stoppingJobs += 1
      }
      let activeSchedules = 0
      const schedule = (ctx as { schedule?: { catalog(): Promise<Array<{ scheduledAt: string; status: 'active' | 'inactive' }>> } }).schedule
      if (schedule !== undefined) {
        const entries = await schedule.catalog()
        activeSchedules = entries.filter(entry => hasUpcomingScheduledWork([entry], Date.now())).length
      }
      return summarizeDesktopQuitInspection({ runningJobs, stoppingJobs, activeSchedules })
    },
  }
  ctx.provide('sensteedQuitInspection', service)
}
