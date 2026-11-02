import { describe, it, expect } from 'vitest'
import source from '../MusicModal.vue?raw'

/**
 * The queue drawer sits inside the library pane, which scrolls. While the
 * drawer is open the pane must not scroll: a wheel or swipe that ran past the
 * end of the queue carried on into the library, scrolled it, and took the
 * drawer up with it — the person saw the library where the rest of their queue
 * should have been. Read from the source: the modal cannot mount here
 * (vitest runs in node), the same reason chatAppBackgroundSocket.test.ts reads
 * ChatApp.
 */
const style = source.slice(source.indexOf('<style'))
const rule = (selector: string): string => {
  const at = style.indexOf(`\n${selector} {`)
  expect(at, `${selector} has a rule`).toBeGreaterThan(-1)
  return style.slice(at, style.indexOf('}', at))
}

describe('the queue drawer keeps the library still', () => {
  it('marks the library pane while the queue is open', () => {
    expect(source).toMatch(/<section ref="mainEl" class="mm-main" :class="\{ 'queue-open': showQueue[ ,]/)
  })

  it('stops the pane scrolling while it is marked', () => {
    expect(rule('.mm-main.queue-open')).toContain('overflow: hidden')
  })

  it('keeps a scroll that reaches the end of the queue inside it, at every width', () => {
    expect(rule('.mm-queue')).toContain('overscroll-behavior: contain')
  })
})
