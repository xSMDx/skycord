import { describe, it, expect } from 'vitest'
import screen from '../phone/PhoneCallScreen.vue?raw'
import stage from '../phone/PhoneStage.vue?raw'

/**
 * The phone call screen's frame and its stage.
 *
 * Who fills the screen is decided by pickFocus and tested in phoneCallRules,
 * and the fading by useAutoHide in phoneCall. What is left is markup inside
 * components that cannot be mounted here (vitest runs in node), so it is read
 * from the source, as chatAppBackgroundSocket.test.ts does.
 */
const styleOf = (src: string): string =>
  [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')

/**
 * The element whose opening tag holds the text at `at`, from that tag to its
 * matching close. Counts only tags of the same name, so the element must not
 * contain a self-closing tag of its own name.
 */
const elementAt = (src: string, at: number): string => {
  const open = src.lastIndexOf('<', at)
  const tag = /^<([\w-]+)/.exec(src.slice(open))?.[1]
  expect(tag, `position ${at} sits in an opening tag`).toBeTruthy()
  const re = new RegExp(`<${tag}(?=[\\s>])|</${tag}>`, 'g')
  re.lastIndex = open
  let depth = 0
  for (let m = re.exec(src); m; m = re.exec(src)) {
    depth += m[0].startsWith('</') ? -1 : 1
    if (depth === 0) return src.slice(open, m.index + m[0].length)
  }
  throw new Error(`<${tag}> at ${open} is never closed`)
}

/** The first element whose opening tag holds `marker`. */
const elementWith = (src: string, marker: string): string => {
  const at = src.indexOf(marker)
  expect(at, `"${marker}" is in the source`).toBeGreaterThan(-1)
  return elementAt(src, at)
}

/** Every element whose opening tag holds `marker`. */
const elementsWith = (src: string, marker: string): string[] => {
  const found: string[] = []
  for (let at = src.indexOf(marker); at > -1; at = src.indexOf(marker, at + 1)) found.push(elementAt(src, at))
  expect(found.length, `"${marker}" is in the source`).toBeGreaterThan(0)
  return found
}

/** The opening tag alone: from `<` to the `>` that ends it. */
const openingTag = (element: string): string => {
  let quote = ''
  for (let i = 0; i < element.length; i++) {
    const c = element[i]
    if (quote) { if (c === quote) quote = ''; continue }
    if (c === '"' || c === "'") quote = c
    else if (c === '>') return element.slice(0, i + 1)
  }
  return element
}

/** The source from `start` up to the first `end` after it. */
const between = (src: string, start: string, end: string): string => {
  const from = src.indexOf(start)
  expect(from, `"${start}" is in the source`).toBeGreaterThan(-1)
  const to = src.indexOf(end, from + start.length)
  expect(to, `"${end}" follows it`).toBeGreaterThan(from)
  return src.slice(from, to)
}

/** What fades when the controls hide. */
const FADES = "'is-hidden': hidden"

describe('the phone call screen', () => {
  it('is a modal dialog named after the call', () => {
    expect(screen).toContain('role="dialog"')
    expect(screen).toContain('aria-modal="true"')
    expect(screen).toContain(':aria-label="name"')
  })

  it('minimises on Escape, which is what Android Back sends a dialog', () => {
    expect(screen).toMatch(/key === 'Escape'[\s\S]{0,120}emit\('minimize'\)/)
  })

  it('has a chevron that minimises, named for a screen reader', () => {
    const chevron = elementWith(screen, 'aria-label="Minimise call"')
    expect(chevron).toContain("emit('minimize')")
    expect(chevron).toContain('<ChevronDown')
  })

  it('sits below the connection strip and clears the status bar', () => {
    expect(styleOf(screen)).toContain('var(--conn-h')
    expect(styleOf(screen)).toContain('env(safe-area-inset-top)')
  })

  it('hides only while a video fills the screen and the sheet is down', () => {
    expect(screen).toMatch(/useAutoHide\(\{\s*enabled: \(\) => videoFillsScreen\.value && !props\.sheetExpanded/)
  })

  it('counts a video as filling the screen only when the stage draws it, never by the focus kind alone', () => {
    // A camera holder whose video stopped keeps kind 'camera' while a newcomer
    // waits out the hold, and is drawn as an avatar: the controls must stay up.
    expect(screen).toContain('const videoFillsScreen = computed(() => focusedVideo(shownVideos.value, focus.value) !== null)')
    const call = screen.slice(screen.indexOf('useAutoHide({'), screen.indexOf('})', screen.indexOf('useAutoHide({')))
    expect(call).not.toContain('.kind')
    // The stage draws the big slot by the same lookup, from the same videos.
    expect(stage).toContain('focusedVideo(props.videos, props.focus)')
    expect(screen).toMatch(/<PhoneStage[^>]*:videos="shownVideos"/)
  })

  it('hands the sheet whether the controls are hidden', () => {
    expect(screen).toMatch(/<slot :hidden="hidden" \/>/)
  })

  it('reveals the controls on any touch, and the revealing tap presses nothing', () => {
    expect(screen).toContain('@pointerdown.capture="onPointerDown"')
    expect(screen).toContain('@click.capture="onClickCapture"')
    // Whether they were hidden is read before the press is counted, since
    // counting it shows them.
    expect(screen).toMatch(/const onPointerDown = \(e: PointerEvent\) => \{\s*(\/\/[^\n]*\s*)*swallowClick = hidden\.value\s*pointers\.down\(e\.pointerId, e\.isPrimary\)\s*poke\(\)/)
    expect(screen).toMatch(/const onClickCapture = [\s\S]{0,160}stopPropagation\(\)[\s\S]{0,40}preventDefault\(\)/)
  })

  it('never fades the controls while a finger is down, and counts from the release', () => {
    // Capture phase on the root, so a child holding pointer capture is still heard.
    expect(screen).toContain('@pointerup.capture="onPointerUp"')
    expect(screen).toContain('@pointercancel.capture="onPointerUp"')
    expect(screen).toContain('@lostpointercapture.capture="onPointerUp"')
    expect(screen).toMatch(/const onPointerUp = \(e: PointerEvent\) => \{\s*if \(pointers\.up\(e\.pointerId\)\) poke\(\)/)
    const call = screen.slice(screen.indexOf('useAutoHide({'), screen.indexOf('})', screen.indexOf('useAutoHide({')))
    expect(call).toContain('!pointers.held.value')
  })

  it('re-picks the focus once a newcomer has waited, and stops waiting on unmount', () => {
    expect(screen).toMatch(/pending\.since \+ FOCUS_HOLD_MS/)
    expect(screen).toMatch(/onBeforeUnmount\([\s\S]{0,80}clearHold/)
  })

  it('offers Ring again under the big avatar', () => {
    const ring = elementWith(screen, 'Ring again')
    expect(ring).toContain('v-if="ringAgain"')
    expect(ring).toContain("emit('ringAgain')")
  })

  it('fades the top text, and draws the stage outside what fades', () => {
    expect(elementWith(screen, 'class="pcs-top"')).toContain(FADES)
    for (const faded of elementsWith(screen, FADES)) expect(faded).not.toContain('<PhoneStage')
    expect(screen).toContain('<PhoneStage')
  })
})

describe('the phone stage', () => {
  it('letterboxes a shared screen and fills with a camera', () => {
    expect(stage).toMatch(/<VideoTile\s[^>]*source === 'screen'[^>]*fit="contain"/)
    expect(stage).toMatch(/<VideoTile\s[^>]*fit="cover"/)
  })

  it('fades the small tiles, and keeps your own camera visible when the rest hides', () => {
    expect(elementWith(stage, 'class="ps-row"')).toContain(FADES)
    for (const faded of elementsWith(stage, FADES)) expect(faded).not.toContain('ps-self')
    expect(stage).toContain('class="ps-self"')
  })

  it('says when the person being rung has not answered', () => {
    expect(stage).toContain('Ringing…')
    expect(stage).toContain('No answer')
  })

  it('picks the small tiles by the call cap, as the desktop grid does', () => {
    expect(stage).toContain('visibleTiles(')
    expect(stage).toContain('perf.maxCallTiles')
  })

  it('draws its faces as pictures, never as play buttons inside an image', () => {
    // On the Light level an animated avatar would otherwise wait for a tap
    // behind a small play button: invalid inside role="img", and under 44px.
    expect(elementWith(stage, 'class="ps-av"')).toMatch(/<Avatar\s[^>]*\sstill\b/)
    expect(elementWith(stage, 'class="ps-tile-av"')).toMatch(/<Avatar\s[^>]*\sstill\b/)
  })

  it('keeps out from under the pulled-up sheet', () => {
    expect(stage).toMatch(/raisedSheet\?: number \| null/)
    // The small tiles are in the sheet's list by then, and the ring line goes with them.
    expect(elementWith(stage, 'class="ps-row"')).toContain("'is-hidden': hidden || raised")
    expect(elementWith(stage, 'class="ps-ringing"')).toContain("'is-hidden': hidden || raised")
    // The big avatar moves to the middle of what is left, measured from layout
    // positions a transform does not change; with no room left it fades.
    expect(stage).toMatch(/const bottom = m\.clientHeight - props\.raisedSheet/)
    expect(stage).toContain('el.offsetTop + h / 2')
    expect(stage).toMatch(/transform: `translateY\(\$\{lift\.value\}px\)`/)
    const solo = openingTag(elementWith(stage, 'class="ps-solo"'))
    expect(solo).toContain(":class=\"{ raised, 'no-room': raised && noRoom }\"")
    expect(solo).toContain(':style="soloStyle"')
    const css = styleOf(stage)
    expect(css).toMatch(/\.ps-solo\s*\{[^}]*transition: transform var\(--dur-3\) var\(--ease-out\)/)
    expect(css).toMatch(/\.ps-solo\.raised\s*\{[^}]*transition-duration: var\(--dur-4\)/)
    expect(css).toMatch(/\.ps-solo\.no-room\s*\{[^}]*opacity: 0/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*\.ps-solo, \.ps-solo\.raised \{ transition: none; \}/)
  })
})

describe('the screen and its stage, together', () => {
  it('hands the stage the pulled-up sheet, and nothing while it is down', () => {
    expect(screen).toMatch(/sheetOpenHeight\?: number \| null/)
    expect(screen).toContain('const raisedSheet = computed(() => (props.sheetExpanded && props.sheetOpenHeight ? props.sheetOpenHeight : null))')
    expect(screen).toMatch(/<PhoneStage[\s\S]*?:raised-sheet="raisedSheet"/)
  })

  it('draws a join going wrong in the danger role, as the desktop strip does', () => {
    expect(screen).toMatch(/subtitleFailing\?: boolean/)
    expect(elementWith(screen, 'class="pcs-sub"')).toContain(':class="{ failing: subtitleFailing }"')
    expect(styleOf(screen)).toMatch(/\.pcs-sub\.failing\s*\{\s*color: var\(--danger-text\);\s*\}/)
  })

  it('stops the name short of your camera only while it is in the corner', () => {
    expect(elementWith(screen, 'class="pcs-top"')).toContain("'beside-self': selfViewShown")
    const shown = between(screen, 'const selfViewShown = computed(() => {', '\n})')
    // Filling the screen (nobody else has video), it leaves the corner empty.
    expect(shown).toContain("!(f?.kind === 'camera' && f.id === props.selfId)")
  })
})

describe('both', () => {
  it('honour reduced motion', () => {
    expect(styleOf(screen)).toContain('@media (prefers-reduced-motion: reduce)')
    expect(styleOf(stage)).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('write no colour as a hex literal', () => {
    expect(screen).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(stage).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
