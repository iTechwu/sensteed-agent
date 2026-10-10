import { describe, expect, it } from 'vitest'
import { managedCapabilitiesPrompt } from '../src/managed-capabilities.ts'

describe('authorized capability introduction', () => {
  const input = {
    ready: true, enabled: new Set(['media', 'openmontage'] as const), financeAllowed: false,
    toolNames: ['mcp__media__create_generation_task', 'mcp__openmontage__create_project', 'mcp__finance__query'],
  }
  it('introduces available video capabilities without advertising unauthorized finance', () => {
    const text = managedCapabilitiesPrompt(input)
    expect(text).toContain('图片与短视频')
    expect(text).toContain('视频制作')
    expect(text).not.toContain('财务')
    expect(text).not.toContain('企业知识与记忆')
  })
  it('requires both permission and a visible finance tool', () => {
    expect(managedCapabilitiesPrompt({ ...input, financeAllowed: true })).toContain('财务管理')
    expect(managedCapabilitiesPrompt({ ...input, financeAllowed: true, toolNames: [] })).not.toContain('财务')
  })
  it('drops claims when disabled, disconnected, scope-restricted, or signed out', () => {
    for (const override of [{ enabled: new Set<never>() }, { toolNames: [] }, { ready: false }]) {
      const text = managedCapabilitiesPrompt({ ...input, ...override })
      expect(text).not.toContain('视频制作')
      expect(text).not.toContain('图片与短视频')
    }
  })
  it('includes knowledge routing only with entitlement and visible tools', () => {
    const allowed = { ...input, enabled: new Set(['knowledge'] as const), toolNames: ['mcp__knowledge__search'] }
    expect(managedCapabilitiesPrompt(allowed)).toContain('数据源路由规则')
    expect(managedCapabilitiesPrompt({ ...allowed, toolNames: [] })).not.toContain('数据源路由规则')
  })
})
