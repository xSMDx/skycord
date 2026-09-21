import { describe, it, expect } from 'vitest'
import { createNavHistory, placeKey, titleOf, toHex, type Place } from '../desktopTitleBar'

const at = (view: Place['view'], ids: Partial<Place> = {}): Place =>
  ({ view, serverId: null, channelId: null, dmId: null, groupId: null, ...ids })

describe('createNavHistory', () => {
  const make = () => createNavHistory<Place>(placeKey)

  it('goes back and forward through the places visited', () => {
    const h = make()
    h.push(at('friends'))
    h.push(at('server', { serverId: 's1', channelId: 'c1' }))
    h.push(at('dm', { dmId: 'd1' }))
    expect(h.back()).toEqual(at('server', { serverId: 's1', channelId: 'c1' }))
    expect(h.back()).toEqual(at('friends'))
    expect(h.back()).toBeNull()
    expect(h.forward()).toEqual(at('server', { serverId: 's1', channelId: 'c1' }))
  })

  it('says when there is somewhere to go', () => {
    const h = make()
    expect([h.canBack, h.canForward]).toEqual([false, false])
    h.push(at('friends'))
    h.push(at('discover'))
    expect([h.canBack, h.canForward]).toEqual([true, false])
    h.back()
    expect([h.canBack, h.canForward]).toEqual([false, true])
  })

  it('a new place after going back drops the way forward, as a browser does', () => {
    const h = make()
    h.push(at('friends'))
    h.push(at('discover'))
    h.back()
    h.push(at('dm', { dmId: 'd1' }))
    expect(h.canForward).toBe(false)
  })

  it('does not record the same place twice in a row', () => {
    const h = make()
    h.push(at('friends'))
    h.push(at('friends'))
    expect(h.canBack).toBe(false)
  })

  it('a channel is a place of its own', () => {
    const h = make()
    h.push(at('server', { serverId: 's1', channelId: 'c1' }))
    h.push(at('server', { serverId: 's1', channelId: 'c2' }))
    expect(h.back()).toEqual(at('server', { serverId: 's1', channelId: 'c1' }))
  })

  it('keeps a bounded history', () => {
    const h = createNavHistory<Place>(placeKey, 3)
    for (const id of ['a', 'b', 'c', 'd']) h.push(at('dm', { dmId: id }))
    expect(h.back()?.dmId).toBe('c')
    expect(h.back()?.dmId).toBe('b')
    expect(h.back()).toBeNull()
  })
})

describe('titleOf', () => {
  const origin = 'https://den.example'

  it('names a server by its name and icon, made absolute for the app', () => {
    expect(titleOf('server', { name: 'Sky Den', img: '/uploads/i.png' }, origin))
      .toEqual({ title: 'Sky Den', kind: 'server', icon: 'https://den.example/uploads/i.png' })
  })

  it('calls DMs and groups Direct Messages, as Discord does', () => {
    expect(titleOf('dm', null, origin).title).toBe('Direct Messages')
    expect(titleOf('group', null, origin).kind).toBe('dms')
  })

  it('has Friends and Discover', () => {
    expect(titleOf('friends', null, origin)).toEqual({ title: 'Friends', kind: 'friends', icon: null })
    expect(titleOf('discover', null, origin).title).toBe('Discover')
  })

  it('falls back to Friends for a server view with no server yet', () => {
    expect(titleOf('server', null, origin).title).toBe('Friends')
  })
})

describe('toHex', () => {
  it('turns a computed colour into #rrggbb', () => {
    expect(toHex('rgb(17, 18, 20)')).toBe('#111214')
    expect(toHex('rgba(255, 255, 255, 0.5)')).toBe('#ffffff')
  })

  it('refuses what it cannot read', () => {
    expect(toHex('color(srgb 1 1 1)')).toBeNull()
    expect(toHex('')).toBeNull()
  })
})
