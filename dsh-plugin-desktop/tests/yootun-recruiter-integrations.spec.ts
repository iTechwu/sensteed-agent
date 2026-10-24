import { describe, expect, it, vi } from 'vitest'
import { createBossOfficialAdapter } from '../src/yootun-boss-official-adapter.ts'
import { createRecruiterKnowledgePublisher } from '@dofe/dsh-sensteed-product/yootun-recruiter-integrations'

describe('Yootun recruiter integrations', () => {
  it('creates and confirms one ACL-scoped HR memory through registered knowledge tools', async () => {
    const calls: Array<any> = []
    const publisher = createRecruiterKnowledgePublisher({
      schemas: () => [
        { name: 'knowledge_remember', description: '', parameters: {} },
        { name: 'knowledge_confirm_memory', description: '', parameters: {} },
      ],
      execute: vi.fn(async (input: { calls: Array<{ name: string; arguments: string }> }) => {
        calls.push(input)
        const name = input.calls[0]?.name
        const result = name === 'knowledge_remember'
          ? { isError: false, value: { ok: true, result: { structuredContent: { id: 'memory-1' } } }, content: [] }
          : { isError: false, value: { ok: true, result: {} }, content: [] }
        return { results: [{ callId: 'probe', result }] }
      }),
    } as any)
    const result = await publisher!.publish({
      spaceId: '20000000-0000-4000-8000-000000000001',
      content: '{"kind":"hr_recruiting_review"}',
      idempotencyKey: 'knowledge-1',
    })
    expect(result).toEqual({ status: 'succeeded', reasonCode: 'knowledge_confirmed', memoryId: 'memory-1' })
    expect(calls).toHaveLength(2)
    expect(JSON.parse(String(calls[0].calls?.[0]?.arguments))).toMatchObject({ input: {
      scope: 'TEAM', spaceId: '20000000-0000-4000-8000-000000000001',
    } })
    expect(JSON.parse(String(calls[1].calls?.[0]?.arguments))).toMatchObject({ input: {
      memoryId: 'memory-1', shareWithSpace: true,
    } })
  })

  it('lets the Knowledge service resolve the tenant HR space by default', async () => {
    const calls: Array<any> = []
    const publisher = createRecruiterKnowledgePublisher({
      schemas: () => [
        { name: 'knowledge_remember', description: '', parameters: {} },
        { name: 'knowledge_confirm_memory', description: '', parameters: {} },
      ],
      execute: vi.fn(async (input: { calls: Array<{ name: string; arguments: string }> }) => {
        calls.push(input)
        const name = input.calls[0]?.name
        const result = name === 'knowledge_remember'
          ? { isError: false, value: { ok: true, result: { structuredContent: { id: 'memory-2' } } }, content: [] }
          : { isError: false, value: { ok: true, result: {} }, content: [] }
        return { results: [{ callId: 'probe', result }] }
      }),
    } as any)
    await publisher!.publish({ content: '统一 HR 空间', idempotencyKey: 'knowledge-default-1' })
    const remembered = JSON.parse(String(calls[0].calls?.[0]?.arguments)).input
    expect(remembered).toMatchObject({ scope: 'TEAM' })
    expect(remembered).not.toHaveProperty('spaceId')
  })

  it('does not invoke the BOSS official client before authorization', async () => {
    const executeRecruiterAction = vi.fn()
    const syncRecruitingData = vi.fn()
    const adapter = createBossOfficialAdapter({
      authorizationStatus: async () => 'requires_user_login',
      executeRecruiterAction,
      syncRecruitingData,
    })!
    expect(await adapter.sync({ idempotencyKey: 'sync-1' })).toMatchObject({
      status: 'requires_user_login', imported: 0, updated: 0, skipped: 0,
    })
    expect(await adapter.execute({
      actionId: 'action-1', type: 'send_message', idempotencyKey: 'message-1',
      targetLabel: '候选人 A', summary: '邀请面试',
    })).toMatchObject({ status: 'requires_user_login' })
    expect(executeRecruiterAction).not.toHaveBeenCalled()
    expect(syncRecruitingData).not.toHaveBeenCalled()
  })
})
