import { describe, it, expect } from 'vitest'
import sheet from '../phone/PhoneMusicSheet.vue?raw'
import flyout from '../MusicFlyout.vue?raw'

/**
 * The call's music channels as a phone sheet, and the desktop flyout that
 * shares its logic.
 *
 * What the two share (the listeners line, the create, queue and listen
 * handlers and their form state) is callMusic.ts and tested in
 * callMusic.test.ts. What is left is markup and CSS inside components that
 * cannot be mounted here (vitest runs in node), so it is read from the source,
 * as phoneSheetSource.test.ts does.
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

/** The opening tag that holds `marker`: for a self-closing tag such as an <input />. */
const tagWith = (src: string, marker: string): string => {
  const at = src.indexOf(marker)
  expect(at, `"${marker}" is in the source`).toBeGreaterThan(-1)
  return openingTag(src.slice(src.lastIndexOf('<', at)))
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

describe('the phone music sheet', () => {
  const tpl = templateOf(sheet)
  const css = styleOf(sheet)

  it('is a bottom sheet, not a flyout', () => {
    expect(sheet).toMatch(/import BottomSheet from '@\/components\/ui\/BottomSheet\.vue'/)
    expect(sheet).not.toContain('CallFlyout')
    const root = openingTag(elementWith(tpl, '<BottomSheet'))
    expect(root).toContain(':open="open"')
    expect(root).toContain('title="Music in this call"')
    expect(root).toMatch(/:height="0\.\d+"/)
    expect(root).toContain("@close=\"emit('close')\"")
  })

  it('takes open, and says when it wants to close and when it wants the library', () => {
    expect(sheet).toMatch(/defineProps<\{ open: boolean \}>\(\)/)
    expect(sheet).toMatch(/defineEmits<\{ close: \[\]; openLibrary: \[\] \}>\(\)/)
  })

  it('lets callMusic hold the form state and the create, queue and listen logic', () => {
    expect(sheet).toMatch(/from '@\/composables\/callMusic'/)
    expect(sheet).toContain('useCallMusic(')
    // Imported only by callMusic.ts: a second copy here is the duplication this avoids.
    expect(sheet).not.toMatch(/\b(createMusicChannel|queueMusic|listenToMusic|clearMusicError)\b/)
    expect(sheet).not.toMatch(/const (listeners|nameOf|submitNew|submitQueue|canAdd) =/)
  })

  it('acts on a channel: listen or stop, skip, add a track, close', () => {
    expect(openingTag(elementWith(tpl, '@click="toggleListen(c.id)"'))).toContain(':aria-pressed="music.listeningTo === c.id"')
    expect(tpl).toContain('@click="skipMusic(c.id)"')
    expect(tpl).toContain('@click="toggleQueue(c.id)"')
    expect(tpl).toContain('@click="closeMusicChannel(c.id)"')
    expect(openingTag(elementWith(tpl, '@submit.prevent="submitQueue(c.id)"'))).toContain('v-if="queueFor === c.id"')
    expect(tpl).toContain('@submit.prevent="submitNew"')
  })

  it('names who is listening on every row, with what is queued', () => {
    expect(tpl).toContain('listeners(c.listeners)')
    expect(tpl).toMatch(/c\.queued[\s\S]{0,60}queued/)
    expect(tpl).toContain('c.now?.cover')
  })

  it('wears the selection as a ring on the channel you are on', () => {
    expect(tpl).toMatch(/class="pms-ch" :class="\{ on: music\.listeningTo === c\.id \}"/)
    expect(ruleOf(css, '.pms-ch.on')).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--active-ring\)/)
  })

  it('shows the volume only on the channel you can hear, inside its card', () => {
    const vol = elementWith(tpl, 'v-if="music.listeningTo === c.id"')
    expect(vol).toContain('v-model.number="music.volume"')
    expect(vol).toContain('type="range"')
    expect(vol).toContain('Music volume')
    expect(elementWith(tpl, 'class="pms-ch"')).toContain(vol)
  })

  it('keeps a slider drag from dragging the sheet down with it', () => {
    // BottomSheet follows every vertical pointer move one for one; a thumb
    // that wanders a few px while setting the volume would carry it along.
    expect(tagWith(tpl, 'type="range"')).toContain('@pointermove.stop')
  })

  it('puts the cursor in a form as it opens, so it scrolls into view and the keyboard comes up', () => {
    expect(sheet).toContain('const vFocus = { mounted: (el: HTMLElement) => el.focus() }')
    expect(tagWith(tpl, 'v-model="queueUrl"')).toContain('v-focus')
    expect(tagWith(tpl, 'v-model="name"')).toContain('v-focus')
  })

  it('shows a refusal as an alert, and an empty call as an invitation', () => {
    expect(openingTag(elementWith(tpl, 'v-if="music.error"'))).toContain('role="alert"')
    expect(tpl).toContain('Nothing playing. Start a channel and anyone in the call can tune in.')
  })

  it('ends with the library row, which hands the opening to its host', () => {
    const last = elementAt(tpl, tpl.lastIndexOf('<button'))
    expect(last).toContain("emit('openLibrary')")
    expect(last).toContain('Your library')
    expect(sheet).not.toContain('Your music')
  })

  it('makes every target at least 44px', () => {
    for (const sel of ['.pms-tune', '.pms-act', '.pms-input', '.pms-go', '.pms-cancel', '.pms-link', '.pms-vol']) {
      expect(px(ruleOf(css, sel), 'min-height'), sel).toBeGreaterThanOrEqual(44)
    }
    expect(px(ruleOf(css, '.pms-act'), 'min-width')).toBeGreaterThanOrEqual(44)
    expect(px(ruleOf(css, '.pms-go'), 'min-width')).toBeGreaterThanOrEqual(44)
    expect(px(ruleOf(css, '.pms-cancel'), 'min-width')).toBeGreaterThanOrEqual(44)
  })

  it('lays the rows out at the full width of the sheet', () => {
    for (const sel of ['.pms-tune', '.pms-link']) expect(ruleOf(css, sel), sel).toMatch(/width:\s*100%/)
    expect(ruleOf(css, '.pms-acts')).toMatch(/display:\s*flex/)
  })

  it('writes no colour as a hex literal', () => {
    expect(sheet).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('draws on existing tokens only, and sets radii from the scale', () => {
    expect(css).toMatch(/var\(--hover\)/)
    expect(css).not.toMatch(/border-radius:\s*\d+px/)
  })

  it('keeps its own motion still under reduced motion', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(reduced).toMatch(/transition:\s*none/)
  })

  it('says what the desktop flyout says for the same actions', () => {
    // The phone adds no second vocabulary: every name a screen reader hears,
    // placeholder and empty line is the flyout's own.
    for (const copy of [
      '`Stop listening to ${c.name}`',
      '`Listen to ${c.name}`',
      '`Skip the track in ${c.name}`',
      '`Add a track to ${c.name}`',
      '`Close ${c.name} for everyone`',
      '`Link to add to ${c.name}`',
      "'A linked track'",
      "'Nothing playing'",
      "'Listening'",
      "'Join'",
      'New music channel',
      'Link to an audio file',
      'Music volume',
      'https://…/next.mp3',
      'https://…/track.mp3',
      'placeholder="Chill"',
      'maxlength="32"',
    ]) {
      expect(flyout, `flyout: ${copy}`).toContain(copy)
      expect(sheet, `sheet: ${copy}`).toContain(copy)
    }
  })
})

describe('the desktop flyout', () => {
  const tpl = templateOf(flyout)

  it('still sits in a CallFlyout, with the same rows and the same library line', () => {
    expect(tpl).toMatch(/<CallFlyout :dir="dir" @close="emit\('close'\)">/)
    expect(flyout).toMatch(/defineEmits<\{ close: \[\]; openLibrary: \[\] \}>\(\)/)
    expect(tpl).toContain('Music in this call')
    expect(tpl).toContain('Your music')
    expect(tpl).toContain("emit('openLibrary'); emit('close')")
    for (const cls of ['mf-list', 'mf-row', 'mf-tune', 'mf-acts', 'mf-icon', 'mf-inline', 'mf-new', 'mf-add', 'mf-lib', 'mf-vol']) {
      expect(tpl, cls).toContain(cls)
    }
  })

  it('takes its listeners line, form state and handlers from callMusic, not a second copy', () => {
    expect(flyout).toMatch(/from '@\/composables\/callMusic'/)
    expect(flyout).toContain('useCallMusic(')
    expect(flyout).not.toMatch(/const (listeners|nameOf|submitNew|submitQueue|canAdd|toggle) =/)
    expect(flyout).not.toMatch(/\b(createMusicChannel|queueMusic|listenToMusic)\b/)
  })
})
