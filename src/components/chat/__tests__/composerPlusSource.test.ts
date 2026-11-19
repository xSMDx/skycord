import { describe, it, expect } from 'vitest'
import input from '../MessageInput.vue?raw'
import chatApp from '@/views/ChatApp.vue?raw'

/**
 * The "+" at the left of the message box: a menu of what can go into a
 * message, where the paperclip used to be. What the menu lists is
 * composerMenu.test.ts; this is how the composer opens it and what each row
 * reaches, read from source because vitest runs in node.
 */
const templateOf = (src: string): string => /<template>([\s\S]*)<\/template>/.exec(src)?.[1] ?? ''
const scriptOf = (src: string): string => /<script setup[^>]*>([\s\S]*?)<\/script>/.exec(src)?.[1] ?? ''
const styleOf = (src: string): string =>
  [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
const phoneCss = (css: string): string =>
  [...css.matchAll(/@media \(max-width: 768px\)\s*\{([\s\S]*?)\n\}/g)].map(m => m[1]).join('\n')

describe('the + button', () => {
  const t = templateOf(input)
  const s = scriptOf(input)

  it('replaces the paperclip', () => {
    expect(t).not.toMatch(/<Paperclip/)
    expect(t).toMatch(/<button class="input-attach[^"]*"[^>]*aria-haspopup="menu"/)
    expect(t).toMatch(/<Plus /)
  })

  it('opens the shared menu above itself, from a click or the keyboard', () => {
    expect(t).toMatch(/class="input-attach[^"]*"[^>]*@click\.stop="openPlusMenu"/)
    expect(s).toMatch(/openMenu\(/)
    // Anchored to the button's own box, not the pointer: Enter and Space give
    // no pointer position, and the menu flips up from the button's top edge.
    expect(s).toMatch(/getBoundingClientRect\(\)/)
    expect(s).toMatch(/buildComposerMenu\(/)
  })

  it('is never disabled itself: GIF, Sticker and time do not need the permission', () => {
    expect(t).not.toMatch(/class="input-attach[^"]*"[^>]*:disabled/)
  })

  it('keeps the same file picker, paste and drop', () => {
    expect(t).toMatch(/<input[^>]*type="file"[^>]*multiple/)
    expect(s).toMatch(/const pickFiles = /)
    expect(s).toMatch(/uploadFile:\s*pickFiles/)
    expect(s).toMatch(/cb\.files/)
  })

  it('opens the time picker at the caret, with no @time to replace', () => {
    expect(s).toMatch(/insertTime:/)
    expect(s).toMatch(/mentionStart = [^;\n]*selectionStart/)
  })

  it('stays a 44px target on a phone', () => {
    expect(phoneCss(styleOf(input))).toMatch(/\.input-attach,[\s\S]*?width: 44px; height: 44px/)
  })
})

describe('the rows reach the real pickers', () => {
  it('GIF and Sticker are emitted, and ChatApp opens the picker on that tab', () => {
    const s = scriptOf(input)
    expect(s).toMatch(/openGif:\s*\(\) => emit\('openGif'\)/)
    expect(s).toMatch(/openStickers:\s*\(\) => emit\('openStickers'\)/)
    expect(chatApp).toMatch(/const openStickersForInput = [^\n]*emojiPickerTab\.value = 'stickers'/)
    expect(templateOf(chatApp)).toMatch(/@openStickers="openStickersForInput"/)
  })
})
