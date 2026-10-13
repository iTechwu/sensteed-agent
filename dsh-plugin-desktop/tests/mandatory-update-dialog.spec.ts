import { describe, expect, it } from 'vitest'
import {
  MANDATORY_BLOCKING_PROMPT_COOLDOWN_MS,
  mandatoryBlockingDialogCopy,
  shouldPromptMandatoryBlocking,
} from '../src/mandatory-update-dialog.ts'

const BLOCKING = { phase: 'blocking' as const, minVersion: '2.1.0', observedAt: '2026-10-01T12:00:00Z' }
const NOW = Date.parse('2026-10-01T12:00:00Z')

describe('mandatory blocking reminder dialog', () => {
  it('prompts only for a blocking phase after the cooldown', () => {
    expect(shouldPromptMandatoryBlocking({ policy: BLOCKING, now: NOW, lastPromptAt: 0 })).toBe(true)
    expect(shouldPromptMandatoryBlocking({
      policy: BLOCKING, now: NOW, lastPromptAt: NOW - MANDATORY_BLOCKING_PROMPT_COOLDOWN_MS + 1_000,
    })).toBe(false)
  })

  it('never prompts for notice phases or absent policies', () => {
    expect(shouldPromptMandatoryBlocking({ policy: undefined, now: NOW, lastPromptAt: 0 })).toBe(false)
    expect(shouldPromptMandatoryBlocking({
      policy: { phase: 'notice', minVersion: '2.1.0', observedAt: 'x' }, now: NOW, lastPromptAt: 0,
    })).toBe(false)
  })

  it('renders bilingual copy with the target version', () => {
    const zh = mandatoryBlockingDialogCopy('zh', '2.1.0')
    expect(zh.title).toContain('更新')
    expect(zh.detail).toContain('2.1.0')
    expect(zh.confirm).not.toBe(zh.cancel)
    const en = mandatoryBlockingDialogCopy('en-US', '2.1.0')
    expect(en.title).toBe('Update required')
    expect(en.confirm).toBe('Download update now')
  })
})
