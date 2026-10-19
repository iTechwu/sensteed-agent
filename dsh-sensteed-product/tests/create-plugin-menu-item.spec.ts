import { expect, it, vi } from 'vitest'
import { startCreatorConversation } from '../src/client/CreatePluginMenuItem.tsx'

function fixture(promptResult: { ok: true; value: { accepted: true } } | { ok: false; error: { message: string } }) {
  const sessionId = 'session-created' as never
  const session = { prompt: vi.fn().mockResolvedValue(promptResult) }
  const release = vi.fn()
  const ctx = {
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'workspace-a', sessionIds: [] }] }) } },
    sessions: {
      create: vi.fn().mockResolvedValue(sessionId),
      retain: vi.fn().mockReturnValue({ ready: Promise.resolve({ session }), release }),
    },
    uiWorkspace: { openSession: vi.fn() },
  }
  return { ctx, sessionId, session, release }
}

it('creates a new cordis session and sends the explicit skill invocation', async () => {
  const { ctx, sessionId, session, release } = fixture({ ok: true, value: { accepted: true } })
  await startCreatorConversation(ctx as never)
  expect(ctx.sessions.create).toHaveBeenCalledWith({ workspaceId: 'workspace-a', agentPreset: 'cordis' })
  expect(ctx.uiWorkspace.openSession).toHaveBeenCalledWith(sessionId)
  expect(session.prompt).toHaveBeenCalledWith([
    { type: 'text', text: expect.stringMatching(/^\/dsh-sensteed-create-plugin\n/) },
  ], 'queue')
  expect(release).toHaveBeenCalledOnce()
})

it('releases the session reference when prompt admission fails', async () => {
  const { ctx, release } = fixture({ ok: false, error: { message: 'admission refused' } })
  await expect(startCreatorConversation(ctx as never)).rejects.toThrow('admission refused')
  expect(release).toHaveBeenCalledOnce()
})

it('starts skill creation through the existing cordis preset with an explicit skill invocation', async () => {
  const { ctx, session, release } = fixture({ ok: true, value: { accepted: true } })
  await startCreatorConversation(ctx as never, 'skill')
  expect(session.prompt).toHaveBeenCalledWith([{ type: 'text', text: expect.stringMatching(/^\/skill-creator\n/) }], 'queue')
  expect(release).toHaveBeenCalledOnce()
})
