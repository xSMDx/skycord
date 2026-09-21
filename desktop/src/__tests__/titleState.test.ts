import { describe, it, expect } from 'vitest'
import { parseTitleState, parseColors, DEFAULT_COLORS } from '../titleState'

describe('parseTitleState', () => {
  it('takes what the web client reports', () => {
    expect(parseTitleState({ title: 'Sky Den', kind: 'server', icon: 'https://den.example/i.png', canBack: true, canForward: false }))
      .toEqual({ title: 'Sky Den', kind: 'server', icon: 'https://den.example/i.png', canBack: true, canForward: false })
  })

  it('refuses anything that is not an object', () => {
    for (const bad of [null, undefined, 'x', 3]) expect(parseTitleState(bad)).toBeNull()
  })

  it('flattens and caps the title', () => {
    const s = parseTitleState({ title: `  a\n\tb  ${'c'.repeat(300)}` })!
    expect(s.title.startsWith('a b ')).toBe(true)
    expect(s.title.length).toBe(100)
  })

  it('treats an unknown kind as the app itself, and only true as true', () => {
    expect(parseTitleState({ title: 'x', kind: 'evil', canBack: 'yes' })).toMatchObject({ kind: 'app', canBack: false, canForward: false })
  })

  it('shows only web or inline-image icons', () => {
    expect(parseTitleState({ title: 'x', icon: 'file:///C:/secret.png' })!.icon).toBeNull()
    expect(parseTitleState({ title: 'x', icon: 'data:image/png;base64,AAAA' })!.icon).toBe('data:image/png;base64,AAAA')
    expect(parseTitleState({ title: 'x', icon: 'data:image/svg+xml,%3Csvg%3E' })!.icon).toBe('data:image/svg+xml,%3Csvg%3E')
    expect(parseTitleState({ title: 'x', icon: 'data:text/html,<b>' })!.icon).toBeNull()
  })
})

describe('parseColors', () => {
  it('takes three hex colours', () => {
    expect(parseColors({ bar: '#111214', text: '#DCDDDE', muted: '#abb1b8' })).toEqual({ bar: '#111214', text: '#dcddde', muted: '#abb1b8' })
  })

  it('refuses anything that is not a plain hex colour: the values reach the window frame', () => {
    for (const bad of [
      { bar: 'red', text: '#fff', muted: '#fff' },
      { bar: '#111214', text: 'url(x)', muted: '#abb1b8' },
      { bar: '#111214', text: '#dcddde' },
      null,
    ]) expect(parseColors(bad)).toBeNull()
  })

  it('has dark defaults that match the app’s own rail', () => {
    expect(DEFAULT_COLORS.bar).toBe('#111214')
  })
})
