import { describe, it, expect } from 'vitest'
import { offlineMessage } from '../offlineMessage'

// A member is never told to run a script — that instruction only makes sense
// to whoever operates this instance. The production string must stand on its
// own with no trace of the developer hint; the developer build keeps it.
describe('offlineMessage', () => {
  it('never names a script or the API server to a member', () => {
    const msg = offlineMessage(false)
    expect(msg).not.toContain('.cmd')
    expect(msg).not.toContain('start-dev')
    expect(msg).not.toContain('API server')
  })

  it('still tells the developer how to fix it', () => {
    const msg = offlineMessage(true)
    expect(msg).toContain('start-dev.cmd')
  })
})
