import { describe, it, expect, vi } from 'vitest'
// richText reads appearance, which pulls in a colour library whose published
// ESM does not load under the test runner — the same stub richText's own test uses.
vi.mock('@/composables/useAppearance', () => ({ appearance: { emojiPack: 'native' } }))
import { decide, chime, classify, mentionsMe, plainBody, unreadCount, BODY_MAX, type RuleState, type Incoming } from '../notifyRules'

const me = { id: 'me', displayName: 'Sam Doe', username: 'samd' }
const state = (over: Partial<RuleState> = {}): RuleState => ({
  me, status: 'online', focused: false, previews: true, isMuted: () => false, levelOf: () => 'default',
  open: null, sounds: { messages: true, reading: false }, ...over,
})
const dm = (over: Partial<Extract<Incoming, { type: 'dm' }>> = {}): Incoming =>
  ({ type: 'dm', messageId: 'm1', partnerId: 'ana', authorId: 'ana', authorName: 'Ana', content: 'hi there', ...over })
const group = (over = {}): Incoming =>
  ({ type: 'group', messageId: 'm2', groupId: 'g1', groupName: 'Crew', authorId: 'ana', authorName: 'Ana', content: 'yo', ...over })
const channel = (over = {}): Incoming => ({
  type: 'channel', messageId: 'm3', channelId: 'c1', channelName: 'general', categoryId: 'k1', serverId: 's1', serverName: 'Home',
  authorId: 'ana', authorName: 'Ana', content: 'hello', mentionsEveryone: false, ...over,
})

describe('what notifies', () => {
  it('a DM, titled by the sender, grouped per conversation, repliable', () => {
    expect(decide(dm(), state())).toEqual({
      id: 'msg:m1', kind: 'message', conversation: { kind: 'dm', id: 'ana' },
      title: 'Ana', body: 'hi there', icon: null, group: { id: 'dm:ana', title: 'Ana' }, canReply: true,
    })
  })
  it('a group message names the group', () => {
    const n = decide(group(), state())!
    expect(n.title).toBe('Ana · Crew')
    expect(n.group).toEqual({ id: 'group:g1', title: 'Crew' })
    expect(n.conversation).toEqual({ kind: 'group', id: 'g1' })
  })
  it('a channel message only when it mentions you', () => {
    expect(decide(channel(), state())).toBeNull()
    const n = decide(channel({ content: 'ping <@Sam Doe> look' }), state())!
    expect(n.kind).toBe('mention')
    expect(n.title).toBe('Ana · #general · Home')
    expect(n.body).toBe('ping @Sam Doe look')
    expect(n.conversation).toEqual({ kind: 'channel', id: 'c1', serverId: 's1' })
  })
  it('@everyone counts when the server says it does', () => {
    expect(decide(channel({ content: '@everyone', mentionsEveryone: true }), state())).not.toBeNull()
    expect(decide(channel({ content: '@everyone', mentionsEveryone: false }), state())).toBeNull()
  })
  it('friend requests, received and accepted', () => {
    expect(decide({ type: 'friend', userId: 'ana', name: 'Ana', accepted: false }, state())).toMatchObject({
      kind: 'friend', title: 'Friend request', body: 'Ana sent you a friend request.', conversation: null, canReply: false,
    })
    expect(decide({ type: 'friend', userId: 'ana', name: 'Ana', accepted: true }, state())?.body).toBe('Ana accepted your friend request.')
  })
  it('an incoming call', () => {
    expect(decide({ type: 'call', room: 'dm:a_b', kind: 'dm', convId: 'ana', muteKey: 'ana', name: 'Ana' }, state())).toMatchObject({
      id: 'call:dm:a_b', kind: 'call', title: 'Ana', body: 'Incoming call', conversation: { kind: 'dm', id: 'ana' },
    })
  })
})

describe('what never notifies', () => {
  it('your own message', () => {
    expect(decide(dm({ authorId: 'me' }), state())).toBeNull()
    expect(decide(group({ authorId: 'me' }), state())).toBeNull()
    expect(decide(channel({ authorId: 'me', content: '<@samd>' }), state())).toBeNull()
  })
  it('a muted conversation, keyed the way mutes are keyed', () => {
    const muted = (key: string) => key === 'ana' || key === 'g1' || key === 'c1'
    expect(decide(dm(), state({ isMuted: muted }))).toBeNull()
    expect(decide(group(), state({ isMuted: muted }))).toBeNull()
    expect(decide(channel({ content: '<@samd>' }), state({ isMuted: muted }))).toBeNull()
    expect(decide({ type: 'call', room: 'r', kind: 'dm', convId: 'ana', muteKey: 'ana', name: 'Ana' }, state({ isMuted: muted }))).toBeNull()
  })
  it('anything while Do Not Disturb', () => {
    expect(decide(dm(), state({ status: 'dnd' }))).toBeNull()
    expect(decide({ type: 'friend', userId: 'x', name: 'X', accepted: false }, state({ status: 'dnd' }))).toBeNull()
  })
  it('anything while the window is focused', () => {
    expect(decide(dm(), state({ focused: true }))).toBeNull()
  })
})

describe('what it says', () => {
  it('previews off hides the text', () => {
    expect(decide(dm(), state({ previews: false }))?.body).toBe('New message')
  })
  it('an empty message still says something', () => {
    expect(decide(dm({ content: '   ' }), state())?.body).toBe('New message')
  })
  it('cuts long text to one line', () => {
    const out = plainBody('a\n\n' + 'b'.repeat(400))
    expect(out.length).toBe(BODY_MAX)
    expect(out.endsWith('…')).toBe(true)
    expect(out).not.toMatch(/\n/)
  })
})

describe('mentionsMe', () => {
  it('matches display name or username, any case', () => {
    expect(mentionsMe('<@sam doe>', me)).toBe(true)
    expect(mentionsMe('<@SAMD>', me)).toBe(true)
    expect(mentionsMe('<@Samantha>', me)).toBe(false)
    expect(mentionsMe('Sam Doe without brackets', me)).toBe(false)
  })
  it('treats regex characters in a name literally', () => {
    const odd = { id: 'x', displayName: 'a.b+c', username: 'u' }
    expect(mentionsMe('<@a.b+c>', odd)).toBe(true)
    expect(mentionsMe('<@aXb+c>', odd)).toBe(false)
  })
})

describe('unreadCount', () => {
  it('counts conversations that would notify', () => {
    const dms = [{ id: 'ana', unread: 2 }, { id: 'bo', unread: 0 }, { id: 'cy', unread: 1 }]
    const groups = [{ id: 'g1', unread: 5 }, { id: 'g2' }]
    expect(unreadCount(dms, groups, ['c1', 'c2'], k => k === 'cy')).toBe(4)   // ana, g1, c1, c2
  })
})

describe('levels and mutes on servers, categories and channels', () => {
  const levels = (m: Record<string, 'default' | 'all' | 'mentions' | 'nothing'>) => (id: string) => m[id] ?? 'default'
  const mention = { content: 'hey <@samd>' }

  it('All Messages notifies without a mention, as a message rather than a mention', () => {
    const n = decide(channel(), state({ levelOf: levels({ s1: 'all' }) }))!
    expect(n.kind).toBe('message')
    expect(n.title).toBe('Ana · #general · Home')
    expect(decide(channel(mention), state({ levelOf: levels({ s1: 'all' }) }))!.kind).toBe('mention')
  })
  it('Nothing silences even a mention', () => {
    expect(decide(channel(mention), state({ levelOf: levels({ s1: 'nothing' }) }))).toBeNull()
    expect(decide(channel({ ...mention, mentionsEveryone: true }), state({ levelOf: levels({ k1: 'nothing' }) }))).toBeNull()
  })
  it('the nearest level wins', () => {
    expect(decide(channel(), state({ levelOf: levels({ s1: 'nothing', c1: 'all' }) }))).not.toBeNull()
    expect(decide(channel(mention), state({ levelOf: levels({ s1: 'all', k1: 'nothing' }) }))).toBeNull()
  })
  it('a muted server or category silences its channels', () => {
    expect(decide(channel(mention), state({ isMuted: k => k === 's1' }))).toBeNull()
    expect(decide(channel(mention), state({ isMuted: k => k === 'k1' }))).toBeNull()
    expect(decide(channel({ ...mention, categoryId: null }), state({ isMuted: k => k === 'k1' }))).not.toBeNull()
  })
  it('classify says whether it is for you, whatever the window is doing', () => {
    expect(classify(channel(mention), state({ focused: true }))).toBe('mention')
    expect(classify(dm(), state({ focused: true }))).toBe('message')
    expect(classify(channel(), state())).toBeNull()
  })
})

describe('which sound', () => {
  const call: Incoming = { type: 'call', room: 'r', kind: 'dm', convId: 'ana', muteKey: 'ana', name: 'Ana' }

  it('a message dings; a mention, @everyone or friend request chimes', () => {
    expect(chime(dm(), state())).toBe('message')
    expect(chime(group(), state())).toBe('message')
    expect(chime(channel({ content: '<@samd>' }), state())).toBe('notification')
    expect(chime(channel({ content: '@everyone', mentionsEveryone: true }), state())).toBe('notification')
    expect(chime(dm({ content: '@everyone look' }), state())).toBe('notification')
    expect(chime({ type: 'friend', userId: 'x', name: 'X', accepted: false }, state())).toBe('notification')
  })
  it('plays while the window is in front, for a conversation not on screen', () => {
    expect(chime(dm(), state({ focused: true, open: { kind: 'group', id: 'g1' } }))).toBe('message')
    expect(chime(dm(), state({ focused: true, open: null }))).toBe('message')
  })
  it('not for the conversation you are reading, unless that is switched on', () => {
    const reading = { focused: true, open: { kind: 'dm' as const, id: 'ana' } }
    expect(chime(dm(), state(reading))).toBeNull()
    expect(chime(dm(), state({ ...reading, sounds: { messages: true, reading: true } }))).toBe('message')
    expect(chime(channel({ content: '<@samd>' }), state({ focused: true, open: { kind: 'channel', id: 'c1' } }))).toBeNull()
    // The same conversation in a window that is not in front is not being read.
    expect(chime(dm(), state({ focused: false, open: { kind: 'dm', id: 'ana' } }))).toBe('message')
  })
  it('follows the same mutes and levels as notifications', () => {
    expect(chime(dm(), state({ isMuted: k => k === 'ana' }))).toBeNull()
    expect(chime(channel(), state())).toBeNull()
    expect(chime(channel(), state({ levelOf: id => (id === 's1' ? 'all' : 'default') }))).toBe('message')
    expect(chime(channel({ content: '<@samd>' }), state({ isMuted: k => k === 's1' }))).toBeNull()
  })
  it('silent for your own messages, Do Not Disturb, calls, and with message sounds off', () => {
    expect(chime(dm({ authorId: 'me' }), state())).toBeNull()
    expect(chime(dm(), state({ status: 'dnd' }))).toBeNull()
    expect(chime(call, state())).toBeNull()
    expect(chime(dm(), state({ sounds: { messages: false, reading: true } }))).toBeNull()
  })
})

describe('unreadCount with channel mutes', () => {
  it('leaves out alerted channels that have since been muted', () => {
    expect(unreadCount([], [], ['c1', 'c2'], () => false, c => c === 'c2')).toBe(1)
  })
})
