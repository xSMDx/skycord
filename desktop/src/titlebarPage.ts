/**
 * The title bar page. A plain script (no modules). It shows what the main
 * process sends — already checked there — and sends back only back/forward.
 */
(() => {
  interface State { title: string; kind: string; icon: string | null; canBack: boolean; canForward: boolean }
  interface Colors { bar: string; text: string; muted: string }
  interface TitleBarApi {
    onState(cb: (s: State) => void): void
    onColors(cb: (c: Colors) => void): void
    nav(dir: 'back' | 'forward'): void
  }
  const api = (window as unknown as { skycordTitleBar: TitleBarApi }).skycordTitleBar

  const svg = (viewBox: string, width: number, d: string) =>
    `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
  const MARK = svg('0 0 256 256', 20, '<path d="M24,64a24,24,0,0,1,48,0H184a24,24,0,0,1,48,0v80a64,64,0,0,1-64,64H88a64,64,0,0,1-64-64Z"/><circle cx="92" cy="140" r="6" fill="currentColor"/><circle cx="164" cy="140" r="6" fill="currentColor"/>')
  const GLYPHS: Record<string, string> = {
    friends: svg('0 0 24 24', 2, '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'),
    dms: svg('0 0 24 24', 2, '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>'),
    discover: svg('0 0 24 24', 2, '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z"/>'),
    picker: MARK,
    app: MARK,
  }

  let shownGlyph = ''

  const initial = (title: string) => {
    const span = document.createElement('span')
    span.className = 'initial'
    span.textContent = (title.trim()[0] ?? '?').toUpperCase()
    return span
  }

  const render = (s: State) => {
    const title = s.title || 'Skycord'
    document.getElementById('text')!.textContent = title
    ;(document.getElementById('back') as HTMLButtonElement).disabled = !s.canBack
    ;(document.getElementById('forward') as HTMLButtonElement).disabled = !s.canForward

    // Rebuilt only when it changes, so a server icon doesn't reload on every report.
    const key = `${s.kind}|${s.icon ?? ''}|${s.kind === 'server' && !s.icon ? title[0] : ''}`
    if (key === shownGlyph) return
    shownGlyph = key
    const glyph = document.getElementById('glyph')!
    if (s.icon) {
      const img = document.createElement('img')
      img.alt = ''
      img.src = s.icon
      img.addEventListener('error', () => glyph.replaceChildren(initial(title)))
      glyph.replaceChildren(img)
    } else if (s.kind === 'server') {
      glyph.replaceChildren(initial(title))
    } else {
      glyph.innerHTML = GLYPHS[s.kind] ?? MARK
    }
  }

  const apply = (c: Colors) => {
    const root = document.documentElement
    root.style.setProperty('--bar', c.bar)
    root.style.setProperty('--text', c.text)
    root.style.setProperty('--muted', c.muted)
    // Light or dark by the bar itself, so native bits (focus, scrollbars) match.
    const n = parseInt(c.bar.slice(1), 16)
    const lum = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
    root.style.colorScheme = lum > 0.5 ? 'light' : 'dark'
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('back')!.addEventListener('click', () => api.nav('back'))
    document.getElementById('forward')!.addEventListener('click', () => api.nav('forward'))
    api.onState(render)
    api.onColors(apply)
  })
})()
