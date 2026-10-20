import { expect, it, vi } from 'vitest'
import { sealedSensteedCliPolicy as policy } from '../src/hub-cli-policy.ts'
const base = { moduleUrl: 'file:///opt/app/resources/app.asar/lib/desktop-cli.js', brand: 'sensteed', resourcesPath: '/opt/app/resources' }
it('blocks all business and mutation entrypoints regardless of selected Profile', async () => {
 for (const args of [[], ['chat'], ['--profile', 'other'], ['plugin', 'add', 'github:other/plugin'], ['plugin', 'remove', 'x'], ['--dump-config'], ['--help', 'plugin']]) {
  const verify = vi.fn(async () => ({}))
  await expect(policy({ ...base, args, verify })).rejects.toThrow('Desktop Hub authorization')
  expect(verify).toHaveBeenCalledOnce()
 }
})
it('serves only standalone static help/version after installed base verification', async () => {
 for (const flag of ['--help', '-h', 'help', '--version', '-V']) {
  const verify = vi.fn(async () => ({}))
  expect(await policy({ ...base, args: [flag], verify })).toContain('哪吒Agent')
  expect(verify).toHaveBeenCalledWith('/opt/app/resources/app.asar', base.resourcesPath)
 }
})
it('fails closed on absent/mismatched installation or corrupt immutable base', async () => {
 for (const resourcesPath of [undefined, '/tmp/other']) {
  const verify = vi.fn()
  await expect(policy({ ...base, resourcesPath, args: ['--help'], verify })).rejects.toThrow('identity unavailable')
  expect(verify).not.toHaveBeenCalled()
 }
 await expect(policy({ ...base, args: ['--help'], verify: async () => { throw Error('corrupt base') } })).rejects.toThrow('corrupt base')
})
it('preserves developer and non-enterprise brand behavior without enterprise verification', async () => {
 const verify = vi.fn()
 expect(await policy({ ...base, moduleUrl: 'file:///workspace/src/desktop-cli.ts', args: ['chat'], verify })).toBeUndefined()
 expect(await policy({ ...base, brand: 'yootun', args: ['plugin', 'add', 'x'], verify })).toBeUndefined()
 expect(verify).not.toHaveBeenCalled()
})
