import { describe, expect, it } from 'vitest'
import { classifyKnowledgeRoute, KNOWLEDGE_ROUTING_PROMPT } from '../src/knowledge-routing.ts'

describe('Knowledge routing contract', () => {
  it('routes enterprise facts to Knowledge', () => {
    expect(classifyKnowledgeRoute('优惠豚公司的会员服务标准是什么？')).toBe('knowledge')
    expect(classifyKnowledgeRoute('What is our internal hiring procedure?')).toBe('knowledge')
  })

  it('routes public current facts to Web', () => {
    expect(classifyKnowledgeRoute('特斯拉今天的最新价格是多少？')).toBe('web')
    expect(classifyKnowledgeRoute('What is the weather today?')).toBe('web')
  })

  it('requires both sources for mixed questions', () => {
    expect(classifyKnowledgeRoute('优惠豚库存和今天特斯拉 Model Y 价格')).toBe('mixed')
  })

  it('states the managed Knowledge tool surface and fallback policy', () => {
    expect(KNOWLEDGE_ROUTING_PROMPT).toContain('已加载的 mcp__knowledge__ 检索工具')
    expect(KNOWLEDGE_ROUTING_PROMPT).toContain('个人知识空间使用 user.personal')
    expect(KNOWLEDGE_ROUTING_PROMPT).toContain('Knowledge 不可用时明确说明企业知识不可用')
  })
})
