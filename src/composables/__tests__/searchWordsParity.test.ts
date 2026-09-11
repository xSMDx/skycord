import { describe, it, expect } from 'vitest'
import { searchWords as clientWords, WORD_RE as CLIENT_WORD_RE } from '../searchWords'
import { searchWords as serverWords, WORD_RE as SERVER_WORD_RE } from '../../../server/utils/searchWords'

/**
 * The server decides which messages match; the client decides which words in
 * them are marked. If the two ever split or fold words differently, results
 * show up with the wrong words highlighted, or none at all.
 */
const SAMPLES = [
  'history seed #110',
  "Café e-mail don't",
  'arta_ hi',
  'مَرحبا بالعالم',
  'Ünïcödé ΛΟΓΟΣ İstanbul',
  '!!! ... --',
  'soft­hyphen 30・fps ･x',
]

describe('search words parity', () => {
  it('splits and folds words exactly as the server stores them', () => {
    expect(CLIENT_WORD_RE.source).toBe(SERVER_WORD_RE.source)
    for (const s of SAMPLES) expect(clientWords(s)).toEqual(serverWords(s))
  })
})
