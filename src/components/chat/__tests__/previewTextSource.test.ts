import { describe, it, expect } from 'vitest'
import chatApp from '@/views/ChatApp.vue?raw'
import item from '../MessageItem.vue?raw'
import tree from '@/components/modals/ReplyTreeModal.vue?raw'
import pins from '@/components/modals/PinnedMessagesModal.vue?raw'
import search from '@/components/search/SearchResultsPanel.vue?raw'

/**
 * Every place a message is shown as one line says what was sent — "Sent a
 * photo", "GIF", "notes.pdf" — and never a raw link or nothing at all. The
 * words come from previewText (src/utils/attachments.ts, tested there); this
 * checks each surface actually asks it.
 */
describe('one-line previews go through previewText', () => {
  it('the conversation list, as loaded and as messages arrive', () => {
    expect(chatApp).not.toMatch(/lastMsg = payload\.content/)
    expect(chatApp).not.toMatch(/lastMsg: payload\.content/)
    expect(chatApp).not.toMatch(/lastMsg:\s+d\.lastMessage \|\| ''/)
    expect(chatApp).toMatch(/previewText\(\{ content: d\.lastMessage, summary: d\.lastAttachments \}\)/)
    expect((chatApp.match(/lastMsg = previewText\(|lastMsg: previewText\(/g) ?? []).length).toBeGreaterThanOrEqual(5)
  })

  it('notifications', () => {
    expect(chatApp).not.toMatch(/content: payload\.content \?\? ''/)
    expect((chatApp.match(/content: previewText\(payload\)/g) ?? []).length).toBe(3)
  })

  it('the delete confirmation', () => {
    expect(chatApp).toMatch(/const body = stripMarkers\(previewText\(msg\)\)/)
  })

  it('reply pills and the reply tree', () => {
    expect(item).toMatch(/stripMarkers\(previewText\(\{ content: p\.content, summary: p\.attachments \}\)\)/)
    expect(tree).toMatch(/previewText\(/)
  })

  it('the pins list and search results', () => {
    expect(pins).toMatch(/previewText\(/)
    expect(search).toMatch(/previewText\(/)
  })
})
