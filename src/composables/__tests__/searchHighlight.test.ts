import { describe, it, expect } from 'vitest'
import { highlightTerms, highlightHtml } from '../searchHighlight'

describe('highlightTerms', () => {
  it('keeps words and phrases, drops exclusions and quotes', () => {
    expect(highlightTerms('plan "next week" -draft')).toEqual(['plan', 'next week'])
  })
  it('drops an excluded phrase too', () => {
    expect(highlightTerms('-"old news" fresh')).toEqual(['fresh'])
  })
})

describe('highlightHtml', () => {
  it('marks a word regardless of case', () => {
    expect(highlightHtml('The Plan is set', ['plan'])).toBe('The <mark class="sr-hit">Plan</mark> is set')
  })
  it('never touches tags or attributes', () => {
    const html = '<a href="https://x.io/plan" class="msg-link">see plan</a>'
    expect(highlightHtml(html, ['plan'])).toBe('<a href="https://x.io/plan" class="msg-link">see <mark class="sr-hit">plan</mark></a>')
  })
  it('marks only whole words, the way the search matched them', () => {
    expect(highlightHtml('seed #10 and #110', ['10'])).toBe('seed #<mark class="sr-hit">10</mark> and #110')
    expect(highlightHtml('planet plan', ['plan'])).toBe('planet <mark class="sr-hit">plan</mark>')
  })
  it('marks a word whatever its accents', () => {
    expect(highlightHtml('Café au lait', ['cafe'])).toBe('<mark class="sr-hit">Café</mark> au lait')
  })
  it('marks a phrase as one span, and prefers it to its own words', () => {
    expect(highlightHtml('next week plan', ['next', 'next week'])).toBe('<mark class="sr-hit">next week</mark> plan')
  })
  it('finds words inside escaped text without splitting an entity', () => {
    expect(highlightHtml('a &lt;b&gt; c', ['<b>'])).toBe('a &lt;<mark class="sr-hit">b</mark>&gt; c')
    expect(highlightHtml('fish &amp; chips', ['amp'])).toBe('fish &amp; chips')
  })
  it('does not mark a word that inline markup splits in two', () => {
    expect(highlightHtml('re<b>lease</b>', ['release'])).toBe('re<b>lease</b>')
  })
  it('leaves the HTML alone with nothing to mark', () => {
    expect(highlightHtml('<b>x</b>', [])).toBe('<b>x</b>')
  })
})
