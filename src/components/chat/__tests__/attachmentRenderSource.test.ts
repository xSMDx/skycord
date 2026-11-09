import { describe, it, expect } from 'vitest'
import item from '../MessageItem.vue?raw'
import list from '../AttachmentList.vue?raw'
import viewer from '../MediaViewer.vue?raw'
import gif from '../GifImage.vue?raw'

/**
 * How a message shows its files and GIFs. The layout and labels are pure and
 * tested in src/utils/__tests__/attachments.test.ts; these components cannot
 * be mounted here (vitest runs in node), so their wiring is read from source.
 */
const templateOf = (src: string): string => /<template>([\s\S]*)<\/template>/.exec(src)?.[1] ?? ''
const scriptOf = (src: string): string => /<script setup[^>]*>([\s\S]*?)<\/script>/.exec(src)?.[1] ?? ''
const styleOf = (src: string): string =>
  [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')

describe('a message with files and GIFs', () => {
  const t = templateOf(item)

  it('shows its files under the text, and no empty paragraph when there is no text', () => {
    expect(t).toMatch(/<AttachmentList[^>]*v-if="msg\.attachments\?\.length"/)
    expect(t).toMatch(/<p v-else-if="displayContent"/)
    expect(t.indexOf('<AttachmentList')).toBeGreaterThan(t.indexOf('<p v-else-if="displayContent"'))
  })

  it('plays a GIF-only message as a GIF, and previews KLIPY GIFs inside longer text', () => {
    expect(t).toMatch(/<GifImage[^>]*v-if="isGifOnly\(msg\.content\)"/)
    expect(scriptOf(item)).toMatch(/klipyGifLinks\(/)
    expect(t).toMatch(/v-for="u in gifLinks"/)
  })
})

describe('AttachmentList', () => {
  const t = templateOf(list)
  const s = scriptOf(list)
  const css = styleOf(list)

  it('lays media out with the mosaic and counts the rest', () => {
    expect(s).toMatch(/mosaicLayout\(/)
    expect(t).toMatch(/:class="\['mosaic', layout\.template\]"/)
    expect(t).toMatch(/\+\{\{ layout\.extra \}\}/)
  })

  it('reserves a single image\'s box from its own width and height', () => {
    expect(s).toMatch(/aspectRatio/)
    expect(s).toMatch(/\.width/)
    expect(s).toMatch(/\.height/)
  })

  it('plays video in place, in a letterboxed 16:9 box, never on its own', () => {
    expect(t).toMatch(/<video[^>]*preload="metadata"/)
    expect(t).toMatch(/<video[^>]*controls/)
    expect(t).toMatch(/<video[^>]*playsinline/)
    expect(t).not.toMatch(/<video[^>]*autoplay/)
    expect(css).toMatch(/aspect-ratio:\s*16\s*\/\s*9/)
    expect(css).toMatch(/object-fit:\s*contain/)
  })

  it('keeps a file\'s extension outside the truncating stem, and downloads at 44px', () => {
    expect(t).toMatch(/class="stem"/)
    expect(t).toMatch(/class="ext"/)
    expect(t).toMatch(/:download="a\.name"/)
    expect(css).toMatch(/\.dl[^{]*\{[^}]*width:\s*44px/)
  })

  it('keeps a broken image\'s box and says which file it was', () => {
    expect(t).toMatch(/@error=/)
    expect(t).toMatch(/ImageOff/)
  })

  it('opens the large view at the tile that was clicked', () => {
    expect(t).toMatch(/<MediaViewer/)
    expect(t).toMatch(/@click="open\(i\)"/)
  })
})

describe('MediaViewer', () => {
  const t = templateOf(viewer)
  const s = scriptOf(viewer)

  it('sits above everything, outside the message list', () => expect(t).toMatch(/<Teleport to="body">/))

  it('closes on Escape, a backdrop click and a swipe down, and moves with the arrow keys', () => {
    expect(s).toMatch(/'Escape'/)
    expect(s).toMatch(/'ArrowLeft'/)
    expect(s).toMatch(/'ArrowRight'/)
    expect(t).toMatch(/@click\.self="close"/)
    expect(s).toMatch(/> 80/)
  })

  it('takes focus in and gives it back', () => {
    expect(s).toMatch(/document\.activeElement/)
    expect(s).toMatch(/\.focus\(\)/)
  })

  it('offers Open original only in a browser, never in the apps', () => {
    expect(s).toMatch(/appBridge\(\)/)
    expect(t).toMatch(/v-if="!inApp"[^>]*>|<a[^>]*v-if="!inApp"/)
  })

  it('counts where you are when there is more than one', () => expect(t).toMatch(/\{\{ index \+ 1 \}\} of \{\{ items\.length \}\}/))
})

describe('GifImage', () => {
  const s = scriptOf(gif)
  it('follows the motion settings: still with reduced motion or tap-to-play, playing on hover or tap', () => {
    expect(s).toMatch(/motionAllowed/)
    expect(s).toMatch(/tapOnly/)
    expect(s).toMatch(/freezeFrame\(/)
    expect(templateOf(gif)).toMatch(/@mouseenter/)
    expect(templateOf(gif)).toMatch(/GIF/)
  })
})

describe('tokens only', () => {
  it('no hex colours in the new components', () => {
    for (const src of [list, viewer, gif]) expect(styleOf(src)).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })
})
