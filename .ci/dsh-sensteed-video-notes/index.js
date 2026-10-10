import { readFileSync } from 'node:fs'

const SKILL_URL = new URL('./skills/video-notes/SKILL.md', import.meta.url)
const REQUIRED_TOOLS = [
  'video_capabilities_get',
  'video_source_resolve_start',
  'video_source_get',
  'video_upload_authorize',
  'video_upload_complete',
  'video_media_prepare_start',
  'video_subtitles_read_start',
  'video_transcription_start',
  'video_transcript_get',
  'video_frames_extract_start',
  'video_frames_list',
  'video_job_get',
  'video_job_cancel',
  'video_asset_download_authorize',
]

export const inject = ['tools', 'systemPrompt']

export function apply(ctx) {
  const disposers = []
  if (ctx.systemPrompt?.section) {
    disposers.push(ctx.systemPrompt.section({
      name: 'sensteed:video-notes-skill',
      order: 9,
      text: readFileSync(SKILL_URL, 'utf8'),
    }))
  }
  if (ctx.tools?.register) {
    disposers.push(ctx.tools.register({
      name: 'sensteed_video_notes_bootstrap',
      description: 'Inspect the local video-processing MCP tool catalog and skill script availability before producing video notes. This tool is read-only.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      isConcurrencySafe: () => true,
      async execute() {
        const schemas = ctx.tools.schemas?.() || []
        const names = schemas.map(item => String(item.name || ''))
        const tools = Object.fromEntries(REQUIRED_TOOLS.map(name => [name, names.some(candidate => candidate.includes(name))]))
        const missing = Object.entries(tools).filter(([, available]) => !available).map(([name]) => name)
        const scripts = {}
        for (const script of ['align-timeline.mjs', 'render-note.mjs', 'validate-note.mjs']) {
          try {
            readFileSync(new URL(`./skills/video-notes/scripts/${script}`, import.meta.url), 'utf8')
            scripts[script] = true
          } catch {
            scripts[script] = false
          }
        }
        return {
          ok: missing.length === 0,
          result: {
            dataSource: 'local_tool_catalog',
            externalCallMade: false,
            tools,
            missing,
            scripts,
            usage: 'Call video_capabilities_get first. Resolve the source, reuse subtitles before any ASR (ASR may be unavailable), extract frames per content type, then align/render locally with the bundled scripts. Poll the original jobId; never resubmit with a new idempotency key.',
          },
        }
      },
    }))
  }
  return () => disposers.reverse().forEach(dispose => dispose?.())
}
