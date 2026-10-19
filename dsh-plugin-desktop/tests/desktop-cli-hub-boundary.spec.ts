import { expect, it, vi } from 'vitest'
const boundary = vi.hoisted(() => vi.fn())
vi.mock('../src/hub-cli-policy.ts', () => ({ enforceSealedSensteedCli: boundary }))
import { runDesktopDshCli } from '../src/desktop-cli.ts'
it('rejects before Harness import, legacy bundled roots, profile processing or RunAsNode mutation', async () => {
 const env = { ELECTRON_RUN_AS_NODE: '1', DSH_DESKTOP_DEFAULT_PROFILE: '../../unsafe', DSH_BUNDLED_SKILL_DIR: '/personal' }
 const load = vi.fn()
 boundary.mockRejectedValueOnce(Error('Desktop Hub authorization'))
 await expect(runDesktopDshCli(env, load, ['node', 'entry', 'chat'])).rejects.toThrow('Desktop Hub authorization')
 expect(load).not.toHaveBeenCalled()
 expect(env).toEqual({ ELECTRON_RUN_AS_NODE: '1', DSH_DESKTOP_DEFAULT_PROFILE: '../../unsafe', DSH_BUNDLED_SKILL_DIR: '/personal' })
})
it('static help never dispatches upstream CLI or alters personal roots', async () => {
 const env = { DSH_BUNDLED_SKILL_DIR: '/personal' }, load = vi.fn()
 const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
 try {
  boundary.mockResolvedValueOnce('Sensteed Agent help\n')
  await runDesktopDshCli(env, load, ['node', 'entry', '--help'])
  expect(load).not.toHaveBeenCalled()
  expect(env.DSH_BUNDLED_SKILL_DIR).toBe('/personal')
  expect(stdout).toHaveBeenCalledWith('Sensteed Agent help\n')
 } finally { stdout.mockRestore() }
})
