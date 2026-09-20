/**
 * Text made storable: every unpaired UTF-16 surrogate becomes U+FFFD.
 *
 * JSON.parse accepts an unpaired surrogate — the escape "\uD83D" with no
 * partner — so a raw API call can send one. MongoDB cannot keep one: BSON
 * strings are UTF-8, which has no encoding for half a pair, so the driver
 * writes U+FFFD in its place. A response or broadcast built from the value
 * still in memory then says something different from the database, and
 * everyone who received it sees text a reload would change.
 *
 * So user-chosen text goes through this where it comes in, before it is stored
 * or sent anywhere. What gets stored is unchanged — it is the same replacement
 * the driver makes — but every copy now matches it.
 *
 * Wrap the final value, after any trim or slice: a slice can cut a pair in
 * half, which makes an unpaired surrogate out of perfectly good input.
 *
 * One code unit in, one out, so a length limit reads the result exactly as it
 * read the input.
 */
export const wellFormed = (text: string): string => (text as WellFormable).toWellFormed()

/**
 * `String.prototype.toWellFormed` is in every Node this runs on (22+, per
 * `engines` and the Dockerfile), but the server compiles against lib ES2020,
 * which predates it.
 */
type WellFormable = string & { toWellFormed(): string }
