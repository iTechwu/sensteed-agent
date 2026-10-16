import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../index.js'

const ROUTE = '/api/desktop/sensteed/skills'

function fixture(connection) {
  let handler
  let reads = 0
  let remote = 0
  apply({
    connection,
    webServer: { port: 3112, register: route => { handler = route.handler } },
    skills: { list: async () => { reads += 1; return [] } },
    dofeAuth: { getDatasourceSession: () => { remote += 1; throw Error('must not query identity') } },
  })
  return {
    counts: () => ({ reads, remote }),
    async request(method = 'GET', url = `${ROUTE}?source=local`, headers = {}) {
      let status, body
      const req = {
        method, url, headers: { host: '127.0.0.1:3112', ...headers },
        socket: { remoteAddress: '127.0.0.1' },
        [Symbol.asyncIterator]() { throw Error('rejected request body must not be read') },
      }
      await handler(req, { writeHead: value => { status = value }, end: value => { body = JSON.parse(value) } })
      return { status, body }
    },
  }
}

test('requires live Host admission before reads, identity lookups or mutation bodies', async () => {
  for (const connection of [undefined, { admit: () => ({ rejection: 401 }) }, { admit() { throw Error('offline') } }]) {
    const f = fixture(connection)
    assert.equal((await f.request()).status, 401)
    assert.equal((await f.request('POST', `${ROUTE}/hub/workspace`, { origin: 'http://127.0.0.1:3112', 'content-type': 'application/json' })).status, 401)
    assert.deepEqual(f.counts(), { reads: 0, remote: 0 })
  }
})

test('rejects untrusted requests and authenticated non-owner peers', async () => {
  for (const admission of [{ rejection: 403 }, { peer: { principal: { kind: 'agent' } } }, { peer: {} }]) {
    const f = fixture({ admit: () => admission })
    assert.equal((await f.request()).status, 403)
    assert.deepEqual(f.counts(), { reads: 0, remote: 0 })
  }
})

test('admitted owner still requires local same-origin access', async () => {
  const f = fixture({ admit: () => ({ peer: { principal: { kind: 'owner' } } }) })
  assert.equal((await f.request('GET', `${ROUTE}?source=local`, { origin: 'https://foreign.invalid' })).status, 403)
  assert.deepEqual(f.counts(), { reads: 0, remote: 0 })
  assert.deepEqual(await f.request(), { status: 200, body: { skills: [] } })
  assert.deepEqual(f.counts(), { reads: 1, remote: 0 })
})
