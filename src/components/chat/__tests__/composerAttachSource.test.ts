import { describe, it, expect } from 'vitest'
import input from '../MessageInput.vue?raw'
import trayVue from '../AttachmentTray.vue?raw'
import chatApp from '@/views/ChatApp.vue?raw'
import socket from '@/composables/useSocket.ts?raw'
import messages from '@/composables/useMessages.ts?raw'

/**
 * Attaching in the composer and sending with files. The tray's states are
 * attachmentTray.test.ts; what is left is wiring in components that cannot
 * be mounted here (vitest runs in node), so it is read from the source.
 */
const templateOf = (src: string): string => /<template>([\s\S]*)<\/template>/.exec(src)?.[1] ?? ''
const scriptOf = (src: string): string => /<script setup[^>]*>([\s\S]*?)<\/script>/.exec(src)?.[1] ?? ''
const styleOf = (src: string): string =>
  [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')

/** A top-level function's source: from its declaration to the first `}` in column 0. */
const fnBody = (src: string, decl: string): string => {
  const at = src.indexOf(decl)
  if (at < 0) return ''
  const end = src.indexOf('\n}\n', at)
  return src.slice(at, end < 0 ? undefined : end + 2)
}

/** Every argument list passed to `call` (e.g. "sendDMRest(") in `src`, parens balanced. */
const callArgs = (src: string, call: string): string[] => {
  const out: string[] = []
  let from = 0
  for (;;) {
    const at = src.indexOf(call, from)
    if (at < 0) return out
    let depth = 1, i = at + call.length
    while (i < src.length && depth > 0) { if (src[i] === '(') depth++; else if (src[i] === ')') depth--; i++ }
    out.push(src.slice(at + call.length, i - 1))
    from = i
  }
}

/** The CSS inside the phone media block(s). */
const phoneCss = (css: string): string =>
  [...css.matchAll(/@media \(max-width: 768px\)\s*\{([\s\S]*?)\n\}/g)].map(m => m[1]).join('\n')

describe('the composer attaches', () => {
  const t = templateOf(input)
  const s = scriptOf(input)

  it('the paperclip opens a hidden multiple file input, and is disabled without permission', () => {
    expect(t).toMatch(/<input[^>]*type="file"[^>]*multiple/)
    expect(t).toMatch(/<input[^>]*type="file"[^>]*hidden/)
    expect(t).toMatch(/class="input-attach[^"]*"[^>]*:disabled="!canAttach"/)
    expect(t).toMatch(/class="input-attach[^"]*"[^>]*@click[^>]*pickFiles/)
  })

  it('pasting files adds them to the tray instead of the text', () => {
    const paste = fnBody(s, 'const onPaste = ')
    expect(paste).toMatch(/cb\.files/)
    expect(paste.indexOf('addFiles(')).toBeGreaterThan(-1)
    expect(paste.indexOf('addFiles(')).toBeLessThan(paste.indexOf("getData('text/plain')"))
  })

  it('shows the tray inside the composer box, above the text', () => {
    const wrapper = t.indexOf('class="input-wrapper"')
    const trayAt = t.indexOf('<AttachmentTray')
    const textarea = t.indexOf('<textarea')
    expect(trayAt).toBeGreaterThan(wrapper)
    expect(trayAt).toBeLessThan(textarea)
  })

  it('Send is ready with text or files, and never while a file is still going up', () => {
    expect(s).toMatch(/const canSend = computed\(/)
    expect(t).toMatch(/class="send-btn"[\s\S]*?:class="\{ ready: canSend \}"/)
    expect(t).toMatch(/:disabled="!canSend"/)
    expect(fnBody(s, 'const submit = ')).toMatch(/trayBlocked\.value/)
  })
})

describe('sending with files', () => {
  const send = fnBody(chatApp, 'const doSend = async () => {')

  it('found doSend', () => expect(send.length).toBeGreaterThan(500))

  it('every send branch passes the attachment keys', () => {
    for (const call of ['sendDMSocket(', 'sendReplySocket(', 'sendGroupSocket(', 'sendDMRest(', 'sendGroupRest(', 'sendChannelRest(']) {
      const calls = callArgs(send, call)
      expect(calls.length, call).toBeGreaterThan(0)
      for (const args of calls) expect(args, call).toMatch(/\bkeys\b/)
    }
  })

  it('allows an empty text when the tray has files ready', () => {
    expect(send).not.toMatch(/if \(!text \|\| sendingMsg\.value\) return/)
    expect(send).toMatch(/tray\.ready\(/)
  })

  it('takes the tray before sending and gives it back when the send fails', () => {
    expect(send).toMatch(/tray\.take\(/)
    expect((send.match(/tray\.restore\(/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })

  it('the socket sends carry attachments', () => {
    for (const fn of ['sendDMSocket', 'sendReplySocket', 'sendGroupSocket']) {
      const def = socket.slice(socket.indexOf(`const ${fn}`), socket.indexOf('\n\n', socket.indexOf(`const ${fn}`)))
      expect(def, fn).toMatch(/attachments/)
    }
  })

  it('the optimistic copy shows the files at once', () => {
    expect(fnBody(messages, 'const sendDM = (')).toMatch(/attachments/)
    expect(messages).toMatch(/const sendGroup = \([\s\S]*?attachments/)
  })

  it('dropping files names where they go', () => {
    expect(templateOf(chatApp)).toMatch(/Drop to send to/)
  })
})

describe('the tray', () => {
  const css = styleOf(trayVue)

  it('uses only tokens, no hex colours', () => expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i))

  it('the × and retry reach 44px on a phone', () => {
    const phone = phoneCss(css)
    expect(phone).toMatch(/\.x[^{]*\{[^}]*(min-width|width):\s*44px/)
    expect(phone).toMatch(/\.retry[^{]*\{[^}]*(min-height|height):\s*44px/)
  })

  it('says why a file cannot go, in the danger text colour', () => {
    expect(templateOf(trayVue)).toMatch(/item\.error/)
    expect(css).toMatch(/var\(--danger-text\)/)
  })
})
