/**
 * Words the way search reads them.
 *
 * Split where MongoDB's text index splits — its tokenizer breaks on the Unicode
 * White_Space, Dash, Hyphen, Pattern_Syntax, Quotation_Mark and
 * Terminal_Punctuation characters (JavaScript has no Hyphen property; Dash
 * covers all but the three listed by code) — then folded as it folds: lower
 * case, accents and other diacritics dropped. So "#110" is the word "110",
 * "arta_" keeps its underscore, and "Café" is "cafe".
 *
 * Stored on each message as `words`, so a search can require every word whole.
 * `$text` cannot: it ORs bare words, and a quoted phrase is matched as a
 * substring, which made "seed 10" find "#110".
 *
 * Pure, so the model hook, the backfill and the search all read the same
 * words. The client keeps a copy for highlighting (src/composables/searchWords.ts),
 * pinned to this one by a parity test.
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
