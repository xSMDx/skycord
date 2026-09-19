export type StatusShape = 'filled' | 'crescent' | 'bar' | 'ring'

/**
 * The shape a status is drawn as, so that presence is never carried by colour
 * alone (WCAG 1.4.1). The four are Discord's, because the muscle memory is
 * already there: online is a filled disc, idle a crescent, do-not-disturb a
 * bar, offline a hollow ring.
 *
 * Invisible is drawn as offline — that is what everyone else sees, and the
 * one surface that shows your own choice (the status picker) writes the word
 * next to it.
 */
export const statusShape = (s: string | null | undefined): StatusShape =>
  s === 'online' ? 'filled' : s === 'idle' ? 'crescent' : s === 'dnd' ? 'bar' : 'ring'

// Mask ids have to be unique per dot, even though every mask of a given shape
// is identical and four shared ids would be smaller. Duplicates are legal
// enough to look like they work — a browser resolves url(#id) to the first
// element carrying it — but "first" is whichever dot mounted first, and when
// that member goes offline and their crescent unmounts, every other crescent
// on the page is left pointing at an id that is no longer in the document. A
// member list re-sorting itself is exactly when that would happen, and exactly
// when nobody is looking for it.
//
// Module scope, not component scope: <script setup> runs per instance, so a
// counter declared there would be 0 every time. Vue 3.4 has no useId().
let seq = 0
export const nextMaskId = (): string => `sd-${++seq}`
