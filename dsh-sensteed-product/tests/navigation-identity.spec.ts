import { describe, expect, it, vi } from 'vitest'
import { observeNavigationIdentity } from '../src/client/navigation-identity.ts'

describe('navigation identity boundary', () => {
  it('invalidates on subject, group and logout changes, without firing on equivalent snapshots', () => {
    let value: { authMode: string; identity?: { ssoSub: string; groups: string[] } } = { authMode: 'feishu', identity: { ssoSub: 'user-a', groups: ['b', 'a'] } }
    let listener = () => {}
    const off = vi.fn(), changed = vi.fn()
    const dispose = observeNavigationIdentity({ getSnapshot: () => ({ value }), subscribe: callback => { listener = callback; return off } }, changed)
    value = { ...value, identity: { ssoSub: 'user-a', groups: ['a', 'b'] } }; listener(); expect(changed).not.toHaveBeenCalled()
    value = { ...value, identity: { ssoSub: 'user-b', groups: ['a'] } }; listener(); expect(changed).toHaveBeenCalledTimes(1)
    value = { ...value, identity: { ssoSub: 'user-b', groups: [] } }; listener(); expect(changed).toHaveBeenCalledTimes(2)
    value = { authMode: 'feishu' }; listener(); expect(changed).toHaveBeenCalledTimes(3)
    expect(changed.mock.calls.every(call => call.length === 0)).toBe(true)
    dispose(); expect(off).toHaveBeenCalledOnce()
  })
})
