/**
 * Words the way search reads them: split where MongoDB's text index splits,
 * case and accents folded.
 *
 * A copy of server/utils/searchWords.ts, which explains the rules, kept
 * identical to it by a parity test. The server decides which messages match;
 * this decides which words in them are marked, so the two must agree on what
 * a word is.
 */
export const WORD_RE = /[^\p{White_Space}\p{Dash}\p{Pattern_Syntax}\p{Quotation_Mark}\p{Terminal_Punctuation}\u{AD}\u{30FB}\u{FF65}]+/gu

export const foldWord = (w: string): string =>
  w.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').normalize('NFC')

/** Every word of `text`, folded, each once, in the order it first appears. */
export const searchWords = (text: string): string[] => {
  const out = new Set<string>()
  for (const m of text.matchAll(WORD_RE)) {
    const w = foldWord(m[0])
    if (w) out.add(w)
  }
  return [...out]
}
