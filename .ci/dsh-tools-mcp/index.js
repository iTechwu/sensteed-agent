export const name = 'tools-guidance'
export const inject = ['systemPrompt']

export function apply(ctx) {
  return ctx.systemPrompt.section({
    name: 'tools:guidance',
    order: 7,
    text: '企业调研使用 mcp__tools-platform__* 做能力发现，使用 mcp__tools-hotspot-discovery__* 做热点运行与事件读取，必要时使用 mcp__tools-browser-intelligence__* 补充网页证据。需要公网文件 URL 时先调 mcp__tools-tos-upload__tos_upload_authorize 取预签名 PUT URL，再用 Bash 按原始字节直传。先 preview/读取再运行；任何 Tools 写操作必须带 confirm=true 和稳定 idempotencyKey，不确定响应必须读取回执对账。',
  })
}
