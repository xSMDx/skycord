import { describe, expect, it } from 'vitest'
import { placeMuted, placeLevel, SERVER_DEFAULT, type LevelChoice, type Place } from '../notifyLevels'

const reader = (muted: string[], levels: Record<string, LevelChoice> = {}) => ({
  isMuted: (id: string) => muted.includes(id),
  levelOf: (id: string) => levels[id] ?? 'default' as LevelChoice,
})
const P: Place = { channelId: 'ch', categoryId: 'cat', serverId: 'srv' }
const bare: Place = { channelId: 'ch', categoryId: null, serverId: 'srv' }

describe('placeMuted', () => {
  it('is muted when the channel, its category or its server is', () => {
    expect(placeMuted(P, reader([]))).toBe(false)
    expect(placeMuted(P, reader(['ch']))).toBe(true)
    expect(placeMuted(P, reader(['cat']))).toBe(true)
    expect(placeMuted(P, reader(['srv']))).toBe(true)
  })

  it('reads no category when the channel has none', () => {
    expect(placeMuted(bare, reader(['cat']))).toBe(false)
  })
})

describe('placeLevel', () => {
  it('servers default to only mentions', () => {
    expect(SERVER_DEFAULT).toBe('mentions')
    expect(placeLevel(P, reader([]))).toBe('mentions')
  })

  it('takes the nearest level that is set: channel, then category, then server', () => {
    expect(placeLevel(P, reader([], { srv: 'all' }))).toBe('all')
    expect(placeLevel(P, reader([], { srv: 'all', cat: 'nothing' }))).toBe('nothing')
    expect(placeLevel(P, reader([], { srv: 'all', cat: 'nothing', ch: 'mentions' }))).toBe('mentions')
  })

  it('skips a category or channel left on the default', () => {
    expect(placeLevel(P, reader([], { srv: 'nothing', cat: 'default', ch: 'default' }))).toBe('nothing')
    expect(placeLevel(bare, reader([], { srv: 'all', cat: 'nothing' }))).toBe('all')
  })
})
