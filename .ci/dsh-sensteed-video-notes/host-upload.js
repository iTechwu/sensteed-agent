import { createHash, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'

export const MAX_VIDEO_BYTES = 512 * 1024 * 1024
const TYPES = { mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm', srt: 'application/x-subrip', vtt: 'text/vtt' }
const authorizationCalls = new Set()

// Match the Harness MCP bridge's publicToolName, including lossy normalization.
export function videoToolName(rawName) {
  const joined = `mcp__video-processing__${rawName}`
  if (joined.length <= 64) return joined
  const hash = createHash('sha256').update(`video-processing\0${rawName}`).digest('hex').slice(0, 12)
  return `${joined.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 51)}_${hash}`
}

async function call(ctx, exec, name, args) {
  const publicName = videoToolName(name)
  const callId = randomUUID()
  if (name === 'video_upload_authorize') authorizationCalls.add(callId)
  let response
  try {
    response = await ctx.tools.execute({ name: publicName, arguments: args,
      callId, rootCallId: exec.rootCallId ?? exec.callId, parent: exec.token,
      agent: exec.agent, signal: exec.signal })
  } finally { authorizationCalls.delete(callId) }
  if (response.isError) throw new Error('VIDEO_MCP_REQUEST_FAILED')
  const result = response.value?.structuredContent
  if (!result || result.error) throw new Error(result?.error?.code ?? 'VIDEO_MCP_INVALID_RESPONSE')
  return result
}

export function validatePutAuthorization(value, size, contentType) {
  const url = new URL(value.url)
  const virtual = url.hostname === 'xica-ai-system.tos-cn-beijing.volces.com'
    || url.hostname === 'xica-ai-system.tos-s3-cn-beijing.volces.com'
  const pathStyle = /^(tos|tos-s3)-cn-beijing\.volces\.com$/.test(url.hostname)
    && url.pathname.startsWith('/xica-ai-system/')
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
    || (!virtual && !pathStyle) || !/\/coursemd\/staging\/uploads\//.test(url.pathname)
    || value.method !== 'PUT' || typeof value.uploadId !== 'string'
    || !Number.isFinite(value.maxBytes) || size > value.maxBytes
    || Date.parse(value.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(value.expiresAt))
    || value.headers?.['Content-Type'] !== contentType
    || Object.keys(value.headers).some(name => name !== 'Content-Type')) {
    throw new Error('INVALID_PRIVATE_UPLOAD_AUTHORIZATION')
  }
  return url.href
}

export async function uploadAttachment(ctx, args, exec, transport = fetch) {
  if (!exec.agent || !ctx.attachments) throw new Error('ATTACHMENT_HOST_UNAVAILABLE')
  const files = new Map()
  for (const event of exec.agent.session.snapshotEvents()) {
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') continue
    for (const block of event.data.content) if (block.type === 'file') files.set(block.attachment.attachmentId, block.attachment)
  }
  if (args.action === 'list') return { files: [...files.values()].map(ref => ({ attachmentId: ref.attachmentId, name: ref.name, bytes: ref.bytes })) }
  const ref = files.get(args.attachmentId)
  if (args.action !== 'upload' || !ref) throw new Error('CURRENT_SESSION_ATTACHMENT_REQUIRED')
  const contentType = TYPES[ref.name?.split('.').at(-1)?.toLowerCase()]
  const purpose = ['srt', 'vtt'].includes(ref.name?.split('.').at(-1)?.toLowerCase()) ? 'subtitle' : 'sourceVideo'
  const maxBytes = purpose === 'subtitle' ? 5 * 1024 * 1024 : MAX_VIDEO_BYTES
  if (!contentType || !Number.isSafeInteger(ref.bytes) || ref.bytes <= 0 || ref.bytes > maxBytes) throw new Error('INVALID_VIDEO_ATTACHMENT')
  if (typeof args.idempotencyKey !== 'string' || args.idempotencyKey.length < 16 || args.idempotencyKey.length > 128) throw new Error('IDEMPOTENCY_KEY_REQUIRED')
  // Two bounded reads: declare the exact hash, then stream to the signed PUT.
  // The attachment provider verifies its durable content identity on each read.
  const first = createHash('sha256')
  let size = 0
  for await (const chunk of ctx.attachments.readFileStream(ref, exec.signal)) {
    exec.signal.throwIfAborted()
    size += chunk.length
    if (size > ref.bytes) throw new Error('ATTACHMENT_CHANGED')
    first.update(chunk)
  }
  if (size !== ref.bytes) throw new Error('ATTACHMENT_CHANGED')
  const sha256 = first.digest('hex')
  const authorization = await call(ctx, exec, 'video_upload_authorize', {
    filename: ref.name, contentType, sizeBytes: size, sha256, purpose, idempotencyKey: args.idempotencyKey,
  })
  const putUrl = validatePutAuthorization(authorization, size, contentType)
  const body = Readable.from((async function* () {
    const hash = createHash('sha256')
    let sent = 0
    for await (const chunk of ctx.attachments.readFileStream(ref, exec.signal)) {
      exec.signal.throwIfAborted()
      sent += chunk.length
      if (sent > size) throw new Error('ATTACHMENT_CHANGED')
      hash.update(chunk)
      yield chunk
    }
    if (sent !== size || hash.digest('hex') !== sha256) throw new Error('ATTACHMENT_CHANGED')
  })(), { objectMode: false })
  try {
    const response = await transport(putUrl, { method: 'PUT', redirect: 'error', signal: exec.signal,
      headers: { 'Content-Type': contentType, 'Content-Length': String(size) }, body, duplex: 'half' })
    await response.body?.cancel()
    if (!response.ok) throw new Error('PRIVATE_UPLOAD_FAILED')
  } catch {
    if (exec.signal.aborted) throw new Error('UPLOAD_CANCELLED')
    throw new Error('PRIVATE_UPLOAD_FAILED') // Never expose signed URLs in network exceptions.
  } finally { body.destroy() }
  exec.signal.throwIfAborted()
  const completed = await call(ctx, exec, 'video_upload_complete', {
    uploadId: authorization.uploadId, idempotencyKey: `${args.idempotencyKey.slice(0, 118)}:complete`,
  })
  return { ...completed, attachmentId: ref.attachmentId, bytes: size, sha256 }
}

export function registerHostUpload(ctx) {
  if (!ctx.attachments) return () => {}
  return ctx.tools.register({
    name: 'sensteed_video_file_upload',
    description: 'List current-conversation file attachments, or stream a selected video/subtitle to private TOS for video notes. Upload requires user authorization and a stable idempotencyKey; returns assetId, never local paths or signed URLs.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      action: { type: 'string', enum: ['list', 'upload'] }, attachmentId: { type: 'string' }, idempotencyKey: { type: 'string', minLength: 16, maxLength: 128 },
    }, required: ['action'] },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    timeoutMs: 1800000, isConcurrencySafe: () => false,
    execute: (args, exec) => uploadAttachment(ctx, args, exec),
  })
}

export function redactHostAuthorizations(ctx) {
  if (!ctx.on) return () => {}
  return ctx.on('tools/post-execute', async (exec, _result, next) => {
    const decision = await next()
    if (authorizationCalls.has(exec.callId) && decision.kind === 'accept' && !Object.hasOwn(decision, 'value')) {
      // Preserve the execution-local canonical value for Host, while durable
      // session events and model messages receive no presigned credentials.
      return { kind: 'accept', ...(decision.additionalContexts ? { additionalContexts: decision.additionalContexts } : {}),
        content: [{ type: 'text', text: 'Private upload authorization received by Host.' }] }
    }
    return decision
  })
}
