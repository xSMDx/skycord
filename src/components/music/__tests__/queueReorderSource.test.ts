import { describe, it, expect } from 'vitest'
import modal from '../MusicModal.vue?raw'
import drag from '@/composables/queueDrag.ts?raw'
import player from '@/composables/useMusicPlayer.ts?raw'

/**
 * Moving a song up or down your own queue, from the drawer.
 *
 * What a move does to the queue is musicQueue's moveManual, and where a
 * dragged row lands, how far the others step aside and how fast the list
 * scrolls near an edge are queueDrag's — both unit-tested. What is left is
 * how the modal wires them to a handle, in a component that cannot be
 * mounted here (vitest runs in node), so it is read from the source, as the
 * other *Source tests do.
 */
const templateOf = (src: string): string => /<template>([\s\S]*)<\/template>/.exec(src)?.[1] ?? ''
const scriptOf = (src: string): string => /<script setup[^>]*>([\s\S]*?)<\/script>/.exec(src)?.[1] ?? ''
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

/** From the element whose opening tag holds `marker` to the close of that element's first `</tag>`. */
const elementWith = (tpl: string, tag: string, marker: string): string => {
  const at = tpl.indexOf(marker)
  expect(at, `"${marker}" is in the template`).toBeGreaterThan(-1)
  const open = tpl.lastIndexOf(`<${tag}`, at)
  const close = tpl.indexOf(`</${tag}>`, at)
  return tpl.slice(open, close + `</${tag}>`.length)
}

/** What follows an opening tag, past whitespace and comments. */
const firstChildOf = (element: string): string =>
  element.slice(openingTag(element).length).replace(/^(\s|<!--[\s\S]*?-->)*/, '')

/** The declarations of every rule whose selector list includes exactly `selector`, in `css`. */
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

const tpl = templateOf(modal)
const css = styleOf(modal)
const mine = elementWith(tpl, 'li', 'v-for="(t, i) in queueView.manual"')
const grip = openingTag(firstChildOf(mine))

describe('the handle on a song you queued', () => {
  it('is the first control in the row', () => {
    expect(grip.startsWith('<button'), 'the row opens with a button').toBe(true)
    expect(grip).toMatch(/class="mm-qgrip"/)
    expect(grip).toMatch(/type="button"/)
    // Named for what it does, with the song it does it to.
    expect(grip).toMatch(/:aria-label="`Move \$\{t\.title\}`"/)
    expect(mine).toContain('<GripVertical')
    expect(/import \{([^}]*)\} from 'lucide-vue-next'/.exec(modal)?.[1]).toMatch(/\bGripVertical\b/)
  })

  it('is only on your own songs: the song playing and the rest of the playlist have none', () => {
    const nowPlaying = elementWith(tpl, 'div', 'class="mm-qrow now"')
    const theirs = elementWith(tpl, 'li', 'v-for="row in queueView.context"')
    expect(nowPlaying).not.toContain('mm-qgrip')
    expect(theirs).not.toContain('mm-qgrip')
  })

  it('uses pointer capture, and keeps the list from scrolling under the finger', () => {
    expect(grip).toMatch(/@pointerdown="onGripDown\(\$event, i\)"/)
    expect(grip).toMatch(/@pointermove="onGripMove"/)
    expect(grip).toMatch(/@pointerup="onGripUp"/)
    expect(grip).toMatch(/@pointercancel="onGripCancel"/)
    expect(grip).toMatch(/@lostpointercapture="onGripCancel"/)
    expect(drag).toMatch(/\.setPointerCapture\(e\.pointerId\)/)
    expect(rulesOf(css, '.mm-qgrip').join(';')).toMatch(/touch-action:\s*none/)
  })

  it('calls moveInQueue on ArrowUp and ArrowDown', () => {
    expect(grip).toMatch(/@keydown="onGripKey\(\$event, i\)"/)
    expect(grip).toMatch(/aria-keyshortcuts="ArrowUp ArrowDown"/)
    // The modal hands the drag the player's move, and the key handler moves
    // by what keyTarget makes of the key.
    expect(scriptOf(modal)).toMatch(/import \{[^}]*\bmoveInQueue\b[^}]*\} from '@\/composables\/useMusicPlayer'/)
    expect(scriptOf(modal)).toMatch(/useQueueDrag\(\{[\s\S]*?move: moveInQueue[\s\S]*?\}\)/)
    expect(drag).toMatch(/keyTarget\(e\.key, index, /)
    expect(drag).toMatch(/o\.move\(index, to\)/)
  })

  it('is at least 44px to a finger', () => {
    const rules = rulesOf(mediaBlocks(css, '(pointer: coarse)'), '.mm-qgrip')
    const w = Math.max(0, ...rules.map(r => Math.max(px(r, 'width'), px(r, 'min-width'))))
    const h = Math.max(0, ...rules.map(r => Math.max(px(r, 'height'), px(r, 'min-height'))))
    expect(w).toBeGreaterThanOrEqual(44)
    expect(h).toBeGreaterThanOrEqual(44)
  })
})

describe('the rows while a song is held', () => {
  it('lift the held row, and keep their places by song rather than by index', () => {
    expect(openingTag(mine)).toMatch(/:key="qKeys\[i\]"/)
    expect(openingTag(mine)).toMatch(/held: qHeld\?\.index === i/)
    expect(rulesOf(css, '.mm-qrow.lifted').join(';')).toMatch(/box-shadow:\s*var\(--shadow-md\)/)
  })

  it('scroll the list near its edges while dragging', () => {
    expect(drag).toMatch(/requestAnimationFrame\(tick\)/)
    expect(drag).toMatch(/autoScrollSpeed\(/)
  })

  it('slide aside without animation under reduced motion', () => {
    const reduced = mediaBlocks(css, '(prefers-reduced-motion: reduce)')
    expect(rulesOf(reduced, '.mm-qlist.sorting .mm-qrow').join(';')).toMatch(/transition:\s*none/)
  })

  it('give a held song back on Escape, before the modal hears it', () => {
    expect(drag).toMatch(/addEventListener\('keydown', onEscape, true\)/)
    expect(drag).toMatch(/e\.key === 'Escape'/)
    expect(drag).toMatch(/e\.stopPropagation\(\)/)
  })

  it('say where the song went, politely', () => {
    const queue = elementWith(tpl, 'section', 'class="mm-queue"')
    expect(queue).toMatch(/<p class="mm-sr" role="status" aria-live="polite">\{\{ qSaid \}\}<\/p>/)
  })
})

describe('the player', () => {
  it('moves through the queue reducer and remembers the new order', () => {
    const body = /export const moveInQueue = \(from: number, to: number\): void => \{[\s\S]*?\n\}/.exec(player)?.[0] ?? ''
    expect(body, 'moveInQueue is exported').not.toBe('')
    expect(body).toMatch(/Q\.moveManual\(queue, from, to\)[\s\S]*apply\([\s\S]*changed\(\)/)
  })
})
