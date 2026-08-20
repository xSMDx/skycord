import { describe, it, expect } from 'vitest'
import { toClientMessage } from '../useMessageAdapter'

const base = {
  _id: '507f1f77bcf86cd799439011',
  conversationId: 'chan1',
  authorId: 'u1',
  authorName: 'Ada',
  authorAvatar: null,
  content: 'hello',
  reactions: [],
  pinned: false,
  edited: false,
  createdAt: '2026-08-19T10:30:00.000Z',
}

describe('toClientMessage', () => {
  it('keeps the full ObjectId in dbId and derives a numeric id', () => {
    const m = toClientMessage(base)
    expect(m.dbId).toBe('507f1f77bcf86cd799439011')
    expect(typeof m.id).toBe('number')
    expect(Number.isNaN(m.id)).toBe(false)
  })

  it('accepts `id` when the payload has no `_id`', () => {
    const m = toClientMessage({ ...base, _id: undefined, id: '507f1f77bcf86cd799439012' })
    expect(m.dbId).toBe('507f1f77bcf86cd799439012')
  })

  it('marks a reaction as reacted only for the calling user', () => {
    const withReacts = { ...base, reactions: [{ emoji: '👍', userIds: ['u1', 'u2'] }] }
    expect(toClientMessage(withReacts, 'u1').reactions[0]).toEqual({ emoji: '👍', count: 2, reacted: true })
    expect(toClientMessage(withReacts, 'u9').reactions[0].reacted).toBe(false)
  })

  it('leaves reactions empty rather than undefined when the payload omits them', () => {
    const m = toClientMessage({ ...base, reactions: undefined })
    expect(m.reactions).toEqual([])
  })

  it('falls back to a generated avatar when the author has none', () => {
    expect(toClientMessage(base).avatar).toContain('data:image/svg+xml')
  })

  it('keeps a stored avatar as-is and carries its crop', () => {
    const crop = { zoom: 1.4, x: 10, y: -5 }
    const m = toClientMessage({ ...base, authorAvatar: 'https://cdn/x.gif', authorAvatarCrop: crop })
    expect(m.avatar).toBe('https://cdn/x.gif')
    expect(m.avatarCrop).toEqual(crop)
  })

  it('drops an empty replyTo array so `v-if="replyTo"` stays false', () => {
    expect(toClientMessage({ ...base, replyTo: [] }).replyTo).toBeUndefined()
    const parents = [{ id: 'p1', author: 'Bob', content: 'hi' }]
    expect(toClientMessage({ ...base, replyTo: parents }).replyTo).toEqual(parents)
  })

  it('derives timestamp from createdAt', () => {
    expect(toClientMessage(base).timestamp).toBe(Date.parse('2026-08-19T10:30:00.000Z'))
  })
})
