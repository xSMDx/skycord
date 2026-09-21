import { describe, it, expect } from 'vitest'
import { readServers, saveServer, renameServer, readdressServer, removeServer, type SavedServer } from '../servers'

const den: SavedServer = { origin: 'https://den.example', name: 'Sky Den', icon: 'https://den.example/icon.png' }
const lan: SavedServer = { origin: 'http://192.168.1.20:8080', name: 'Home', icon: null }

describe('readServers', () => {
  it('reads back what was saved', () => {
    expect(readServers([den, lan])).toEqual([den, lan])
  })

  it('treats anything but a list as no servers', () => {
    for (const bad of [undefined, null, 'x', {}, 5]) expect(readServers(bad)).toEqual([])
  })

  it('reduces addresses to origins, drops the unusable and the repeated', () => {
    expect(readServers([
      { origin: 'https://den.example/some/path', name: 'Sky Den' },
      { origin: 'ftp://nope.example', name: 'x' },
      { origin: 'https://den.example', name: 'again' },
      'junk',
    ])).toEqual([{ origin: 'https://den.example', name: 'Sky Den', icon: null }])
  })

  it('names a server by its address when it has no usable name', () => {
    expect(readServers([{ origin: 'https://den.example', name: '   ' }])[0].name).toBe('den.example')
  })

  it('keeps only web icons', () => {
    expect(readServers([{ origin: 'https://den.example', name: 'x', icon: 'javascript:alert(1)' }])[0].icon).toBeNull()
  })

  it('caps a name’s length', () => {
    expect(readServers([{ origin: 'https://den.example', name: 'a'.repeat(200) }])[0].name).toHaveLength(64)
  })
})

describe('saveServer', () => {
  it('adds a new server at the end', () => {
    expect(saveServer([den], lan)).toEqual([den, lan])
  })

  it('updates a known one in place, keeping its place in the list', () => {
    const list = saveServer([den, lan], { origin: 'https://den.example', name: 'Den 2', icon: null })
    expect(list.map(s => s.name)).toEqual(['Den 2', 'Home'])
  })

  it('does not overwrite a name the member chose with the server’s own', () => {
    const renamed = renameServer([den], den.origin, 'Our place')
    expect(saveServer(renamed, { ...den, name: 'Sky Den' }, { keepName: true })[0].name).toBe('Our place')
  })

  it('refuses an address that is not a web origin', () => {
    expect(saveServer([den], { origin: 'file:///etc', name: 'x', icon: null })).toEqual([den])
  })
})

describe('renameServer', () => {
  it('renames, and falls back to the address when cleared', () => {
    expect(renameServer([den], den.origin, 'Our place')[0].name).toBe('Our place')
    expect(renameServer([den], den.origin, '')[0].name).toBe('den.example')
  })
})

describe('readdressServer', () => {
  it('moves a server to a new address in place', () => {
    const next = readdressServer([den, lan], lan.origin, { origin: 'https://home.example', name: 'Home', icon: null })
    expect(next.map(s => s.origin)).toEqual(['https://den.example', 'https://home.example'])
  })

  it('merges into an entry already at the new address rather than listing it twice', () => {
    const next = readdressServer([den, lan], lan.origin, { origin: den.origin, name: 'Home', icon: null })
    expect(next.map(s => s.origin)).toEqual([den.origin])
  })
})

describe('removeServer', () => {
  it('removes only that server', () => {
    expect(removeServer([den, lan], den.origin)).toEqual([lan])
  })
})
