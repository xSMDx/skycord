import { describe, it, expect } from 'vitest'
import { renderLegalMarkdown } from '../legalMarkdown'

describe('renderLegalMarkdown', () => {
  it('renders what a legal document needs: headings, paragraphs, lists, emphasis, code', async () => {
    const html = await renderLegalMarkdown('# Terms\n\nBe **kind**.\n\n- one\n- two\n\n`code`')
    expect(html).toContain('<h1>Terms</h1>')
    expect(html).toContain('<strong>kind</strong>')
    expect(html).toContain('<li>one</li>')
    expect(html).toContain('<code>code</code>')
  })

  it('shows raw HTML as text and never renders it', async () => {
    const html = await renderLegalMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })

  it('never renders an image', async () => {
    expect(await renderLegalMarkdown('![tracker](https://example.com/pixel.png)')).not.toContain('<img')
  })

  it('opens an http(s) link in a new tab, without an opener', async () => {
    const html = await renderLegalMarkdown('[our site](https://example.com)')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('allows mailto links', async () => {
    expect(await renderLegalMarkdown('[mail](mailto:sam@example.com)')).toContain('href="mailto:sam@example.com"')
  })

  it('refuses every other kind of link', async () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', '/relative', 'vbscript:x']) {
      const html = await renderLegalMarkdown(`[x](${url})`)
      expect(html, url).not.toContain('<a')
    }
  })
})
