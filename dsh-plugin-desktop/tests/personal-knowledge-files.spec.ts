import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, KNOWLEDGE_UPLOAD_URL } from '../src/personal-knowledge-files.ts'

type Tool = { execute(args: unknown, exec: unknown): Promise<unknown> }
function harness() {
  let tool: Tool
  const ctx = {
    tools: { register: (value: Tool) => { tool = value } },
    systemPrompt: { section: vi.fn() },
    credentials: { resolve: vi.fn(async () => ({ value: 'test-key' })) },
    attachments: { readImage: vi.fn(), readFileStream: vi.fn(async function* () { yield Buffer.from('hello') }) },
  }
  apply(ctx as never)
  const event = { type: 'user/message', data: { source: { kind: 'user' }, content: [
    { type: 'file', attachment: { attachmentId: 'file-1', name: 'note.txt', bytes: 5 } },
  ] } }
  const exec = { signal: new AbortController().signal, agent: { session: { snapshotEvents: () => [event] } } }
  return { ctx, execute: (args: unknown) => tool.execute(args, exec), event }
}
afterEach(() => vi.unstubAllGlobals())

describe('personal Knowledge files', () => {
  it('lists only current-session user attachments and refuses arbitrary ids', async () => {
    const h = harness()
    expect(await h.execute({ action: 'list' })).toEqual({ files: [{ attachmentId: 'file-1', name: 'note.txt', bytes: 5, type: 'file' }] })
    await expect(h.execute({ action: 'upload', attachmentId: 'other-session-file' })).rejects.toThrow('does not belong')
    expect(h.ctx.attachments.readFileStream).not.toHaveBeenCalled()
  })

  it('uploads through Knowledge with host credentials and returns no file bytes or key', async () => {
    const h = harness()
    const fetcher = vi.fn(async (_url: string, _options: RequestInit) => new Response(JSON.stringify({ data: { documentId: 'doc-1', status: 'searchable', chunkCount: 1 } })))
    vi.stubGlobal('fetch', fetcher)
    const result = await h.execute({ action: 'upload', attachmentId: 'file-1' })
    expect(fetcher).toHaveBeenCalledWith(KNOWLEDGE_UPLOAD_URL, expect.objectContaining({
      headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
    }))
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toMatchObject({ title: 'note.txt', mimeType: 'text/plain', dataBase64: 'aGVsbG8=' })
    expect(result).toMatchObject({ documentId: 'doc-1', status: 'searchable', chunkCount: 1 })
    expect(JSON.stringify(result)).not.toContain('test-key')
  })

  it('rejects files larger than the bounded upload limit before reading bytes', async () => {
    const h = harness()
    h.event.data.content[0]!.attachment.bytes = 21 * 1024 * 1024
    await expect(h.execute({ action: 'upload', attachmentId: 'file-1' })).rejects.toThrow('20 MiB')
    expect(h.ctx.attachments.readFileStream).not.toHaveBeenCalled()
  })
})
