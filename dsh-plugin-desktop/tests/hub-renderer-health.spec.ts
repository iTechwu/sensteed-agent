import { expect, it, vi } from 'vitest'
import { HubRendererHealth } from '../src/hub-renderer-health.ts'

it('requires the current launch generation receipt and fences stale or failed waits', async () => {
  const health = new HubRendererHealth()
  await expect(health.wait('g1')).rejects.toThrow('does not match')
  health.begin('g1')
  const accepted = vi.fn()
  const first = health.wait('g1').then(accepted)
  await Promise.resolve()
  expect(accepted).not.toHaveBeenCalled()
  health.healthy('g1')
  await first
  expect(accepted).toHaveBeenCalledOnce()
  health.begin('g1')
  const next = health.wait('g1')
  health.begin('g2')
  await expect(next).rejects.toThrow('superseded')
  expect(() => health.healthy('g1')).toThrow('changed')
  const failed = health.wait('g2')
  health.fail(new Error('client failed'))
  await expect(failed).rejects.toThrow('client failed')
  await expect(health.wait('g2')).rejects.toThrow('does not match')
})
