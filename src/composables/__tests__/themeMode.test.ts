import { describe, it, expect } from 'vitest'
import {
  automaticTheme, familyOf, pickMode, pickVariant, pickStudio, setAutomatic, onSystemChange, seedVariants,
  type ThemeState,
} from '../themeMode'

const base: ThemeState = { theme: 'default', automatic: false, lastLight: 'light', lastDark: 'default' }

describe('familyOf', () => {
  it('sorts the core variants into light and dark, and Studio and Custom into neither', () => {
    expect(['light', 'light-dim'].map(t => familyOf(t as never))).toEqual(['light', 'light'])
    expect(['default', 'midnight', 'amoled'].map(t => familyOf(t as never))).toEqual(['dark', 'dark', 'dark'])
    expect(['spotify', 'discord', 'custom'].map(t => familyOf(t as never))).toEqual([null, null, null])
  })
})

describe('Automatic', () => {
  it('uses the last-chosen variant of each family (owner, 2026-09-21)', () => {
    const s = { ...base, lastLight: 'light-dim', lastDark: 'midnight' } as const
    expect(automaticTheme(s, true)).toBe('midnight')
    expect(automaticTheme(s, false)).toBe('light-dim')
  })

  it('applies the OS preference the moment it is turned on, and keeps the theme when turned off', () => {
    const on = setAutomatic({ ...base, lastLight: 'light-dim' }, true, false)
    expect(on).toMatchObject({ automatic: true, theme: 'light-dim' })
    expect(setAutomatic(on, false, true)).toMatchObject({ automatic: false, theme: 'light-dim' })
  })

  it('follows a system change only while it is on', () => {
    const on = setAutomatic(base, true, false)
    expect(onSystemChange(on, true).theme).toBe('default')
    expect(onSystemChange(on, false).theme).toBe('light')
    const off = { ...base, theme: 'midnight' } as const
    expect(onSystemChange(off, false)).toBe(off)
  })

  it('returns to the last core variants when turned back on from a Studio theme', () => {
    const studio = pickStudio({ ...base, automatic: true, lastDark: 'amoled' }, 'spotify')
    expect(studio).toMatchObject({ automatic: false, theme: 'spotify' })
    expect(setAutomatic(studio, true, true).theme).toBe('amoled')
  })
})

describe('picking', () => {
  it('a mode card turns Automatic off and shows that family\'s last variant', () => {
    const s = { ...base, automatic: true, lastLight: 'light-dim' } as const
    expect(pickMode(s, 'light')).toMatchObject({ automatic: false, theme: 'light-dim' })
    expect(pickMode(s, 'dark')).toMatchObject({ automatic: false, theme: 'default' })
  })

  it('a variant is remembered for its family and applied', () => {
    expect(pickVariant(base, 'midnight', true)).toMatchObject({ theme: 'midnight', lastDark: 'midnight' })
    expect(pickVariant(base, 'light-dim', false)).toMatchObject({ theme: 'light-dim', lastLight: 'light-dim' })
  })

  it('a variant for the family Automatic is not showing is remembered, not applied', () => {
    // The UI only offers the active family's chips, but the rule holds anyway:
    // Automatic decides which family is on screen.
    const on = setAutomatic(base, true, true)
    expect(pickVariant(on, 'light-dim', true)).toMatchObject({ theme: 'default', lastLight: 'light-dim', automatic: true })
  })

  it('a Studio theme or Custom turns Automatic off (owner: Studio themes are dark only)', () => {
    for (const id of ['stripe', 'discord', 'custom'] as const)
      expect(pickStudio({ ...base, automatic: true }, id)).toMatchObject({ automatic: false, theme: id })
  })
})

describe('seedVariants', () => {
  it('seeds a saved core theme into its family, so an existing Midnight user keeps Midnight under Automatic', () => {
    expect(seedVariants({ theme: 'midnight' })).toEqual({ lastLight: 'light', lastDark: 'midnight' })
    expect(seedVariants({ theme: 'light-dim' })).toEqual({ lastLight: 'light-dim', lastDark: 'default' })
  })

  it('keeps saved variants, and ignores anything that is not a variant', () => {
    expect(seedVariants({ theme: 'spotify', lastLight: 'light-dim', lastDark: 'amoled' }))
      .toEqual({ lastLight: 'light-dim', lastDark: 'amoled' })
    expect(seedVariants({ theme: 'default', lastLight: 'bogus' as never, lastDark: 'spotify' as never }))
      .toEqual({ lastLight: 'light', lastDark: 'default' })
  })
})
