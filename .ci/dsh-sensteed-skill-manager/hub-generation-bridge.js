/** Renderer intents only. Host owns identity, target, plan capabilities and execution grants. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new Error('Invalid generation intent.')
  return value
}
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Invalid generation identity.'); return value }
function channel(value) { if (!['stable', 'beta'].includes(value)) throw new Error('Invalid generation channel.'); return value }
export function generationIntent(method, raw) {
  if (method === 'check') { const v=object(raw,['channel']); return v.channel===undefined?{}:{channel:channel(v.channel)} }
  if (method === 'preview') {
    const v=object(raw,['channel','requested'])
    if (!Array.isArray(v.requested) || v.requested.length>256) throw new Error('Invalid generation selection.')
    const requested=v.requested.map(raw => {
      const i=object(raw,['kind','itemId','action','enabled'])
      if (!['skill','plugin'].includes(i.kind) || !['retain','install','update','uninstall'].includes(i.action) || typeof i.enabled!=='boolean') throw new Error('Invalid generation selection.')
      return {kind:i.kind,itemId:uuid(i.itemId),action:i.action,enabled:i.enabled}
    })
    if (new Set(requested.map(i=>`${i.kind}:${i.itemId}`)).size!==requested.length) throw new Error('Duplicate generation selection.')
    return {channel:channel(v.channel),requested}
  }
  if (method === 'execute') { const v=object(raw,['intentId','confirmationNonce']);return {intentId:uuid(v.intentId),confirmationNonce:uuid(v.confirmationNonce)} }
  if (method === 'status') { const v=object(raw,['operationId']);return v.operationId===undefined?{}:{operationId:uuid(v.operationId)} }
  throw new Error('Unsupported generation operation.')
}
export async function callGenerationManager(ctx, method, input) {
  const intent=generationIntent(method,input)
  const manager=ctx.hubGenerationManager
  if (!manager || !['check','preview','execute','status'].every(key=>typeof manager[key]==='function')) return {available:false,reason:'BASE_VERSION_NOT_ENABLED'}
  // Only a real Host service can perform this operation. Never fall back to per-skill installation.
  return {available:true,result:await manager[method](intent)}
}
