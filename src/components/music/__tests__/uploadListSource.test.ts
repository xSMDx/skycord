import { describe, it, expect } from 'vitest'
import modal from '../MusicModal.vue?raw'
import list from '../UploadList.vue?raw'
import library from '@/composables/useMusicLibrary.ts?raw'

/**
 * Several songs going up, in the music player.
 *
 * Which file goes next, how long a 429 waits and what a dropped file does
 * are uploadScheduler's and are unit-tested there; the XHR and the session
 * are musicUploads.test.ts. What is left is how the modal and the list wire
 * them up, in components that cannot be mounted here (vitest runs in node),
 * so they are read from the source, as the other *Source tests do.
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
const tagWith = (tpl: string, tag: string, marker: string): string => {
  const at = tpl.indexOf(marker)
  expect(at, `"${marker}" is in the template`).toBeGreaterThan(-1)
  return openingTag(tpl.slice(tpl.lastIndexOf(`<${tag}`, at)))
}

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

const mTpl = templateOf(modal)
const mScript = scriptOf(modal)
const lTpl = templateOf(list)
const lScript = scriptOf(list)
const lCss = styleOf(list)

describe('choosing and dropping songs', () => {
  it('the picker takes several files, and hands every one of them to the queue', () => {
    const input = tagWith(mTpl, 'input', 'ref="fileInput"')
    expect(input).toMatch(/\smultiple[\s>]/)
    expect(input).toMatch(/:accept="AUDIO_ACCEPT"/)
    const onFile = /const onFile = \([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(mScript)?.[1] ?? ''
    expect(onFile).toMatch(/\[\.\.\.\(input\.files \?\? \[\]\)\]/)
    expect(onFile).toMatch(/enqueueUploads\(/)
    // Cleared, so choosing the same files again still fires a change.
    expect(onFile).toMatch(/input\.value = ''/)
  })

  it('dragging several files onto the player works, wherever in it they land', () => {
    const shell = tagWith(mTpl, 'div', 'class="mm"')
    expect(shell).toMatch(/@dragenter="onDragEnter"/)
    expect(shell).toMatch(/@dragover="onDragOver"/)
    expect(shell).toMatch(/@dragleave="onDragLeave"/)
    expect(shell).toMatch(/@drop="onDrop"/)
    expect(mScript).toMatch(/useFileDrop\(enqueueUploads\)/)
    // The library pane says it will take them.
    expect(tagWith(mTpl, 'section', 'ref="mainEl"')).toMatch(/dropping/)
  })

  it('a file let go of beside the player, on the backdrop, does not open in place of the app', () => {
    // Claimed at the window while the player is open, and let go when it closes.
    expect(mScript).toMatch(/import \{[^}]*\bguardWindowDrops\b[^}]*\} from '@\/composables\/fileDrop'/)
    const mounted = /onMounted\(async \(\) => \{([\s\S]*?)\n\}\)/.exec(mScript)?.[1] ?? ''
    expect(mounted).toMatch(/unguardDrops = guardWindowDrops\(\)/)
    const unmounts = [...mScript.matchAll(/onBeforeUnmount\(\(\) => \{([\s\S]*?)\}\)\n/g)].map(m => m[1])
    expect(unmounts.some(u => /unguardDrops\?\.\(\)/.test(u))).toBe(true)
  })
})

describe('where the upload list sits', () => {
  it('replaces the single progress bar, between the link form and the error line', () => {
    expect(modal).not.toMatch(/library\.uploading/)
    expect(modal).not.toMatch(/mm-progress/)
    const link = mTpl.indexOf('class="mm-link"')
    const at = mTpl.indexOf('<UploadList')
    const err = mTpl.indexOf('class="mm-err"')
    expect(link).toBeGreaterThan(-1)
    expect(at).toBeGreaterThan(link)
    expect(err).toBeGreaterThan(at)
    expect(mScript).toMatch(/import UploadList from '\.\/UploadList\.vue'/)
  })

  it('a link import is never held up by the files: Add waits only for its own import', () => {
    const add = tagWith(mTpl, 'button', 'class="mm-go" :disabled="!linkUrl.trim() || library.importing"')
    expect(add).toMatch(/type="submit"/)
    expect(add).toMatch(/:aria-busy="library\.importing"/)
  })

  it('lives in useMusicLibrary, so it carries on with the modal closed', () => {
    expect(library).toMatch(/export const uploads = reactive<UploadItem\[\]>\(\[\]\)/)
    expect(library).toMatch(/export const enqueueUploads = \(files: File\[\]\): void =>/)
    expect(library).toMatch(/export const dropUpload = \(id: string\): void =>/)
    expect(lScript).toMatch(/import \{[^}]*\buploads\b[^}]*\} from '@\/composables\/useMusicLibrary'/)
  })
})

describe('a row', () => {
  it('names the file, cut short with an ellipsis rather than wrapping', () => {
    expect(tagWith(lTpl, 'span', 'class="ul-name"')).toMatch(/:title="u\.name"/)
    const name = rulesOf(lCss, '.ul-name').join(';')
    expect(name).toMatch(/overflow:\s*hidden/)
    expect(name).toMatch(/text-overflow:\s*ellipsis/)
    expect(name).toMatch(/white-space:\s*nowrap/)
  })

  it('says each state in words, and says the limit in exactly these', () => {
    expect(lTpl).toContain('Waiting for the upload limit…')
    expect(lScript).toContain("'Checking and converting…'")
    expect(lScript).toMatch(/'Uploading… \$\{u\.pct\}%'|`Uploading… \$\{u\.pct\}%`/)
    // While limited it counts down to the retry, in the app's own clock format.
    expect(lScript).toMatch(/clock\(/)
    expect(lScript).toMatch(/retryAt/)
  })

  it('a failure says why, as plain text — the live region is what says it aloud', () => {
    const err = tagWith(lTpl, 'p', 'class="ul-err"')
    expect(err).toMatch(/v-(else-)?if="u\.state === 'failed'"/)
    // An alert per row would interrupt for every one of twenty failures.
    expect(err).not.toMatch(/role=/)
    expect(err).not.toMatch(/aria-live/)
    expect(lTpl).toMatch(/\{\{ u\.error \}\}/)
  })

  it('has a slim bar that grows by transform, not by width', () => {
    const bar = tagWith(lTpl, 'div', 'class="ul-bar"')
    expect(bar).toMatch(/role="progressbar"/)
    expect(bar).toMatch(/:aria-valuenow="u\.pct"/)
    expect(lTpl).toMatch(/scaleX\(\$\{u\.pct \/ 100\}\)/)
    expect(px(rulesOf(lCss, '.ul-bar').join(';'), 'height')).toBeLessThanOrEqual(3)
  })

  it('can drop a waiting file, stop one going up, or dismiss a failed one — not one the server already has', () => {
    const x = tagWith(lTpl, 'button', 'class="ul-x"')
    expect(x).toMatch(/v-if="canDrop\(u\)"/)
    expect(x).toMatch(/@click="dropUpload\(u\.id\)"/)
    expect(x).toMatch(/:aria-label="dropLabel\(u\)"/)
    expect(x).toMatch(/type="button"/)
    const canDrop = /const canDrop = \(u: UploadItem\): boolean =>([^\n]*)/.exec(lScript)?.[1] ?? ''
    expect(canDrop).toMatch(/'converting'/)
    expect(canDrop).toMatch(/'done'/)
  })

  it('is at least 44px to a finger', () => {
    const coarse = mediaBlocks(lCss, '(pointer: coarse)')
    const rules = rulesOf(coarse, '.ul-x')
    expect(Math.max(0, ...rules.map(r => Math.max(px(r, 'width'), px(r, 'min-width'))))).toBeGreaterThanOrEqual(44)
    expect(Math.max(0, ...rules.map(r => Math.max(px(r, 'height'), px(r, 'min-height'))))).toBeGreaterThanOrEqual(44)
  })

  it('draws its icons from lucide', () => {
    expect(lTpl).not.toMatch(/<svg/)
    expect(/import \{([^}]*)\} from 'lucide-vue-next'/.exec(lScript)?.[1]).toMatch(/\bX\b/)
  })
})

describe('the list', () => {
  it('says how far the batch has got, quietly, only when there is a batch', () => {
    const sum = tagWith(lTpl, 'p', 'class="ul-sum"')
    expect(sum).toMatch(/v-if="uploadBatch\.total > 1"/)
    // Said aloud by the one live region, not by a second one of its own.
    expect(sum).not.toMatch(/role=/)
    expect(lScript).toMatch(/`\$\{uploadBatch\.done\} of \$\{uploadBatch\.total\} uploaded`/)
  })

  it('has one live region, always there, so what it says is heard', () => {
    // A region that appears with its text is not announced by most readers:
    // it has to be in the page, empty, before the words arrive.
    const live = [...lTpl.matchAll(/aria-live="polite"/g)]
    expect(live).toHaveLength(1)
    const region = tagWith(lTpl, 'p', 'aria-live="polite"')
    expect(region).not.toMatch(/v-if|v-show|v-else/)
    expect(region).toMatch(/class="ul-sr"/)
    // Outside the section that comes and goes with the rows.
    expect(lTpl.indexOf('aria-live="polite"')).toBeLessThan(lTpl.indexOf('<section'))
    // One keyed node a line, so each new line is an addition a reader says.
    expect(region).toBe('<p class="ul-sr" aria-live="polite">')
    expect(lTpl).toMatch(/<span v-for="l in said" :key="l\.id">\{\{ l\.text \+ ' ' \}\}<\/span>/)
    expect(lScript).toMatch(/announcement\(/)
    // A line hard on the last joins it rather than replacing it unread.
    expect(lScript).toMatch(/said\.value = followOn\(said\.value, \{ id: \+\+lineSeq, text: line \}, at, saidAt\)/)
    const sr = rulesOf(lCss, '.ul-sr').join(';')
    expect(sr).toMatch(/position:\s*absolute/)
    expect(sr).toMatch(/clip-path:\s*inset\(50%\)/)
    expect(px(sr, 'width')).toBe(1)
  })

  it('a lost connection says so once, with a Retry, and keeps the ✕ on the file', () => {
    const line = tagWith(lTpl, 'div', 'class="ul-held"')
    expect(line).toMatch(/v-if="uploadBatch\.held"/)
    expect(lScript).toMatch(/HELD_SAYS/)
    const retry = tagWith(lTpl, 'button', 'class="ul-retry"')
    expect(retry).toMatch(/type="button"/)
    expect(retry).toMatch(/@click="retryUploads\(\)"/)
    expect(lTpl).toMatch(/>\s*Retry\s*</)
    expect(lScript).toMatch(/import \{[^}]*\bretryUploads\b[^}]*\} from '@\/composables\/useMusicLibrary'/)
    // A waiting file can always be dropped, the one held at the head included.
    const canDrop = /const canDrop = \(u: UploadItem\): boolean =>([^\n]*)/.exec(lScript)?.[1] ?? ''
    expect(canDrop).not.toMatch(/'waiting'/)
  })

  it('Retry is at least 44px to a finger', () => {
    const rules = rulesOf(mediaBlocks(lCss, '(pointer: coarse)'), '.ul-retry')
    expect(Math.max(0, ...rules.map(r => Math.max(px(r, 'width'), px(r, 'min-width'))))).toBeGreaterThanOrEqual(44)
    expect(Math.max(0, ...rules.map(r => Math.max(px(r, 'height'), px(r, 'min-height'))))).toBeGreaterThanOrEqual(44)
  })

  it('keeps its height in the library pane, however long the library under it', () => {
    // The pane is a flex column; overflow: hidden zeroes the automatic minimum,
    // and the live check found the list squeezed to 0px under 20 tracks.
    const box = rulesOf(lCss, '.ul').join(';')
    expect(box).toMatch(/overflow:\s*hidden/)
    expect(box).toMatch(/flex-shrink:\s*0/)
  })

  it('stops its clock when nothing is waiting for the limit, and when it goes', () => {
    expect(lScript).toMatch(/setInterval\(/)
    expect(lScript).toMatch(/clearInterval\(/)
    expect(lScript).toMatch(/onBeforeUnmount\(/)
  })

  it('lets finished rows go with a fade, and the rest close up without a jump', () => {
    expect(lTpl).toMatch(/<TransitionGroup[^>]*name="ul-row"/)
    expect(rulesOf(lCss, '.ul-row-leave-to').join(';')).toMatch(/opacity:\s*0/)
    expect(rulesOf(lCss, '.ul-row-move').join(';')).toMatch(/transition:\s*transform var\(--dur-3\) var\(--ease-out\)/)
  })

  it('holds still under reduced motion, but keeps its spinner turning', () => {
    const reduced = mediaBlocks(lCss, '(prefers-reduced-motion: reduce)')
    expect(rulesOf(reduced, '.ul-row-move').join(';')).toMatch(/transition:\s*none/)
    expect(rulesOf(reduced, '.ul-bar > span').join(';')).toMatch(/transition:\s*none/)
    // The global carve-out keeps a .spin spinning: it encodes progress.
    expect(lTpl).toMatch(/class="[^"]*\bspin\b/)
  })
})
