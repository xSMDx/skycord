import { describe, it, expect, vi } from 'vitest'

// richText reads the emoji pack from useAppearance, whose colour library does
// not load under Node. Only the pack name is read, so a stand-in is enough.
vi.mock('@/composables/useAppearance', () => ({ appearance: { emojiPack: 'native' } }))

const { renderMessage } = await import('../richText')

// The line break either side of a block element is dropped: the block already
// breaks the line, and a <br> beside it renders as an empty line. The rule
// after a closing block used to be a lookbehind, which Safari before 16.4
// cannot parse; these hold its behaviour now that it is written without one.
describe('renderMessage: line breaks around blocks', () => {
  it('drops the break after a code block', () => {
    const html = renderMessage('```\ncode\n```\nafter')
    expect(html).not.toMatch(/<\/pre><br>/)
    expect(html).toMatch(/<\/pre>after/)
  })

  it('drops the break after a quote', () => {
    const html = renderMessage('> quoted\nafter')
    expect(html).not.toMatch(/<\/blockquote><br>/)
    expect(html).toContain('after')
  })

  it('drops the break before a block', () => {
    expect(renderMessage('before\n```\ncode\n```')).not.toMatch(/<br><pre/)
  })

  it('keeps an ordinary break between two lines', () => {
    expect(renderMessage('one\ntwo')).toContain('one<br>two')
  })

  it('drops only the one break beside the block: a blank line after it stays', () => {
    expect(renderMessage('```\ncode\n```\n\nafter')).toMatch(/<\/pre><br>after/)
  })
})
