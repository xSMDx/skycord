/**
 * useAvatar — single source of truth for default profile pictures.
 *
 * Generates the app's logo on a deterministic colored background instead of
 * DiceBear's robot-head placeholders. Same username always gets the same
 * color, drawn from a fixed brand-adjacent palette rather than random RGB
 * (random hues regularly land on muddy or low-contrast results).
 *
 * Returns a data: URI string, so every existing `<img :src="...">` call site
 * keeps working unchanged — this is a drop-in replacement for any function
 * that used to return a DiceBear URL.
 */

const AVATAR_PALETTE = [
  '#0057ff', '#eb459e', '#29d17c', '#f0a500', '#ff5c5c',
  '#9b59b6', '#1abc9c', '#e67e22', '#3498db', '#e74c3c',
]

const hashOf = (s: string): number => {
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash)
  return Math.abs(hash)
}

export const colorForUsername = (username: string): string =>
  AVATAR_PALETTE[hashOf(username) % AVATAR_PALETTE.length]

// The app's logo mark — same headphone-bracket-with-eyes shape as SkycordIcon's
// static SVG mode, inlined here since data-URI generation needs raw path data,
// not a mounted Vue component.
const LOGO_PATH = 'M24,64a24,24,0,0,1,48,0H184a24,24,0,0,1,48,0v80a64,64,0,0,1-64,64H88a64,64,0,0,1-64-64Z'

export const defaultAvatar = (username: string): string => {
  const name = username || '?'
  const color = colorForUsername(name)
  /*
   * The mark blinks. An <img> pointing at an SVG data URI still runs the
   * stylesheet inside it — scripts and external references are blocked, but
   * declarative animation is not — so this costs one element and no runtime.
   *
   * Two details keep it from being annoying. The eyes are shut for about 3% of
   * the cycle, which is roughly how long a real blink lasts, so it reads as a
   * living thing rather than a flashing icon. And the delay is derived from the
   * username, so a member list does not blink in unison like a row of machines.
   *
   * transform-box: fill-box is required — without it a circle scales about the
   * SVG's origin and slides off instead of closing.
   */
  const delay = -(hashOf(name) % 5200) / 1000
  const blink =
    `<style>.eye{transform-box:fill-box;transform-origin:center;` +
    `animation:blink 5.2s ease-in-out ${delay}s infinite}` +
    `@keyframes blink{0%,92%,100%{transform:scaleY(1)}94.5%,96.5%{transform:scaleY(.08)}}` +
    `@media(prefers-reduced-motion:reduce){.eye{animation:none}}</style>`
  // The logo's own coordinates nearly fill the full 256x256 canvas edge to
  // edge — fine for a square icon, but the avatar gets a circular crop
  // (border-radius: 50%) applied on top of it, which clips straight into
  // the "ears" of the bracket shape since they sit right at the corners.
  // Scaling to 70% and re-centering via this group transform leaves real
  // margin on every side so the artwork sits safely inside the circle.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 256 256">${blink}<rect width="256" height="256" fill="${color}"/><g transform="translate(38.4,38.4) scale(0.7)"><path d="${LOGO_PATH}" fill="none" stroke="white" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/><circle class="eye" cx="92" cy="140" r="15" fill="white"/><circle class="eye" cx="164" cy="140" r="15" fill="white"/></g></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

// Convenience: pick stored avatar if present, otherwise generate the default
export const avatarFor = (username: string, stored?: string | null): string =>
  stored || defaultAvatar(username)