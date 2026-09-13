import { describe, it, expect } from 'vitest'
import { migrateSavedAppearance, APPEARANCE_VERSION, LEGACY_DEFAULT_ACCENT } from '../appearanceMigration'

const UI = ['Archivo', 'Inter', 'Roboto', 'System']
const MONO = ['Consolas', 'Fira Code', 'JetBrains Mono']

describe('migrateSavedAppearance', () => {
  it('moves a pre-version blurple to auto, so an existing user gets Sky', () => {
    // Saved before the marker existed: blurple was the default, not a choice.
    expect(migrateSavedAppearance({ accent: '#5865f2', density: 'compact' }, UI, MONO).accent).toBe('auto')
    expect(migrateSavedAppearance({ accent: '#5865F2' }, UI, MONO).accent).toBe('auto')
  })

  it('leaves a deliberate blurple alone once the marker says it was chosen', () => {
    expect(migrateSavedAppearance({ accent: LEGACY_DEFAULT_ACCENT, v: APPEARANCE_VERSION }, UI, MONO).accent)
      .toBe(LEGACY_DEFAULT_ACCENT)
  })

  it('never touches an accent that was not the old default', () => {
    expect(migrateSavedAppearance({ accent: '#f0b232' }, UI, MONO).accent).toBe('#f0b232')
  })

  it('keeps every other saved setting', () => {
    const out = migrateSavedAppearance({ accent: '#5865f2', density: 'compact', zoom: 110 }, UI, MONO)
    expect(out.density).toBe('compact')
    expect(out.zoom).toBe(110)
  })

  it('drops a font that no longer exists, and keeps one that does', () => {
    expect(migrateSavedAppearance({ fontUi: 'gg sans' }, UI, MONO)).not.toHaveProperty('fontUi')
    expect(migrateSavedAppearance({ fontUi: 'Inter' }, UI, MONO).fontUi).toBe('Inter')
    expect(migrateSavedAppearance({ fontMono: 'Gone Mono' }, UI, MONO)).not.toHaveProperty('fontMono')
  })

  it('does not leak the version marker into the settings object', () => {
    expect(migrateSavedAppearance({ v: 2 }, UI, MONO)).not.toHaveProperty('v')
  })
})
