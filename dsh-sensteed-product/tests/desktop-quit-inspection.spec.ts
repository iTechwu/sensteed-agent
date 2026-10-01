import { describe, expect, it } from 'vitest'
import {
  hasUpcomingScheduledWork,
  summarizeDesktopQuitInspection,
} from '../src/desktop-quit-inspection.ts'

describe('desktop quit inspection predicates', () => {
  it('reports active tasks for running and stopping jobs', () => {
    expect(summarizeDesktopQuitInspection({ runningJobs: 1, stoppingJobs: 0, activeSchedules: 0 }).activeTasks).toBe(true)
    expect(summarizeDesktopQuitInspection({ runningJobs: 0, stoppingJobs: 2, activeSchedules: 0 }).activeTasks).toBe(true)
    expect(summarizeDesktopQuitInspection({ runningJobs: 0, stoppingJobs: 0, activeSchedules: 0 }).activeTasks).toBe(false)
  })

  it('reports scheduled tasks from the active schedule count', () => {
    expect(summarizeDesktopQuitInspection({ runningJobs: 0, stoppingJobs: 0, activeSchedules: 1 }).scheduledTasks).toBe(true)
    expect(summarizeDesktopQuitInspection({ runningJobs: 1, stoppingJobs: 0, activeSchedules: 1 })).toEqual({
      activeTasks: true, scheduledTasks: true,
    })
  })

  it('counts every armed schedule with the default zero lookahead', () => {
    const now = Date.parse('2026-10-01T12:00:00Z')
    const entries = [
      { scheduledAt: '2026-10-01T13:00:00Z', status: 'active' as const },
      { scheduledAt: '2026-10-01T09:00:00Z', status: 'active' as const },
      { scheduledAt: '2026-10-01T13:00:00Z', status: 'inactive' as const },
      { scheduledAt: 'not-a-date', status: 'active' as const },
    ]
    expect(hasUpcomingScheduledWork(entries, now)).toBe(true)
    expect(hasUpcomingScheduledWork(entries.filter(e => e.status === 'inactive'), now)).toBe(false)
  })
})
