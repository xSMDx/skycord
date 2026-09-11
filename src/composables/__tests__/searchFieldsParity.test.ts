import { describe, it, expect } from 'vitest'
import appearanceSource from '../useAppearance.ts?raw'
import { THEME_CODE_RE } from '../../../server/utils/searchFields'

/**
 * The server decides what counts as an embed, but the client decides what is
 * drawn as a card. If the theme-code pattern changes on one side only, `has:
 * embed` starts disagreeing with what people see. Read as source, not imported:
 * useAppearance touches storage and the document at import time.
 */
describe('has: embed parity', () => {
  it('uses the same theme-code pattern the client renders cards for', () => {
    expect(appearanceSource).toContain(`export const THEME_CODE_RE = ${THEME_CODE_RE.toString()}`)
  })
})
