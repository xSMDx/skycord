/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'
import sheet from '../phone/PhoneCallSheet.vue?raw'
import hold from '../phone/HoldToTalk.vue?raw'
import marquee from '../phone/MarqueeText.vue?raw'

/**
 * The phone call sheet, its Hold to talk bar, and the title that slides.
 *
 * The press-and-release rules live in holdToTalk.ts and the drag's maths in
 * sheetDrag.ts, both unit-tested. What is left is markup and wiring inside
 * components that cannot be mounted here (vitest runs in node), so it is read
 * from the source, as phoneScreenSource.test.ts does.
 */
const styleOf = (src: string): string =>
  [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')

const templateOf = (src: string): string => /<template>([\s\S]*)<\/template>/.exec(src)?.[1] ?? ''

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

/** A self-closing component tag, `<Name ... />`, found by its name. */
const componentTag = (src: string, name: string): string => {
  const at = src.indexOf(`<${name}`)
  expect(at, `<${name}> is in the source`).toBeGreaterThan(-1)
  return openingTag(src.slice(at))
}

/** The declarations of the rule whose selector is exactly `selector`. */
const ruleOf = (css: string, selector: string): string => {
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map(s => s.trim()).includes(selector)) return m[2]
  }
  throw new Error(`no rule for ${selector}`)
}

/** A length in px a declaration sets, e.g. px(rule, 'min-height'). */
const px = (rule: string, property: string): number => {
  const m = new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*(\\d+)px`).exec(rule)
  expect(m, `${property} is set in px`).toBeTruthy()
  return Number(m![1])
}

/** What fades when the controls hide. */
const FADES = "'is-hidden': hidden"

describe('the Hold to talk bar', () => {
  const tpl = templateOf(hold)

  it('hears every way a press can end', () => {
    expect(tpl).toContain('@pointerdown="onPointerDown"')
    expect(tpl).toContain('@pointerup="onPointerEnd"')
    expect(tpl).toContain('@pointercancel="onPointerEnd"')
    expect(tpl).toContain('@lostpointercapture="onPointerEnd"')
  })

  it('takes the pointer on the bar itself and never hands it back while the finger is down', () => {
    // Ruling R10: capture on the bar, children out of the hit test, so the
    // screen's lostpointercapture listener never hears a re-target as a release.
    expect(hold).toMatch(/currentTarget[\s\S]{0,40}\.setPointerCapture\(e\.pointerId\)/)
    expect(hold).not.toContain('releasePointerCapture')
    expect(ruleOf(styleOf(hold), '.htt > *')).toMatch(/pointer-events:\s*none/)
  })

  it('a second finger is not a second press', () => {
    expect(hold).toMatch(/const onPointerDown = [\s\S]{0,200}pointerId !== null[\s\S]{0,40}return/)
    expect(hold).toMatch(/const onPointerEnd = [\s\S]{0,80}e\.pointerId !== pointerId\) return/)
  })

  it('lets go when the page is hidden, when it is disabled, and when it goes away', () => {
    expect(hold).toContain("document.addEventListener('visibilitychange', onVisibility)")
    expect(hold).toMatch(/const onVisibility = [\s\S]{0,80}visibilityState === 'hidden'[\s\S]{0,20}releaseAll\(\)/)
    expect(hold).toMatch(/watch\(\(\) => props\.disabled, [\s\S]{0,40}releaseAll\(\)/)
    expect(hold).toMatch(/onBeforeUnmount\(\(\) => \{[\s\S]{0,160}removeEventListener\('visibilitychange', onVisibility\)[\s\S]{0,200}releaseAll\(\)/)
  })

  it('buzzes on a press where the phone can', () => {
    expect(hold).toContain('navigator.vibrate?.(10)')
  })

  it('presses and releases through the push-to-talk key\'s own code', () => {
    expect(hold).toMatch(/createHoldToTalk\(\{[\s\S]*press: pttPress,[\s\S]*release: pttRelease,/)
  })

  it('says "Talking…" only once the press has gone on air', () => {
    // `talking` turns true only when pttPress() resolves true (holdToTalk.test.ts).
    expect(tpl).toMatch(/talking \? 'Talking…' : 'Hold to talk'/)
    expect(tpl).toContain(":class=\"{ talking }\"")
    expect(ruleOf(styleOf(hold), '.htt.talking')).toMatch(/background:\s*var\(--accent\)/)
  })

  it('says why it cannot be used', () => {
    expect(tpl).toMatch(/disabled \? disabledLabel :/)
    expect(tpl).toContain(':disabled="disabled"')
  })

  it('is a wide target, at least 52px tall, that a moving finger cannot turn into a scroll', () => {
    const rule = ruleOf(styleOf(hold), '.htt')
    expect(px(rule, 'min-height')).toBeGreaterThanOrEqual(52)
    expect(rule).toMatch(/width:\s*100%/)
    expect(rule).toMatch(/touch-action:\s*none/)
  })
})

describe('the phone call sheet', () => {
  const tpl = templateOf(sheet)
  const css = styleOf(sheet)

  it('draws the speaker circle only when the app can move the sound', () => {
    const speakerCircle = elementWith(tpl, 'v-if="speaker.supported"')
    expect(speakerCircle).toContain('setSpeaker(')
    expect(speakerCircle).toContain('Volume2')
  })

  it('shows a headset as a disabled headphones circle', () => {
    const speakerCircle = elementWith(tpl, 'v-if="speaker.supported"')
    expect(openingTag(speakerCircle)).toContain(':disabled="speaker.headset"')
    expect(speakerCircle).toContain('Headphones')
    expect(sheet).toContain("'Using headset'")
  })

  it('locks the mic circle under push to talk and under a server mute', () => {
    expect(sheet).toContain("effectiveInputMode() === 'ptt'")
    expect(sheet).toContain("'This channel uses push to talk'")
    expect(sheet).toContain('voice.serverMuted')
    expect(sheet).toContain("'Muted by the server'")
    const mic = openingTag(elementWith(tpl, '@click="toggleMute"'))
    expect(mic).toContain(':disabled="micLocked"')
    expect(mic).toContain(':aria-label="micLabel"')
  })

  it('offers Hold to talk only under push to talk, outside everything that fades', () => {
    const bar = componentTag(tpl, 'HoldToTalk')
    expect(bar).toContain('v-if="pushToTalk"')
    expect(bar).not.toContain('inert')
    expect(bar).not.toContain('hidden')
    for (const faded of elementsWith(tpl, FADES)) expect(faded).not.toContain('<HoldToTalk')
  })

  it('makes everything that fades inert while hidden', () => {
    for (const faded of elementsWith(tpl, FADES)) {
      const tag = openingTag(faded)
      expect(tag.includes('inert') || tag.includes('aria-hidden="true"'), tag).toBe(true)
    }
    expect(css).toMatch(/\.is-hidden\s*\{[^}]*visibility:\s*hidden[^}]*pointer-events:\s*none/)
  })

  it('shows the Music card only when the server runs music', () => {
    expect(sheet).toContain('musicCardLabel(')
    const card = elementWith(tpl, 'v-if="musicLabel"')
    expect(card).toContain("emit('music')")
    expect(card).toContain('Not playing')
    expect(card).toContain('<MarqueeText')
  })

  it('offers Invite only when the call can take more people', () => {
    const invite = elementWith(tpl, 'v-if="canInvite"')
    expect(invite).toContain('Invite people')
    expect(invite).toContain("emit('invite')")
  })

  it('opens the music, the invite and the voice settings through its host', () => {
    expect(tpl).toContain("emit('voiceSettings')")
    expect(sheet).toMatch(/defineEmits<\{[\s\S]*camera: \[\][\s\S]*invite: \[\][\s\S]*voiceSettings: \[\][\s\S]*music: \[\][\s\S]*leave: \[\][\s\S]*expanded: \[on: boolean\][\s\S]*height: \[px: number\][\s\S]*\}>\(\)/)
  })

  it('keeps the camera off until the call is joined, and hangs up through its host', () => {
    expect(openingTag(elementWith(tpl, "emit('camera')"))).toContain(':disabled="!joined"')
    const end = elementWith(tpl, "emit('leave')")
    expect(end).toContain('PhoneOff')
    expect(ruleOf(css, '.pcsh-end')).toMatch(/background:\s*var\(--danger\)/)
    expect(ruleOf(css, '.pcsh-end')).toMatch(/color:\s*var\(--text-on-danger\)/)
  })

  it('lays the circles out as one centred row of same-size circles that never shrink', () => {
    const row = ruleOf(css, '.pcsh-row')
    expect(row).toMatch(/display:\s*flex/)
    expect(row).toMatch(/justify-content:\s*center/)
    const gap = px(row, 'gap')
    expect(gap).toBeGreaterThanOrEqual(12)
    expect(gap).toBeLessThanOrEqual(20)
    const circle = ruleOf(css, '.pcsh-c')
    expect(circle).toMatch(/flex:\s*none/)
    expect(px(circle, 'width')).toBe(px(circle, 'height'))
    expect(px(circle, 'width')).toBeGreaterThanOrEqual(52)
    expect(px(circle, 'width')).toBeLessThanOrEqual(60)
  })

  it('makes every other target at least 44px, and clears the home indicator', () => {
    const grab = ruleOf(css, '.pcsh-grab')
    expect(px(grab, 'height')).toBeGreaterThanOrEqual(44)
    expect(px(grab, 'width')).toBeGreaterThanOrEqual(44)
    expect(px(ruleOf(css, '.pcsh-link'), 'min-height')).toBeGreaterThanOrEqual(44)
    expect(px(ruleOf(css, '.pcsh-music'), 'min-height')).toBeGreaterThanOrEqual(44)
    expect(ruleOf(css, '.pcsh')).toContain('env(safe-area-inset-bottom)')
  })

  it('says what the swiped-up sheet holds', () => {
    expect(tpl).toMatch(/In this call · \{\{ participants\.length \}\}/)
    expect(tpl).toMatch(/\{\{ musicLabel\.n \}\} playing/)
  })

  it('decides a release from where the drag would coast to, not where it stopped', () => {
    expect(sheet).toMatch(/settlesOpen\(dragY\.value, velocityOf\(samples\), travel\.value\)/)
    expect(sheet).toMatch(/from '@\/composables\/sheetDrag'/)
  })

  it('reports whether it is pulled up, and its collapsed height, and stops measuring on unmount', () => {
    expect(sheet).toMatch(/watch\(expanded, on => emit\('expanded', on\)\)/)
    expect(sheet).toContain("emit('height', h)")
    expect(sheet).toContain('new ResizeObserver(measure)')
    expect(sheet).toMatch(/onBeforeUnmount\(\(\) => \{[\s\S]{0,200}ro\?\.disconnect\(\)/)
  })

  it('is a toggle for a screen reader too', () => {
    const grab = openingTag(elementWith(tpl, 'class="pcsh-grab"'))
    expect(grab).toContain(':aria-expanded="expanded"')
    expect(grab).toContain('@click="toggle"')
  })
})

describe('the sliding title', () => {
  const css = styleOf(marquee)

  it('ping-pongs only when the text does not fit', () => {
    expect(ruleOf(css, '.mq-text.is-moving')).toMatch(/animation:[^;]*\binfinite\b[^;]*\balternate\b/)
    expect(marquee).toContain(":class=\"{ 'is-moving': moving }\"")
    expect(marquee).toMatch(/const moving = computed\(\(\) => overflow\.value > 0/)
  })

  it('holds still with an ellipsis under reduced motion', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(reduced).toMatch(/animation:\s*none/)
    expect(reduced).toMatch(/text-overflow:\s*ellipsis/)
  })

  it('stops measuring on unmount', () => {
    expect(marquee).toContain('new ResizeObserver(measure)')
    expect(marquee).toMatch(/onBeforeUnmount\(\(\) => [\s\S]{0,40}ro\?\.disconnect\(\)/)
  })
})

describe('all three', () => {
  const all = [sheet, hold, marquee].join('\n')

  it('use the exact copy', () => {
    for (const copy of [
      'Swipe up: people, music, invite',
      'In this call · ',
      'Music',
      'Not playing',
      ' playing',
      'Invite people',
      'Voice settings',
      'Hold to talk',
      'Talking…',
      'This channel uses push to talk',
      'Muted by the server',
      'Using headset',
    ]) expect(all, copy).toContain(copy)
  })

  it('write no colour as a hex literal', () => {
    for (const src of [sheet, hold, marquee]) expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})

describe('the phone call screen as a whole', () => {
  it('has no screen-share control: a phone cannot capture its screen', () => {
    const dir = resolve(__dirname, '../phone')
    const files = readdirSync(dir).filter(f => f.endsWith('.vue') || f.endsWith('.ts'))
    expect(files).toEqual(expect.arrayContaining(['PhoneCallScreen.vue', 'PhoneCallSheet.vue', 'HoldToTalk.vue']))
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8')
      expect(src, f).not.toContain('MonitorUp')
      expect(src, f).not.toContain('toggleScreenShare')
    }
  })
})
