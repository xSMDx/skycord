/**
 * The physics of a dragged sheet, in one place: BottomSheet's drag-to-dismiss
 * and the phone call sheet's pull-up both read it.
 *
 * The sheet follows the finger one for one, resists past an edge, and on
 * release settles where the drag would have coasted to rather than where the
 * finger stopped — so a short flick goes all the way, and a long drag that
 * stalls springs back.
 *
 * The two-place helpers (`sheetOffset`, `settlesOpen`) are for a sheet with
 * two resting places: open (offset 0) and shut (offset `travel`, pushed down
 * by that many px).
 */

/** How quickly a coasting sheet slows: the deceleration rate iOS scroll views use. */
const DECELERATION = 0.998

/** How far a sheet let go at `velocity` (px/s) would travel before it stopped. */
export const project = (velocity: number): number =>
  (velocity / 1000) * DECELERATION / (1 - DECELERATION)

/** Resistance past an edge: real things slow before they stop. `over` px past it, against a sheet `dim` px tall. */
export const rubber = (over: number, dim: number, c = 0.55): number =>
  (over * dim * c) / (dim + c * Math.abs(over))

/**
 * Where the sheet is drawn for a finger that would put it at `y`: exactly
 * there between open and shut, and resisting past either end.
 */
export const sheetOffset = (y: number, travel: number): number => {
  // Before the sheet has been measured there is nothing to resist against;
  // a dimension of 1 keeps the curve finite rather than dividing by zero.
  const dim = travel > 0 ? travel : 1
  if (y < 0) return -rubber(-y, dim)
  if (y > travel) return travel + rubber(y - travel, dim)
  return y
}

/** The finger's speed in px/s, down positive, from its last few samples. */
export const velocityOf = (samples: readonly { y: number; t: number }[]): number => {
  if (samples.length < 2) return 0
  const first = samples[0]
  const last = samples[samples.length - 1]
  return ((last.y - first.y) / Math.max(1, last.t - first.t)) * 1000
}

/**
 * Whether a sheet let go at offset `y`, moving at `velocity` px/s, settles
 * open: decided by where it would coast to, against the halfway point.
 */
export const settlesOpen = (y: number, velocity: number, travel: number): boolean =>
  y + project(velocity) < travel / 2
