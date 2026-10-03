import { describe, it, expect } from 'vitest'
import { cleanTag } from '../src/ingest'

/**
 * Tag text is the one piece of an uploaded file that survives ingest intact
 * and gets rendered in a list. Everything else is re-encoded; this is copied.
 * So it is treated as what it is: a string an attacker chose.
 */
describe('cleanTag', () => {
  it('keeps ordinary text', () => {
    expect(cleanTag('Blue Monday')).toBe('Blue Monday')
  })

  it('keeps text that is not Latin', () => {
    expect(cleanTag('いきものがかり')).toBe('いきものがかり')
    expect(cleanTag('Пикник')).toBe('Пикник')
  })

  it('returns empty for a missing or non-string tag', () => {
    expect(cleanTag(undefined)).toBe('')
    expect(cleanTag(null)).toBe('')
    expect(cleanTag(42)).toBe('')
  })

  it('drops control characters', () => {
    expect(cleanTag('Blue\u0000Mon\u0007day')).toBe('BlueMonday')
    expect(cleanTag('a\u007fb')).toBe('ab')
  })

  it('drops bidi overrides, which let a name render as something else', () => {
    expect(cleanTag('track‮gpj.exe')).toBe('trackgpj.exe')
    expect(cleanTag('⁦a⁩b')).toBe('ab')
  })

  it('collapses the whitespace that would shove a table around', () => {
    expect(cleanTag('  lots   of\t\tspace \n here  ')).toBe('lots of space here')
  })

  it('turns newlines into single spaces rather than keeping a multi-line tag', () => {
    expect(cleanTag('line one\nline two')).toBe('line one line two')
  })

  it('clamps to the ceiling', () => {
    expect(cleanTag('x'.repeat(500))).toHaveLength(200)
    expect(cleanTag('x'.repeat(500), 10)).toHaveLength(10)
  })

  it('clamps by character, not by code unit, so it cannot split an emoji', () => {
    const out = cleanTag('🎵'.repeat(10), 4)
    expect([...out]).toHaveLength(4)
    expect(out).toBe('🎵🎵🎵🎵')
  })

  it('leaves markup alone — escaping belongs to the renderer, not here', () => {
    // Vue binds this as text. Stripping angle brackets here would quietly
    // corrupt a legitimate title and buy nothing.
    expect(cleanTag('<script>alert(1)</script>')).toBe('<script>alert(1)</script>')
  })
})
