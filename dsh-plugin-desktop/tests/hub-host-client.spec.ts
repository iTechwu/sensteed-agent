import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { hubCanonicalJson, hubSyncDigest, hubSyncSnapshotData, type HubSyncExpected } from '../src/hub-sync-verifier.ts'
import { registerHubHostService } from '../src/hub-host-service.ts'
import { describe, expect, it, vi } from 'vitest'
import { HubHostClient, type HubHostContext, type HubSsoSession } from '../src/hub-host-client.ts'
const tenant = '11111111-1111-4111-8111-111111111111', workspace = '22222222-2222-4222-8222-222222222222'
function fixture() {
  let session: HubSsoSession | undefined = { accessToken: 'test-only-token', operator: 'test-actor', tenantId: tenant }
  let watcher: (() => void) | undefined
  const auth = { getDatasourceSession: () => session, watchBinding: (listener: () => void) => { watcher = listener; return () => { watcher = undefined } } }
  const result = () => new Response(JSON.stringify({ code: 200, data: { tenantId: tenant, workspace: { ssoTeam: { id: workspace } }, permissions: ['catalog:read'] } }), { headers: { 'content-type': 'application/json' } })
  const fetcher = vi.fn<typeof fetch>(async () => result())
  const client = new HubHostClient(auth, fetcher)
  return { client, fetcher, result, logout: () => { session = undefined; watcher?.() }, change: () => { session = { ...session!, operator: 'other' }; watcher?.() } }
}
describe('Desktop L0 fixed Hub client', () => {
  it('uses SSO only at fixed Hub origin and returns no bearer', async () => {
    const { client, fetcher } = fixture(); const context = await client.context(workspace)
    expect(context).toMatchObject({ actorRef: 'test-actor', tenantId: tenant, workspaceId: workspace })
    expect(JSON.stringify(context)).not.toContain('test-only-token')
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://ai.hozonauto.com/plugins/api/skillhub/v1/me')
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', credentials: 'omit', headers: { authorization: 'Bearer test-only-token', 'x-current-tenant': workspace } })
    client.dispose()
  })
  it('invalidates in-flight replies when identity changes', async () => {
    const f = fixture(); f.fetcher.mockImplementation(async () => { f.change(); return f.result() })
    await expect(f.client.context()).rejects.toMatchObject({ code: 'HUB_CONTEXT_CHANGED' }); f.client.dispose()
  })
  it('rejects stale context and logout without issuing more fetches', async () => {
    const f = fixture(); const context = await f.client.context(); f.change()
    expect(() => f.client.assertCurrent(context)).toThrow('HUB_CONTEXT_CHANGED')
    f.logout(); await expect(f.client.context()).rejects.toMatchObject({ code: 'HUB_SSO_REQUIRED' })
    expect(f.fetcher).toHaveBeenCalledTimes(1); f.client.dispose()
  })
  it('checks server-confirmed membership and bounds responses', async () => {
    const f = fixture()
    await expect(f.client.context(tenant)).rejects.toMatchObject({ code: 'HUB_INVALID_RESPONSE' })
    f.fetcher.mockResolvedValue(new Response('{}', { headers: { 'content-length': '99999999' } }))
    await expect(f.client.context()).rejects.toMatchObject({ code: 'HUB_INVALID_RESPONSE' }); f.client.dispose()
  })
  it('returns fixed errors instead of leaking network details', async () => {
    const f = fixture(); f.fetcher.mockRejectedValue(new Error('secret-url-and-token'))
    await expect(f.client.context()).rejects.toMatchObject({ message: 'HUB_UNAVAILABLE' }); f.client.dispose()
  })
  it('classifies a body connection reset as transport loss while malformed JSON stays invalid',async()=>{
    const f=fixture()
    f.fetcher.mockResolvedValueOnce(new Response(new ReadableStream({start(controller){controller.error(new TypeError('socket reset'))}})))
    await expect(f.client.context()).rejects.toMatchObject({code:'HUB_UNAVAILABLE'})
    f.fetcher.mockResolvedValueOnce(new Response('{broken'))
    await expect(f.client.context()).rejects.toMatchObject({code:'HUB_INVALID_RESPONSE'})
    f.client.dispose()
  })
  it('checks an authenticated signed snapshot without consuming or activating anything', async () => {
    const f = fixture(), context = await f.client.context(), now = Date.now(), pair = generateKeyPairSync('ed25519')
    const expected: HubSyncExpected = { origin: 'https://ai.hozonauto.com/plugins/api', tenantId: tenant, actorRef: 'test-actor', deviceId: randomUUID(), profileId: randomUUID(), channel: 'stable', observedStateDigest: 'a'.repeat(64), minimumPolicyRevision: 0,
      target: { sensteedVersion: '0.2.1', harnessVersion: '0.2.1', os: 'darwin', arch: 'arm64', nodeVersion: '22.0.0', cordisVersion: '4.0.5-alpha.2', libc: null, nodeAbi: '127', hostCapabilities: [], hostBuildDigest: 'b'.repeat(64) } }
    const { minimumPolicyRevision: _floor, ...binding } = expected
    const snapshot = { ...binding, schemaVersion: 'hub-sync-v1', snapshotId: randomUUID(), policyRevision: 0, catalogDigest: 'b'.repeat(64), entries: [], issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 300_000).toISOString() }
    const value = { snapshot, signature: { algorithm: 'Ed25519', canonicalization: 'RFC8785', keyId: 'test', payloadDigest: hubSyncDigest(snapshot), signature: sign(null, Buffer.from(hubCanonicalJson(snapshot)), pair.privateKey).toString('base64') } }
    f.fetcher.mockResolvedValue(new Response(JSON.stringify({ code: 200, data: value })))
    const result = await f.client.check(context, { mode: 'check', installed: [] }, expected, { schemaVersion: 1, keys: { test: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }, revokedKeyIds: [] })
    expect(hubSyncSnapshotData(result).snapshotId).toBe(snapshot.snapshotId)
    expect(f.fetcher.mock.calls[1]?.[0]).toBe('https://ai.hozonauto.com/plugins/api/skillhub/v1/sync/resolve')
    expect(f.fetcher.mock.calls).toHaveLength(2); f.client.dispose()
  })
  it('registers in the actual Host injection lifecycle and tears the client down', () => {
    let registered: unknown, stop: (() => void) | undefined, watched = false
    const auth = { getDatasourceSession: () => undefined, watchBinding: () => { watched = true; return () => { watched = false } } }
    const scope = { get: () => auth, provide: (_name: string, value: unknown) => { registered = value }, effect: (callback: () => () => void) => { stop = callback() } }
    registerHubHostService({ inject: (_names: string[], callback: (context: typeof scope) => void) => callback(scope) } as never)
    expect(registered).toBeInstanceOf(HubHostClient); expect(watched).toBe(true)
    stop?.(); expect(watched).toBe(false)
  })
  it('requires a fresh context after disposal and selection changes', async () => {
    const f = fixture(); const before = await f.client.context(); const after = await f.client.selectWorkspace(workspace)
    expect(after.revision).toBeGreaterThan(before.revision)
    expect(() => f.client.assertCurrent(before)).toThrow('HUB_CONTEXT_CHANGED')
    f.client.dispose(); await expect(f.client.context()).rejects.toMatchObject({ code: 'HUB_SSO_REQUIRED' })
  })
})

it('downloads only aggregate UUID content and checks exact streamed signed bytes', async () => {
 const f=fixture(),context=await f.client.context(),bytes=Buffer.from('verified payload'),id=randomUUID()
 const expected={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),contentType:'application/gzip'}
 f.fetcher.mockResolvedValue(new Response(bytes,{headers:{'content-type':'application/gzip','content-length':String(bytes.length)}}))
 expect(await f.client.generationBytes(context,id,expected)).toEqual(bytes)
 expect(f.fetcher.mock.calls.at(-1)?.[0]).toBe(`https://ai.hozonauto.com/plugins/api/skillhub/v1/generations/downloads/${id}/content`)
 await expect(f.client.generationBytes(context,'../../foreign',expected)).rejects.toMatchObject({code:'HUB_INVALID_REQUEST'})
 f.fetcher.mockResolvedValue(new Response(Buffer.from('tampered payload'),{headers:{'content-type':'application/gzip'}}))
 await expect(f.client.generationBytes(context,id,expected)).rejects.toMatchObject({code:'HUB_INVALID_RESPONSE'})
 f.client.dispose()
})

it('notifies the running managed Host only for binding changes, not its first context sample',async()=>{const f=fixture(),listener=vi.fn();const stop=f.client.watchInvalidation(listener);await f.client.context();expect(listener).not.toHaveBeenCalled();f.logout();expect(listener).toHaveBeenCalledOnce();stop();f.change();expect(listener).toHaveBeenCalledOnce();f.client.dispose()})

describe('Profile template endpoints (docs/1022 A1)', () => {
  const templateId = '33333333-3333-4333-8333-333333333333', deviceId = '44444444-4444-4444-8444-444444444444'
  const me = { tenantId: tenant, workspace: { ssoTeam: { id: workspace } }, permissions: ['catalog:read'] }
  function clientFor(reply: (path: string) => { code: number; data: unknown }) {
    let session: HubSsoSession | undefined = { accessToken: 'test-only-token', operator: 'test-actor', tenantId: tenant }
    const auth = { getDatasourceSession: () => session, watchBinding: () => () => {} }
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = String(input)
      const { code, data } = reply(path)
      return new Response(JSON.stringify({ code, data }), { headers: { 'content-type': 'application/json' } })
    })
    return { client: new HubHostClient(auth, fetcher), fetcher, logout: () => { session = undefined } }
  }
  const publicList = { list: [{ id: templateId, key: 'content-creation', revision: 3, displayName: '内容创作', description: '一句话介绍', useCases: ['写作', '翻译'], iconKey: 'pen', counts: { skills: 2, plugins: 1, mcpEndpoints: 1 }, updatedAt: '2026-10-21T00:00:00.000Z' }], total: 1, page: 1, limit: 50 }
  const mcpItem = { kind: 'mcp.endpoint', service: 'knowledge', domain: 'knowledge', version: '1.0.0', enabled: true }
  const preview = { templateId, revision: 3, items: [{ item: mcpItem, disposition: 'installable' }] }
  const profileId = '55555555-5555-4555-8555-555555555555'
  const instantiate = { profileId, templateId, revision: 3, profileName: '内容创作', items: [{ kind: 'skill', itemId: '66666666-6666-4666-8666-666666666666', releaseId: '88888888-8888-4888-8888-888888888888', version: '1.0.0', enabled: true }], mcpEndpoints: [{ service: 'knowledge', domain: 'knowledge', version: '1.0.0', enabled: true }], skippedItems: [{ item: { kind: 'plugin', identity: '@x/y', version: '1.0.0', enabled: true }, reason: '未发布到 stable 渠道' }] }

  it('lists public templates at fixed origin without leaking the bearer', async () => {
    const f = clientFor((path) => path.includes('/me') ? { code: 200, data: me } : { code: 200, data: publicList })
    const context = await f.client.context(workspace)
    const result = await f.client.profileTemplates(context)
    expect(result.total).toBe(1)
    expect(result.list[0]).toMatchObject({ id: templateId, displayName: '内容创作', counts: { skills: 2 } })
    expect(JSON.stringify(result)).not.toContain('test-only-token')
    expect(f.fetcher.mock.calls.at(-1)?.[0]).toBe('https://ai.hozonauto.com/plugins/api/skillhub/v1/profile-templates/public?page=1&limit=50')
    f.client.dispose()
  })
  it('rejects malformed template payloads as invalid responses', async () => {
    const broken = { ...publicList, list: [{ ...publicList.list[0]!, displayName: ''.padEnd(25, '名') }] }
    const f = clientFor((path) => path.includes('/me') ? { code: 200, data: me } : { code: 200, data: broken })
    const context = await f.client.context(workspace)
    await expect(f.client.profileTemplates(context)).rejects.toMatchObject({ code: 'HUB_INVALID_RESPONSE' })
    f.client.dispose()
  })
  it('previews per-item disposition and requires a reason on blocked entries', async () => {
    const f = clientFor((path) => path.includes('/me') ? { code: 200, data: me } : { code: 200, data: preview })
    const context = await f.client.context(workspace)
    const result = await f.client.profileTemplatePreview(context, templateId)
    expect(result.items[0]).toMatchObject({ disposition: 'installable' })
    await expect(f.client.profileTemplatePreview(context, 'not-a-uuid')).rejects.toMatchObject({ code: 'HUB_INVALID_REQUEST' })
    const blocked = { ...preview, items: [{ item: { kind: 'skill', identity: 'a', version: '1.0.0', enabled: true }, disposition: 'blocked' }] }
    const g = clientFor((path) => path.includes('/me') ? { code: 200, data: me } : { code: 200, data: blocked })
    const other = await g.client.context(workspace)
    await expect(g.client.profileTemplatePreview(other, templateId)).rejects.toMatchObject({ code: 'HUB_INVALID_RESPONSE' })
    f.client.dispose(); g.client.dispose()
  })
  it('registers the profile selection for the generations pipeline and validates the reply', async () => {
    const f = clientFor((path) => path.includes('/me') ? { code: 200, data: me } : { code: 201, data: instantiate })
    const context = await f.client.context(workspace)
    const result = await f.client.instantiateProfileTemplate(context, { templateId, profileName: '  内容创作  ', deviceId, profileId })
    expect(result).toMatchObject({ profileId, profileName: '内容创作', items: [{ kind: 'skill', enabled: true }] })
    const call = f.fetcher.mock.calls.at(-1)
    expect(call?.[0]).toBe(`https://ai.hozonauto.com/plugins/api/skillhub/v1/profile-templates/${templateId}/instantiate`)
    expect(call?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ templateId, profileName: '内容创作', deviceId, profileId }) })
    await expect(f.client.instantiateProfileTemplate(context, { templateId, profileName: '', deviceId, profileId })).rejects.toMatchObject({ code: 'HUB_INVALID_REQUEST' })
    await expect(f.client.instantiateProfileTemplate(context, { templateId, profileName: 'x', deviceId, profileId: 'not-a-uuid' })).rejects.toMatchObject({ code: 'HUB_INVALID_REQUEST' })
    f.client.dispose()
  })
  it('re-registers a selection from a frozen revision at the fixed origin', async () => {
    const payload = { profileId, templateId, revision: 3, items: [{ kind: 'skill', itemId: '66666666-6666-4666-8666-666666666666', releaseId: '88888888-8888-4888-8888-888888888888', version: '1.0.0', enabled: true }], mcpEndpoints: [], skippedItems: [] }
    const f = clientFor((path) => path.includes('/me') ? { code: 200, data: me } : { code: 200, data: payload })
    const context = await f.client.context(workspace)
    const result = await f.client.registerTemplateSelection(context, { templateId, revision: 3, deviceId, profileId })
    expect(result).toMatchObject({ profileId, templateId, revision: 3, items: [{ kind: 'skill' }] })
    expect(f.fetcher.mock.calls.at(-1)?.[0]).toBe(`https://ai.hozonauto.com/plugins/api/skillhub/v1/profile-templates/${templateId}/revisions/3/selection`)
    await expect(f.client.registerTemplateSelection(context, { templateId, revision: 0, deviceId, profileId })).rejects.toMatchObject({ code: 'HUB_INVALID_REQUEST' })
    f.client.dispose()
  })

  it('requires SSO before any template call', async () => {
    const f = clientFor(() => { throw new Error('must not fetch') })
    f.logout()
    const stale = { tenantId: tenant, workspaceId: workspace, actorRef: 'test-actor', permissions: [], revision: 0 } as HubHostContext
    await expect(f.client.profileTemplates(stale)).rejects.toMatchObject({ code: 'HUB_SSO_REQUIRED' })
    f.client.dispose()
  })
})
