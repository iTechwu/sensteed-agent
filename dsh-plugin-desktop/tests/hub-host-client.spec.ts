import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { hubCanonicalJson, hubSyncDigest, hubSyncSnapshotData, type HubSyncExpected } from '../src/hub-sync-verifier.ts'
import { registerHubHostService } from '../src/hub-host-service.ts'
import { describe, expect, it, vi } from 'vitest'
import { HubHostClient, type HubSsoSession } from '../src/hub-host-client.ts'
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
  it('checks an authenticated signed snapshot without consuming or activating anything', async () => {
    const f = fixture(), context = await f.client.context(), now = Date.now(), pair = generateKeyPairSync('ed25519')
    const expected: HubSyncExpected = { origin: 'https://ai.hozonauto.com/plugins/api', tenantId: tenant, actorRef: 'test-actor', deviceId: randomUUID(), profileId: randomUUID(), channel: 'stable', observedStateDigest: 'a'.repeat(64), minimumPolicyRevision: 0,
      target: { sensteedVersion: '0.2.1', harnessVersion: '0.2.1', os: 'darwin', arch: 'arm64', nodeVersion: '22.0.0', cordisVersion: '4.0.5-alpha.2', libc: null, nodeAbi: '127', hostCapabilities: [] } }
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
