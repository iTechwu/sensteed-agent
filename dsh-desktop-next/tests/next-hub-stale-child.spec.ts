/** Private IPC must discard commands after this child relinquishes lifecycle ownership. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopHostProcess } from '../src/host-process.ts'

const roots: string[] = [],
  hosts: DesktopHostProcess[] = []
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.stop().catch(() => {})
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

it('ignores a delayed Hub base request emitted by a child that is already stopping', async () => {
  const root = mkdtempSync(join(tmpdir(), 'next-stale-hub-child-'))
  roots.push(root)
  const packageRoot = join(
    root,
    'node_modules',
    '@deepseek-ai',
    'dsh-desktop-host',
  )
  mkdirSync(join(packageRoot, 'lib'), { recursive: true })
  writeFileSync(
    join(packageRoot, 'package.json'),
    '{"name":"@deepseek-ai/dsh-desktop-host","type":"module"}',
  )
  writeFileSync(
    join(packageRoot, 'lib', 'index.js'),
    `
process.send({type:'ready',url:'http://127.0.0.1:43120/?token=fixture',injections:[]});
process.on('message',message=>{if(message.type==='shutdown'){
  process.send({type:'hub-switch',request:{kind:'base'}});
  process.send({type:'shutdown-complete'},()=>process.disconnect());
}});
`,
  )
  const request = vi.fn()
  const host = new DesktopHostProcess(
    process.execPath,
    root,
    root,
    undefined,
    process.env,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { request, waitRendererHealthy: async () => {} },
  )
  hosts.push(host)
  await host.start()
  await host.stop()
  expect(request).not.toHaveBeenCalled()
})

it('rejects a missing Hub policy payload without throwing from the parent message handler', async () => {
  const root = mkdtempSync(join(tmpdir(), 'next-invalid-hub-policy-'))
  roots.push(root)
  const entry = join(root, 'child.cjs')
  writeFileSync(entry, "process.send({type:'hub-policy'});setInterval(()=>{},1000)")
  const host = new DesktopHostProcess(process.execPath, root, root, undefined, process.env,
    undefined, undefined, undefined, entry)
  hosts.push(host)
  await expect(host.start()).rejects.toThrow('invalid IPC event')
})
