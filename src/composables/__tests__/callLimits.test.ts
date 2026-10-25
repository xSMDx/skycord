import { describe, it, expect } from 'vitest'
import { visibleTiles, qualityFor, bySpeechRecency, type TileCandidate } from '../callLimits'

const t = (id: string, o: Partial<TileCandidate> = {}): TileCandidate =>
  ({ id, isSelf: false, speaking: false, hasVideo: true, lastSpokeAt: 0, ...o })

describe('visibleTiles', () => {
  it('shows everyone when there is no cap', () => {
    expect(visibleTiles([t('a'), t('b'), t('c')], Infinity)).toEqual(['a', 'b', 'c'])
  })

  it('keeps whoever is speaking', () => {
    const tiles = [t('a', { lastSpokeAt: 1 }), t('b', { speaking: true }), t('c', { lastSpokeAt: 2 })]
    expect(visibleTiles(tiles, 2)).toContain('b')
  })

  it('fills the rest with whoever spoke most recently', () => {
    const tiles = [t('a', { lastSpokeAt: 1 }), t('b', { lastSpokeAt: 9 }), t('c', { lastSpokeAt: 5 })]
    expect(visibleTiles(tiles, 2)).toEqual(['b', 'c'])
  })

  it('always keeps you, so your own camera never vanishes', () => {
    const tiles = [t('me', { isSelf: true, lastSpokeAt: 0 }), t('b', { lastSpokeAt: 9 }), t('c', { lastSpokeAt: 8 })]
    expect(visibleTiles(tiles, 2)).toContain('me')
  })

  it('prefers a camera to an avatar when the rest are equal', () => {
    const tiles = [t('a', { hasVideo: false }), t('b', { hasVideo: true })]
    expect(visibleTiles(tiles, 1)).toEqual(['b'])
  })
})

describe('bySpeechRecency', () => {
  const order = (...c: TileCandidate[]) => c.sort(bySpeechRecency).map(x => x.id)

  it('puts whoever is speaking first, whatever the rest say', () => {
    expect(order(t('a', { lastSpokeAt: 9 }), t('b', { speaking: true }))).toEqual(['b', 'a'])
  })

  it('then whoever spoke most recently', () => {
    expect(order(t('a', { lastSpokeAt: 1 }), t('b', { lastSpokeAt: 9 }))).toEqual(['b', 'a'])
  })

  it('then a camera before an avatar', () => {
    expect(order(t('a', { hasVideo: false }), t('b', { hasVideo: true }))).toEqual(['b', 'a'])
  })

  it('leaves equals where they were', () => {
    expect(order(t('a'), t('b'), t('c'))).toEqual(['a', 'b', 'c'])
  })
})

describe('qualityFor', () => {
  it('asks for nothing special when the cap is auto', () => {
    expect(qualityFor('auto')).toBeNull()
  })

  it('maps the caps onto the qualities LiveKit understands', () => {
    expect(qualityFor('720p')).toBe('high')
    expect(qualityFor('360p')).toBe('low')
  })
})
