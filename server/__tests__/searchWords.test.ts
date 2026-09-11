import { describe, it, expect } from 'vitest'
import { searchWords } from '../utils/searchWords'

describe('searchWords', () => {
  it('splits on spaces and punctuation, keeping a number whole', () => {
    expect(searchWords('history seed #110')).toEqual(['history', 'seed', '110'])
  })
  it('folds case and accents', () => {
    expect(searchWords('Café MEETING')).toEqual(['cafe', 'meeting'])
  })
  it('splits on dashes and apostrophes, as the text index does', () => {
    expect(searchWords("e-mail don't")).toEqual(['e', 'mail', 'don', 't'])
  })
  it('keeps an underscore inside a word, as the text index does', () => {
    expect(searchWords('arta_ hi')).toEqual(['arta_', 'hi'])
  })
  it('lists each word once, in the order it first appears', () => {
    expect(searchWords('plan Plan PLAN later plan')).toEqual(['plan', 'later'])
  })
  it('reads any script, dropping its marks the way accents are dropped', () => {
    expect(searchWords('مَرحبا بالعالم')).toEqual(['مرحبا', 'بالعالم'])
  })
  it('finds nothing in punctuation alone', () => {
    expect(searchWords('!!! ... --')).toEqual([])
  })
})
