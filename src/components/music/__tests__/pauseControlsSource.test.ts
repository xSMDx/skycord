import { describe, it, expect } from 'vitest'
import mini from '../MiniPlayer.vue?raw'
import rail from '../MusicCallRail.vue?raw'
import modal from '../MusicModal.vue?raw'
import flyout from '../../voice/MusicFlyout.vue?raw'
import sheet from '../../voice/phone/PhoneMusicSheet.vue?raw'
import callSheet from '../../voice/phone/PhoneCallSheet.vue?raw'
import callBar from '../../voice/CallBar.vue?raw'

/**
 * Pause and Resume, wherever a call's song can be skipped.
 *
 * What pausing does — the events, the frozen clock, whether a channel can
 * pause at all — is useMusic's and callMusic's, and tested in
 * musicClient.test.ts and callMusic.test.ts. What is left is where each
 * surface puts the control and how it shows a held song, in components that
 * cannot be mounted here (vitest runs in node), so it is read from the
 * source, as the other *Source tests do.
 */
const templateOf = (src: string): string => /<template>([\s\S]*)<\/template>/.exec(src)?.[1] ?? ''
const styleOf = (src: string): string =>
  [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')

/** The opening tag alone: from `<` to the `>` that ends it, quotes respected. */
const openingTag = (from: string): string => {
  let quote = ''
  for (let i = 0; i < from.length; i++) {
    const c = from[i]
    if (quote) { if (c === quote) quote = ''; continue }
    if (c === '"' || c === "'") quote = c
    else if (c === '>') return from.slice(0, i + 1)
  }
  return from
}

/** The <button> whose opening tag holds `marker`, from its `<` to its `</button>`. */
const buttonWith = (tpl: string, marker: string): string => {
  const at = tpl.indexOf(marker)
  expect(at, `"${marker}" is in the template`).toBeGreaterThan(-1)
  const open = tpl.lastIndexOf('<button', at)
  const close = tpl.indexOf('</button>', at)
  return tpl.slice(open, close + '</button>'.length)
}

/** What follows an element, past whitespace and comments. */
const after = (tpl: string, element: string): string =>
  tpl.slice(tpl.indexOf(element) + element.length).replace(/^(\s|<!--[\s\S]*?-->)*/, '')

/** The declarations of the rule whose selector list includes exactly `selector`, in `css`. */
const rulesOf = (css: string, selector: string): string[] =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(m => m[1].split(',').map(s => s.trim()).includes(selector))
    .map(m => m[2])

/** The bodies of every `@media <query>` block. */
const mediaBlocks = (css: string, query: string): string => {
  let out = ''
  for (let at = css.indexOf(`@media ${query}`); at > -1; at = css.indexOf(`@media ${query}`, at + 1)) {
    let depth = 0
    const start = css.indexOf('{', at)
    for (let i = start; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}' && --depth === 0) { out += css.slice(start + 1, i) + '\n'; break }
    }
  }
  return out
}

const px = (rule: string, property: string): number => {
  const m = new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*(\\d+)px`).exec(rule)
  return m ? Number(m[1]) : 0
}

/** The largest a selector is made, by width and by height, under `query`. */
const sizeUnder = (src: string, query: string, selector: string): { w: number; h: number } => {
  const rules = rulesOf(mediaBlocks(styleOf(src), query), selector)
  return {
    w: Math.max(0, ...rules.map(r => Math.max(px(r, 'width'), px(r, 'min-width')))),
    h: Math.max(0, ...rules.map(r => Math.max(px(r, 'height'), px(r, 'min-height')))),
  }
}

const importsLucidePauseAndPlay = (src: string) => {
  const lucide = /import \{([^}]*)\} from 'lucide-vue-next'/.exec(src)?.[1] ?? ''
  expect(lucide).toMatch(/\bPause\b/)
  expect(lucide).toMatch(/\bPlay\b/)
}

/**
 * One control that is Pause while the song plays and Resume while it is held:
 * named to match, drawn with Pause or Play, and hidden unless the channel can
 * pause. `who` is how the channel is written there (`c`, `live`).
 */
const isTheToggle = (button: string, who: string) => {
  const tag = openingTag(button)
  // Hidden without `pausable`: canPause is false for a view that has none.
  expect(tag, 'hidden without pausable').toMatch(new RegExp(`v-if="(canPause\\(${who}\\)|${who}\\.pausable)"`))
  // The accessible name says what a tap does now, and begins with the word.
  expect(tag).toMatch(new RegExp(`:aria-label="isPaused\\(${who}\\) \\? \`Resume [^\`]*\` : \`Pause [^\`]*\`"`))
  // Play in place of Pause while it is held.
  expect(button).toMatch(new RegExp(`isPaused\\(${who}\\) \\? Play : Pause`))
}

/** The skip control comes straight after it: the two are one group. */
const sitsBeforeSkip = (tpl: string, button: string) => {
  const next = openingTag(after(tpl, button))
  expect(next.startsWith('<button'), 'a button follows').toBe(true)
  expect(next).toMatch(/Skip/)
}

describe('the mini player', () => {
  const tpl = templateOf(mini)
  const css = styleOf(mini)
  const toggle = (): string => buttonWith(tpl, '@click="togglePauseMusic(live)"')

  it('offers Pause and Resume on the channel you hear, next to Skip, and only when it can pause', () => {
    importsLucidePauseAndPlay(mini)
    isTheToggle(toggle(), 'live')
    sitsBeforeSkip(tpl, toggle())
    expect(openingTag(toggle())).toContain("v-tip=\"isPaused(live) ? 'Resume — for everyone listening' : 'Pause — for everyone listening'\"")
  })

  it('says Paused where it says where the song is, and stops the live dot', () => {
    expect(tpl).toMatch(/isPaused\(live\) \? `Paused · \$\{live\.name\}` : live\.name/)
    expect(tpl).toContain('class="mp-pulse" :class="{ still: isPaused(live) }"')
    const still = rulesOf(css, '.mp-pulse.still').join(';')
    expect(still).toMatch(/animation:\s*none/)
    // Dimmed as well as stopped, so held reads apart from a live dot under reduced motion.
    expect(still).toMatch(/opacity:/)
  })

  it('says Paused for music nearby that is held, and prefers a channel that is playing', () => {
    expect(tpl).toMatch(/isPaused\(nearby\) \? 'Paused' : 'Playing'/)
    expect(mini).toMatch(/const nearby = computed\([\s\S]{0,400}isPaused\(/)
  })

  it('is at least 44px to a thumb', () => {
    const s = sizeUnder(mini, '(max-width: 768px)', '.mp-btn')
    expect(s.w).toBeGreaterThanOrEqual(44)
    expect(s.h).toBeGreaterThanOrEqual(44)
  })
})

describe('the call rail in the music room', () => {
  const tpl = templateOf(rail)
  const toggle = (): string => buttonWith(tpl, '@click="togglePauseMusic(c)"')

  it('offers Pause and Resume on each card, next to Skip, and only when it can pause', () => {
    importsLucidePauseAndPlay(rail)
    isTheToggle(toggle(), 'c')
    sitsBeforeSkip(tpl, toggle())
    expect(openingTag(toggle())).toContain('class="cr-icon"')
  })

  it('says Paused before the song on a held card', () => {
    expect(tpl).toMatch(/<template v-if="isPaused\(c\)">Paused · <\/template>/)
  })

  it('is at least 44px to a thumb', () => {
    for (const q of ['(max-width: 768px)', '(max-width: 680px)']) {
      const s = sizeUnder(rail, q, '.cr-icon')
      expect(s.w, q).toBeGreaterThanOrEqual(44)
      expect(s.h, q).toBeGreaterThanOrEqual(44)
    }
  })
})

describe('the music room, tuned into a channel', () => {
  const tpl = templateOf(modal)
  const css = styleOf(modal)
  const toggle = (): string => buttonWith(tpl, '@click="togglePauseMusic(live)"')

  it('puts Pause and Resume on the channel deck, next to Skip, only when the channel can pause', () => {
    importsLucidePauseAndPlay(modal)
    isTheToggle(toggle(), 'live')
    sitsBeforeSkip(tpl, toggle())
    // The round transport key, as your own player has: this one really is pause.
    expect(openingTag(toggle())).toContain('class="mm-pp"')
    // Like Skip, it stays in place with nothing to act on, rather than leaving a hole.
    expect(openingTag(toggle())).toContain(':disabled="!canPause(live)"')
  })

  it('says Paused under the title, and stops both live dots', () => {
    expect(tpl).toMatch(/isPaused\(live\) \? 'Paused · ' : ''/)
    expect(tpl).toContain('class="mm-banddot" :class="{ still: isPaused(live) }"')
    expect(tpl).toContain('class="mm-livedot" :class="{ still: isPaused(live) }"')
    for (const sel of ['.mm-banddot.still', '.mm-livedot.still']) {
      expect(rulesOf(css, sel).join(';'), sel).toMatch(/animation:\s*none/)
    }
  })

  it('no longer says a shared song cannot be paused', () => {
    expect(modal).not.toMatch(/shared song cannot be paused/i)
  })

  it('is at least 44px to a thumb', () => {
    const s = sizeUnder(modal, '(max-width: 768px)', '.mm-pp')
    expect(s.w).toBeGreaterThanOrEqual(44)
    expect(s.h).toBeGreaterThanOrEqual(44)
  })
})

describe('the desktop call flyout', () => {
  const tpl = templateOf(flyout)
  const toggle = (): string => buttonWith(tpl, '@click="togglePause(c.id)"')

  it('offers Pause and Resume on each row, next to Skip, through callMusic', () => {
    importsLucidePauseAndPlay(flyout)
    isTheToggle(toggle(), 'c')
    sitsBeforeSkip(tpl, toggle())
    expect(flyout).toMatch(/\{[^}]*\btogglePause\b[^}]*\} = useCallMusic\(/)
  })

  it('says Paused before the song on a held row', () => {
    expect(tpl).toMatch(/isPaused\(c\) \? 'Paused · ' : ''/)
  })
})

describe('the phone music sheet', () => {
  const tpl = templateOf(sheet)
  const css = styleOf(sheet)
  const toggle = (): string => buttonWith(tpl, '@click="togglePause(c.id)"')

  it('offers Pause and Resume on each card, next to Skip, through callMusic', () => {
    importsLucidePauseAndPlay(sheet)
    isTheToggle(toggle(), 'c')
    sitsBeforeSkip(tpl, toggle())
    expect(openingTag(toggle())).toContain('class="pms-act"')
    // Written out, as every verb on the sheet is.
    expect(toggle()).toContain("{{ isPaused(c) ? 'Resume' : 'Pause' }}")
  })

  it('says Paused before the song on a held card, as the flyout does', () => {
    expect(tpl).toMatch(/isPaused\(c\) \? 'Paused · ' : ''/)
    for (const copy of ['`Pause for everyone in ${c.name}`', '`Resume for everyone in ${c.name}`']) {
      expect(sheet, copy).toContain(copy)
      expect(flyout, copy).toContain(copy)
    }
  })

  it('keeps the row legible with four actions while Close is armed: the others keep their glyphs', () => {
    expect(rulesOf(css, '.pms-acts:has(.armed) .pms-act:not(.armed) span').join(';')).toMatch(/display:\s*none/)
  })
})

describe('the Music card on the phone call screen', () => {
  const tpl = templateOf(callSheet)

  it('holds the title still while paused and says Paused beside it', () => {
    expect(tpl).toMatch(/<MarqueeText class="pcsh-song" :text="musicLabel\.title" :active="expanded && !musicLabel\.paused" \/>/)
    expect(tpl).toMatch(/<span v-if="musicLabel\.paused" class="pcsh-paused">Paused<\/span>/)
    expect(rulesOf(styleOf(callSheet), '.pcsh-paused').join(';')).toMatch(/color:\s*var\(--text-3\)/)
  })
})

describe('the call bar music button', () => {
  it('stops its dot breathing for music that is held, and says so in its tip', () => {
    expect(callBar).toContain('class="cb-musicdot" :class="{ still: isPaused(musicNearby) }"')
    expect(rulesOf(styleOf(callBar), '.cb-musicdot.still').join(';')).toMatch(/animation:\s*none/)
    expect(callBar).toMatch(/is \$\{isPaused\(c\) \? 'paused' : 'playing'\} in \$\{c\.name\}/)
    // A playing channel before a held one.
    expect(callBar).toMatch(/find\(c => c\.now && !isPaused\(c\)\) \?\? music\.channels\.find\(c => c\.now\)/)
  })
})

describe('every surface', () => {
  it('writes no colour as a hex literal in what it adds', () => {
    for (const [name, src] of Object.entries({ mini, rail, flyout, sheet })) {
      expect(styleOf(src), name).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    }
  })
})
