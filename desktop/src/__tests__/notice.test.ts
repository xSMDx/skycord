import { describe, it, expect } from 'vitest'
import { parseNotice, parseRing, toastOptions } from '../notice'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const good = {
  id: 'msg:1', kind: 'message', conversation: { kind: 'dm', id: 'ana' }, title: 'Ana', body: 'hi',
  icon: PNG, group: { id: 'dm:ana', title: 'Ana' }, canReply: true,
}

describe('parseNotice — everything from the page is checked', () => {
  it('keeps a well-formed notice', () => { expect(parseNotice(good)).toEqual(good) })
  it('refuses the wrong shapes', () => {
    for (const bad of [null, 'x', { ...good, kind: 'evil' }, { ...good, title: 42 }, { ...good, id: '' },
      { ...good, conversation: { kind: 'dm', id: '../x' } }, { ...good, conversation: { kind: 'web', id: 'a' } }]) {
      expect(parseNotice(bad)).toBeNull()
    }
  })
  it('drops an icon that is not a small PNG data URL, and keeps the notice', () => {
    expect(parseNotice({ ...good, icon: 'https://evil.test/a.png' })?.icon).toBeNull()
    expect(parseNotice({ ...good, icon: 'data:image/svg+xml;base64,PHN2Zz4=' })?.icon).toBeNull()
    expect(parseNotice({ ...good, icon: 'data:image/png;base64,' + 'A'.repeat(200_001) })?.icon).toBeNull()
  })
  it('cuts overlong text', () => {
    const n = parseNotice({ ...good, title: 't'.repeat(500), body: 'b'.repeat(1000) })!
    expect(n.title.length).toBeLessThanOrEqual(120)
    expect(n.body.length).toBeLessThanOrEqual(300)
  })
})

describe('parseRing', () => {
  it('keeps a caller, drops a bad icon', () => {
    expect(parseRing({ name: 'Ana', icon: PNG, group: false })).toEqual({ name: 'Ana', icon: PNG, group: false })
    expect(parseRing({ name: 'Ana', icon: 'file:///c:/x.png', group: true })).toEqual({ name: 'Ana', icon: null, group: true })
    expect(parseRing({ name: '', icon: null, group: false })).toBeNull()
    expect(parseRing(null)).toBeNull()
  })
})

describe('toastOptions', () => {
  it('silent, repliable, Mark as read, grouped per conversation', () => {
    expect(toastOptions(parseNotice(good)!)).toEqual({
      title: 'Ana', body: 'hi', silent: true, hasReply: true, replyPlaceholder: 'Reply…',
      actions: [{ type: 'button', text: 'Mark as read' }], groupId: 'dm:ana', groupTitle: 'Ana',
    })
  })
  it('a friend request has nothing to reply to or mark', () => {
    const o = toastOptions(parseNotice({ ...good, kind: 'friend', conversation: null, group: null, canReply: false })!)
    expect(o).toEqual({ title: 'Ana', body: 'hi', silent: true, hasReply: false, actions: [] })
  })
})
