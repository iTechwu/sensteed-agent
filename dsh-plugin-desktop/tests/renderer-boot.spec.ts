import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { handleRendererBootRequest } from '../src/renderer-boot.ts'

function request(body: string, origin = 'http://127.0.0.1:43120'): IncomingMessage {
  return {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
    },
    async * [Symbol.asyncIterator]() { yield Buffer.from(body) },
  } as unknown as IncomingMessage
}

function response(): ServerResponse & { end: ReturnType<typeof vi.fn> } {
  return {
    statusCode: 200,
    end: vi.fn(),
  } as unknown as ServerResponse & { end: ReturnType<typeof vi.fn> }
}

describe('desktop renderer boot route', () => {
  it('accepts a same-origin failed Loader report', async () => {
    const report = {
      status: 'failed' as const,
      plugins: ['dsh-vision-router'],
      error: 'keyed slot "tool.call.toolview" already has an entry for key "vision_crop" at priority 0',
    }
    const notify = vi.fn()
    const res = response()

    await handleRendererBootRequest(
      request(JSON.stringify(report)),
      res,
      'http://127.0.0.1:43120',
      notify,
    )

    expect(notify).toHaveBeenCalledWith(report)
    expect(res.statusCode).toBe(204)
    expect(res.end).toHaveBeenCalledOnce()
  })

  it('rejects cross-origin attempts to mark the renderer healthy', async () => {
    const notify = vi.fn()
    const res = response()

    await handleRendererBootRequest(
      request(JSON.stringify({ status: 'healthy' }), 'https://example.com'),
      res,
      'http://127.0.0.1:43120',
      notify,
    )

    expect(notify).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
  })
})


it('preserves a fresh launcher challenge and rejects malformed challenge data', async () => {
  const notify = vi.fn()
  const challenge = '11111111-1111-4111-8111-111111111111'
  const accepted = response()
  await handleRendererBootRequest(request(JSON.stringify({ status: 'healthy', challenge })), accepted, 'http://127.0.0.1:43120', notify)
  expect(notify).toHaveBeenCalledWith({ status: 'healthy', challenge })
  const rejected = response()
  await handleRendererBootRequest(request(JSON.stringify({ status: 'healthy', challenge: { generationId: 'forged' } })), rejected, 'http://127.0.0.1:43120', notify)
  expect(rejected.statusCode).toBe(400)
  expect(notify).toHaveBeenCalledOnce()
})
