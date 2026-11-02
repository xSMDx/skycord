/**
 * The identity the music service joins a call's LiveKit room as.
 *
 * On its own, so a pure rule that only needs to recognise it (the
 * subscription policy) can do so without importing useMusic, which opens a
 * socket and wires audio focus at import. Matches music/src/publisher.ts.
 */
export const MUSIC_IDENTITY = 'svc:music'
