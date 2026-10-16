import assert from 'node:assert/strict'
import test from 'node:test'
import { allHubPages, callHubCatalog, HubCatalogClient } from '../hub-client.js'

const team = '10000000-0000-4000-8000-000000000001'
const second = '10000000-0000-4000-8000-000000000002'
const tenant = '20000000-0000-4000-8000-000000000001'
const session = { accessToken: 'test-session-placeholder', operator: 'actor-A', tenantId: team }
const ctx = { dofeAuth: { getDatasourceSession: () => session } }
const ok = data => ({ ok: true, status: 200, json: async () => ({ code: 200, data }) })
const me = selected => ({ tenantId: tenant, permissions: ['hub.skill.read'], workspace: { ssoTeam: { id: selected } } })
const page = (list, total = list.length, current = 1) => ({ list, total, page: current, limit: 100 })

test('keeps enterprise bearer on the pinned Host endpoint and rejects redirects', async () => {
  const calls = []
  assert.deepEqual(await callHubCatalog(ctx, '/skillhub/v1/me', { workspaceId: team, fetch: async (...args) => {
    calls.push(args); return ok(me(team))
  } }), me(team))
  assert.equal(calls[0][0], 'https://ai.hozonauto.com/plugins/api/skillhub/v1/me')
  assert.equal(calls[0][1].headers.Authorization, `Bearer ${session.accessToken}`)
  assert.equal(calls[0][1].headers['x-current-tenant'], team)
  assert.equal(calls[0][1].redirect, 'error')
  await assert.rejects(callHubCatalog(ctx, 'https://elsewhere.invalid', {}), { code: 'HUB_INVALID_REQUEST' })
  await assert.rejects(callHubCatalog(ctx, '/skillhub/v1/me', { fetch: async () => { throw Error(session.accessToken) } }), error => {
    assert.equal(error.message.includes(session.accessToken), false)
    return error.code === 'HUB_UNAVAILABLE'
  })
})

test('loads all 101 catalogue entries and never silently truncates the second page', async () => {
  const requests = []
  const result = await allHubPages(ctx, '/skillhub/v1/skills', { fetch: async url => {
    const current = Number(new URL(url).searchParams.get('page'))
    requests.push(current)
    const ids = Array.from({ length: current === 1 ? 100 : 1 }, (_, i) => ({ skillId: `30000000-0000-4000-8000-${String((current - 1) * 100 + i).padStart(12, '0')}` }))
    return ok(page(ids, 101, current))
  } })
  assert.equal(result.list.length, 101)
  assert.deepEqual(requests, [1, 2])
})

test('rejects duplicate, changing or incomplete pagination instead of returning a partial catalog', async () => {
  for (const mode of ['duplicate', 'changed', 'empty']) {
    await assert.rejects(allHubPages(ctx, '/skillhub/v1/skills', { fetch: async url => {
      const current = Number(new URL(url).searchParams.get('page'))
      return ok(page(current === 2 && mode === 'empty' ? [] : [{ skillId: team }], mode === 'changed' && current === 2 ? 3 : 2, current))
    } }), error => ['HUB_INVALID_RESPONSE', 'HUB_CATALOG_CHANGED'].includes(error.code))
  }
})

test('retains healthy plugin rows when the skills source fails', async () => {
  const client = new HubCatalogClient(ctx, { fetch: async url => {
    if (url.endsWith('/me')) return ok(me(team))
    if (url.includes('/skills?')) return { ok: false, status: 502, json: async () => null }
    if (url.includes('/plugins?')) return ok(page([{ pluginId: second }]))
    return ok(page([{ ssoTeam: { id: team } }]))
  } })
  const result = await client.catalog()
  assert.equal(result.plugins.list[0].pluginId, second)
  assert.equal(result.skills.code, 'HUB_UNAVAILABLE')
  assert.equal(result.workspaceError, null)
  assert.equal(JSON.stringify(result).includes(session.accessToken), false)
})

test('verifies workspace selection before retaining it and offers recovery after membership loss', async () => {
  const selected = []
  const client = new HubCatalogClient(ctx, { fetch: async (url, init) => {
    selected.push(init.headers['x-current-tenant'])
    if (url.endsWith('/me')) return { ok: false, status: 403, json: async () => null }
    return ok(page([{ ssoTeam: { id: second } }]))
  } })
  await assert.rejects(client.select(second), { code: 'HUB_ACCESS_DENIED' })
  assert.equal(client.workspaceId, undefined)
  const result = await client.catalog()
  assert.equal(result.workspaces[0].ssoTeam.id, second)
  assert.equal(selected.at(-1), undefined, 'membership recovery does not resend the rejected workspace')
})

test('discards an in-flight response after switching accounts', async () => {
  let active = { ...session }
  let release
  let started
  const ready = new Promise(resolve => { started = resolve })
  const waiting = new Promise(resolve => { release = resolve })
  const client = new HubCatalogClient({ dofeAuth: { getDatasourceSession: () => active } }, { fetch: async url => {
    if (url.endsWith('/me')) return ok(me(team))
    started(); await waiting
    return ok(page([]))
  } })
  const pending = client.catalog()
  await ready
  active = { ...session, operator: 'actor-B' }
  release()
  await assert.rejects(pending, { code: 'HUB_WORKSPACE_CHANGED' })
  assert.equal(client.workspaceId, undefined)
})

test('rejects a context response that silently replaces a previously verified workspace selection',async () => {
  let returned=team
  const client=new HubCatalogClient(ctx,{fetch:async()=>ok(me(returned))})
  await client.select(team)
  returned=second
  await assert.rejects(client.context(),{code:'HUB_INVALID_RESPONSE'})
})
