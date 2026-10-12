import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { uploadAttachment, validatePutAuthorization, videoToolName } from '../host-upload.js'

const ref = { attachmentId: 'file-one', name: 'lecture.mp4', bytes: 25 * 1024 * 1024 }
function fixture(options = {}) {
  const calls = [], reads = []
  const controller = new AbortController()
  const ctx = {
    attachments: { async *readFileStream(_ref, signal) {
      reads.push(true)
      for (let offset = 0; offset < ref.bytes; offset += 64 * 1024) {
        signal.throwIfAborted()
        yield Buffer.alloc(Math.min(64 * 1024, ref.bytes - offset), options.change && reads.length > 1 ? 2 : 1)
      }
    } },
    tools: {
      get: () => ({}),
      async execute(call) {
        calls.push(call)
        const value = call.name === videoToolName('video_upload_authorize') ? {
          uploadId: 'upload-one', assetId: 'asset-one', method: 'PUT',
          url: options.url ?? 'https://xica-ai-system.tos-s3-cn-beijing.volces.com/upload/coursemd/staging/uploads/one.mp4?signature=ephemeral',
          headers: { 'Content-Type': 'video/mp4' }, expiresAt: new Date(Date.now() + 60000).toISOString(), maxBytes: 512 * 1024 * 1024,
        } : { assetId: 'asset-one', status: 'ready', accessMode: 'private' }
        return { isError: false, value: { structuredContent: value } }
      },
    },
  }
  const exec = { signal: controller.signal, token: Symbol('parent'), agent: { session: { snapshotEvents: () => [
    { type: 'user/message', data: { source: { kind: options.other ? 'tool' : 'user' }, content: [{ type: 'file', attachment: ref }] } },
  ] } } }
  return { ctx, exec, controller, calls, reads }
}
const args = { action: 'upload', attachmentId: ref.attachmentId, idempotencyKey: 'upload-stable-key-one' }

test('25 MiB upload uses bounded stream, exact length/hash and registered MCP policy', async () => {
  const f = fixture()
  let bytes = 0
  const digest = createHash('sha256')
  const result = await uploadAttachment(f.ctx, args, f.exec, async (_url, init) => {
    assert.equal(init.redirect, 'error')
    assert.equal(init.headers.Authorization, undefined)
    assert.equal(init.headers['Content-Length'], String(ref.bytes))
    assert.equal(init.duplex, 'half')
    for await (const chunk of init.body) { assert.ok(chunk.length <= 128 * 1024); bytes += chunk.length; digest.update(chunk) }
    return { ok: true }
  })
  assert.equal(bytes, ref.bytes)
  assert.equal(result.sha256, digest.digest('hex'))
  assert.equal(result.assetId, 'asset-one')
  assert.equal(f.reads.length, 2)
  assert.equal(f.calls.length, 2)
  assert.equal(f.calls[0].parent, f.exec.token)
  assert.equal(f.calls[1].arguments.idempotencyKey, 'upload-stable-key-one:complete')
  assert.ok(!JSON.stringify(result).includes('signature'))
})

test('only user file attachments in the active conversation can be transferred', async () => {
  const f = fixture({ other: true })
  await assert.rejects(uploadAttachment(f.ctx, args, f.exec), /CURRENT_SESSION_ATTACHMENT_REQUIRED/)
  assert.equal(f.calls.length, 0)
})

test('public buckets, lookalike hosts and redirects cannot receive private originals', async () => {
  for (const url of ['https://xica-ai-public.tos-s3-cn-beijing.volces.com/coursemd/staging/uploads/a.mp4',
    'https://xica-ai-system.tos-s3-cn-beijing.volces.com.evil.test/coursemd/staging/uploads/a.mp4']) {
    const f = fixture({ url })
    await assert.rejects(uploadAttachment(f.ctx, args, f.exec), /INVALID_PRIVATE_UPLOAD_AUTHORIZATION/)
    assert.equal(f.calls.length, 1)
  }
})

test('changed attachment and cancelled network never complete the asset or leak URLs', async () => {
  const f = fixture({ change: true })
  await assert.rejects(uploadAttachment(f.ctx, args, f.exec, async (_url, init) => {
    for await (const _chunk of init.body) {} return { ok: true }
  }), /PRIVATE_UPLOAD_FAILED/)
  assert.equal(f.calls.length, 1)
  const g = fixture()
  await assert.rejects(uploadAttachment(g.ctx, args, g.exec, async () => {
    g.controller.abort(); throw new Error('signature=secret-url')
  }), /UPLOAD_CANCELLED/)
  assert.equal(g.calls.length, 1)
})

test('expired grants and unexpected signing headers are rejected', () => {
  assert.throws(() => validatePutAuthorization({ url: 'https://xica-ai-system.tos-cn-beijing.volces.com/coursemd/staging/uploads/a',
    method: 'PUT', uploadId: 'a', maxBytes: 100, expiresAt: 'invalid', headers: { 'Content-Type': 'video/mp4' } }, 1, 'video/mp4'))
})

test('Host authorization redaction preserves canonical data and policy blocks', async () => {
  const { redactHostAuthorizations } = await import('../host-upload.js')
  const f = fixture()
  let listener, logged
  f.ctx.on = (_name, value) => { listener = value; return () => {} }
  redactHostAuthorizations(f.ctx)
  const execute = f.ctx.tools.execute
  f.ctx.tools.execute = async call => {
    const result = await execute(call)
    if (call.name === videoToolName('video_upload_authorize')) {
      logged = await listener(call, result, async () => ({ kind: 'accept' }))
      assert.ok(result.value.structuredContent.url.includes('signature'))
      const blocked = { kind: 'block', feedback: [{ type: 'text', text: 'denied' }] }
      assert.equal(await listener(call, result, async () => blocked), blocked)
    }
    return result
  }
  await uploadAttachment(f.ctx, args, f.exec, async (_url, init) => {
    for await (const _chunk of init.body) {} return { ok: true }
  })
  assert.ok(!JSON.stringify(logged).includes('signature'))
  assert.equal(logged.kind, 'accept')
})
