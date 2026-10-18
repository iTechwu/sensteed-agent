import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import Skills from '@deepseek-ai/dsh-skill'
import { expect, it, vi } from 'vitest'
import { registerHubBootstrapSkillRoots } from '../src/hub-skill-roots.ts'
import { registerHubGenerationRoutes } from '../src/hub-generation-routes.ts'

function response() {
  const state: {status?:number; headers?:Record<string,string> | undefined; body?:string | undefined} = {}
  const value = Object.assign(new EventEmitter(),{writableEnded:false,
    writeHead(status:number,headers?:Record<string,string>){state.status=status;state.headers=headers},
    end(text?:string){state.body=text;value.writableEnded=true},
  })
  return {value,state}
}
function request(path:string,body?:unknown,cookie?:string) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  return Object.assign(req,{url:path,method:body === undefined ? 'GET' : 'POST',headers:{host:'127.0.0.1:3112',origin:'http://127.0.0.1:3112',...(cookie ? {cookie} : {}),'content-type':'application/json'},socket:{remoteAddress:'127.0.0.1'}})
}


it('published thin Host leaves installation to owner-authenticated L0 generations without writing personal skills', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'sensteed-thin-host-')))
  const ctx = new Context()
  try {
    type Route = { path: string; handler: (req: IncomingMessage, res: ServerResponse) => unknown }
    const routes: Route[] = []
    ctx.provide('webServer', {
      host: '127.0.0.1', protocol: 'http:', port: 3112,
      register: (route: Route) => { routes.push(route); return () => {} },
      registerUpgrade: () => () => {}, tapIndex: () => () => {},
    } as never)
    let credential: unknown
    ctx.provide('credentials', {
      readRecord: async () => credential,
      modifyRecord: async (_key: string, mutate: (record: unknown) => unknown) => credential = await mutate(credential),
    } as never)
    await ctx.plugin(Connection)
    registerHubBootstrapSkillRoots(ctx, join(home, 'skills'))
    await ctx.plugin(Skills)
    const before = routes.map(route => route.path)
    const require = createRequire(import.meta.url)
    expect(require.resolve('@dofe/dsh-sensteed-skill-manager')).toMatch(/[/\\]thin[/\\]index\.js$/)
    const thin: { name: string; apply: () => void } = await import(pathToFileURL(require.resolve('@dofe/dsh-sensteed-skill-manager')).href)
    await ctx.plugin(thin)
    expect(routes.map(route => route.path)).toEqual(before)
    for (const legacy of ['index.js', 'skill-archive.js', 'hub-release-verifier.js']) {
      expect(() => require.resolve(`@dofe/dsh-sensteed-skill-manager/${legacy}`)).toThrow()
    }
    expect(routes.some(route => route.path.startsWith('/api/desktop/sensteed/skills'))).toBe(false)
    // The private manager seam observes intent routing only: no fake grant or installation authority.
    const check = vi.fn(async (input: unknown) => {
      expect(input).toEqual({})
      return { channel: 'stable', entries: [], activeItems: [] }
    })
    const forbidden = vi.fn(async () => { throw new Error('unexpected execution') })
    ctx.provide('hubGenerationManager', { check, preview: forbidden, execute: forbidden, status: forbidden, restart: forbidden })
    registerHubGenerationRoutes(ctx)
    const path = '/api/desktop/hub/generations/check'
    await vi.waitFor(() => expect(routes.some(row => row.path === path)).toBe(true))
    const route = routes.find(row => row.path === path)!
    const rejected = response()
    await route.handler(request(path, {}) as never, rejected.value as never)
    expect(rejected.state.status).toBe(401)
    expect(check).not.toHaveBeenCalled()
    const url = new URL(ctx.connection.authenticatedUrl('http://127.0.0.1:3112'))
    const exchange = response()
    ctx.connection.authorizeIndex(request(`${url.pathname}${url.search}`) as never, exchange.value as never)
    const cookie = exchange.state.headers?.['set-cookie']?.split(';')[0]
    expect(cookie).toBeTruthy()
    const accepted = response()
    await route.handler(request(path, {}, cookie) as never, accepted.value as never)
    expect(accepted.state.status).toBe(200)
    expect(JSON.parse(accepted.state.body!)).toEqual({ channel: 'stable', entries: [], activeItems: [] })
    expect(check).toHaveBeenCalledOnce()
    expect(forbidden).not.toHaveBeenCalled()
    expect(await ctx.skills.snapshot({})).toMatchObject({ complete: true, skills: [] })
    expect(await readdir(home)).toEqual([])
  } finally {
    await ctx.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  }
})
