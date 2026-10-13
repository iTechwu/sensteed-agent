import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { managedPluginAllowed, registerManagedTool } from './managed-tool.ts'

export const name = 'personal-knowledge-files'
export const inject = ['tools', 'attachments', 'credentials', 'systemPrompt', 'dofeAccess']
export const KNOWLEDGE_UPLOAD_URL = 'https://knowledge.hozonauto.com/api/plugin/v1/files/upload'
const MAX_FILE_BYTES = 20 * 1024 * 1024
const mimeTypes: Record<string, string> = {
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
  json: 'application/json', html: 'text/html', rtf: 'application/rtf',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation', epub: 'application/epub+zip',
}

export function apply(ctx: Context): () => void {
  ctx.systemPrompt.section({
    name: 'sensteed:personal-files', order: 7,
    text: context => managedPluginAllowed(ctx, 'knowledge') && ctx.tools.get('personal_knowledge_files', context.scope)
      ? 'For a pasted image or attached document, use personal_knowledge_files list to discover its attachmentId. Use upload when the user asks to understand, search, or add it to personal Knowledge. Report whether the file became searchable or only its original was stored. Only current-session user attachments may be uploaded.' : '',
  })
  return registerManagedTool(ctx, 'knowledge', defineTool({
    name: 'personal_knowledge_files',
    description: 'List current-session user images and files, or upload one to the private personal Knowledge library for understanding and search.',
    parameters: {
      action: { type: 'string', enum: ['list', 'upload'], required: true },
      attachmentId: { type: 'string', description: 'Attachment ID returned by list; required for upload.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    timeoutMs: 90_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (!exec.agent) throw new Error('Personal files require an active Agent session')
      const found = new Map<string, { type: 'image'; attachment: ImageAttachmentRef } | { type: 'file'; attachment: FileAttachmentRef }>()
      for (const event of exec.agent.session.snapshotEvents()) {
        if (event.type !== 'user/message' || event.data.source.kind !== 'user') continue
        for (const block of event.data.content) {
          if (block.type === 'image') found.set(block.attachment.attachmentId, { type: 'image', attachment: block.attachment })
          if (block.type === 'file') found.set(block.attachment.attachmentId, { type: 'file', attachment: block.attachment })
        }
      }
      if (args.action === 'list') {
        return { files: [...found.values()].map(({ type, attachment }) => ({
          attachmentId: attachment.attachmentId, name: attachment.name ?? 'image',
          bytes: attachment.bytes, type,
        })) }
      }
      if (args.action !== 'upload' || typeof args.attachmentId !== 'string') throw new Error('Select an attachment from list')
      const chosen = found.get(args.attachmentId)
      if (!chosen) throw new Error('Attachment does not belong to this conversation')
      const { attachment } = chosen
      if (attachment.bytes > MAX_FILE_BYTES) throw new Error('Personal Knowledge upload limit is 20 MiB')
      const chunks: Buffer[] = []
      if (chosen.type === 'image') {
        const image = await ctx.attachments.readImage(chosen.attachment, exec.signal)
        chunks.push(Buffer.from(image.data))
      } else {
        let size = 0
        for await (const chunk of ctx.attachments.readFileStream(chosen.attachment, exec.signal)) {
          size += chunk.length
          if (size > MAX_FILE_BYTES) throw new Error('Personal Knowledge upload limit is 20 MiB')
          chunks.push(Buffer.from(chunk))
        }
      }
      const key = await ctx.credentials.resolve(credentialRef('MODELS_API_KEY'))
      if (!key?.value) throw new Error('Models credential is required for Knowledge upload')
      const name = attachment.name ?? 'image.png'
      const extension = name.split('.').at(-1)?.toLowerCase() ?? ''
      const response = await fetch(KNOWLEDGE_UPLOAD_URL, {
        method: 'POST', signal: exec.signal,
        headers: { Authorization: `Bearer ${key.value}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: name, mimeType: chosen.type === 'image'
          ? chosen.attachment.mediaType : mimeTypes[extension] ?? 'application/octet-stream',
        dataBase64: Buffer.concat(chunks).toString('base64') }),
      })
      if (!response.ok) throw new Error(`Knowledge upload failed (HTTP ${response.status})`)
      const result = await response.json() as { data?: { documentId: string; status: string; chunkCount: number; reason?: string } }
      if (!result.data?.documentId) throw new Error('Knowledge upload returned no document')
      return { documentId: result.data.documentId, status: result.data.status,
        chunkCount: result.data.chunkCount, reason: result.data.reason ?? null }
    },
  }))
}
