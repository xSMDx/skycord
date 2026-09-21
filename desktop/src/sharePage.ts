/**
 * The share picker page. A plain script (no modules), loaded blocking in the
 * head so the theme is set before the first paint; the rest waits for the DOM.
 *
 * Its only way out is `skycordShare`, and the main process checks every call.
 * The presets come from the main process too, so they are defined once.
 */
(() => {
  document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark'

  type Kind = 'window' | 'screen'
  type Res = number | 'source'
  interface Tile { id: string; kind: Kind; name: string; detail: string | null; thumb: string | null; icon: string | null }
  interface Quality { resolution: Res; frameRate: number }
  interface Init {
    quality: boolean
    audio: boolean
    last: Quality & { audio: boolean }
    presets: Record<string, Quality>
    resolutions: Res[]
    frameRates: number[]
  }
  interface ShareApi {
    init(): Promise<Init | null>
    sources(): Promise<Tile[]>
    choose(choice: unknown): Promise<void>
    cancel(): Promise<void>
  }

  const api = (window as unknown as { skycordShare: ShareApi }).skycordShare
  const REFRESH_MS = 2500
  const PRESET_NAMES: Record<string, string> = { gaming: 'Gaming', text: 'Screenshare' }

  const ICON = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
  const WINDOW = ICON('<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3 9h18"/>')
  const SCREEN = ICON('<rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>')
  const WARN = ICON('<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4M12 17h.01"/>')

  let el: Record<'grid' | 'state' | 'slider' | 'footer' | 'quality' | 'audio' | 'echo', HTMLElement>
  let preset: HTMLSelectElement, res: HTMLSelectElement, fps: HTMLSelectElement, audioOn: HTMLInputElement
  let settings: Init = { quality: false, audio: false, last: { resolution: 720, frameRate: 30, audio: false }, presets: {}, resolutions: [], frameRates: [] }
  let tab: Kind = 'window'
  let tiles: Tile[] = []
  let loaded = false
  let failed = false
  let sharing = false
  const shown = new Map<string, HTMLButtonElement>()

  const resLabel = (r: Res) => (r === 'source' ? 'Source' : `${r}p`)
  const option = (value: string, text: string) => Object.assign(document.createElement('option'), { value, textContent: text })

  // ── stream quality ──
  const quality = (): Quality => {
    const p = settings.presets[preset.value]
    if (p) return p
    return { resolution: res.value === 'source' ? 'source' : Number(res.value), frameRate: Number(fps.value) }
  }

  const syncQuality = () => {
    const custom = preset.value === 'custom'
    document.getElementById('custom-res-wrap')!.hidden = !custom
    document.getElementById('custom-fps-wrap')!.hidden = !custom
  }

  const setupQuality = () => {
    for (const [key, p] of Object.entries(settings.presets)) {
      preset.append(option(key, `${PRESET_NAMES[key] ?? key} · ${resLabel(p.resolution)}, ${p.frameRate} fps`))
    }
    preset.append(option('custom', 'Custom'))
    for (const r of settings.resolutions) res.append(option(String(r), resLabel(r)))
    for (const f of settings.frameRates) fps.append(option(String(f), `${f} fps`))

    const { last } = settings
    const match = Object.entries(settings.presets).find(([, p]) => p.resolution === last.resolution && p.frameRate === last.frameRate)
    preset.value = match ? match[0] : 'custom'
    res.value = String(last.resolution)
    fps.value = String(last.frameRate)
    preset.addEventListener('change', syncQuality)
    syncQuality()
  }

  // ── footer: shows only what applies ──
  const syncFooter = () => {
    el.quality.hidden = !settings.quality
    el.audio.hidden = !(settings.audio && tab === 'screen')
    el.echo.hidden = !audioOn.checked
    el.footer.hidden = el.quality.hidden && el.audio.hidden
  }

  // ── tabs ──
  const tabButton = (kind: Kind) => document.getElementById(`tab-${kind}`) as HTMLButtonElement

  const placeSlider = () => {
    const b = tabButton(tab)
    el.slider.style.width = `${b.offsetWidth}px`
    el.slider.style.transform = `translateX(${b.offsetLeft}px)`
  }

  const selectTab = (kind: Kind, focus = false) => {
    if (kind !== tab) document.querySelector('main')!.scrollTop = 0
    tab = kind
    for (const k of ['window', 'screen'] as const) {
      const b = tabButton(k)
      b.setAttribute('aria-selected', String(k === kind))
      b.tabIndex = k === kind ? 0 : -1
    }
    if (focus) tabButton(kind).focus()
    placeSlider()
    syncFooter()
    render()
  }

  // ── tiles ──
  const makeTile = (id: string): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'tile'
    b.innerHTML = '<span class="well"><span class="none"></span><span class="pill" aria-hidden="true">Share</span></span>'
      + '<span class="meta"><span class="ico"></span><span class="name"></span><span class="detail"></span></span>'
    b.addEventListener('click', () => share(id))
    return b
  }

  const iconFor = (t: Tile) => {
    if (!t.icon) return t.kind === 'screen' ? SCREEN : WINDOW
    const img = document.createElement('img')
    img.alt = ''
    img.src = t.icon
    return img.outerHTML
  }

  const paint = (b: HTMLButtonElement, t: Tile) => {
    b.setAttribute('aria-label', `Share ${t.name}${t.detail ? `, ${t.detail}` : ''}`)
    b.title = t.name
    // The preview image exists only while there is a preview to show.
    let shot = b.querySelector<HTMLImageElement>('.shot')
    const none = b.querySelector<HTMLElement>('.none')!
    if (t.thumb) {
      if (!shot) {
        shot = Object.assign(document.createElement('img'), { className: 'shot', alt: '' })
        b.querySelector('.well')!.prepend(shot)
      }
      if (shot.getAttribute('src') !== t.thumb) shot.src = t.thumb
      none.hidden = true
    } else {
      shot?.remove()
      none.hidden = false
      const html = `${iconFor(t)}<span>${t.kind === 'window' ? 'Minimised' : 'No preview'}</span>`
      if (none.dataset.html !== html) { none.innerHTML = html; none.dataset.html = html }
    }
    const ico = b.querySelector<HTMLElement>('.ico')!
    const icoHtml = iconFor(t)
    if (ico.dataset.html !== icoHtml) { ico.innerHTML = icoHtml; ico.dataset.html = icoHtml }
    b.querySelector('.name')!.textContent = t.name
    b.querySelector('.detail')!.textContent = t.detail ?? ''
  }

  const showState = (html: string) => {
    el.grid.hidden = true
    el.state.hidden = false
    if (el.state.dataset.html !== html) { el.state.innerHTML = html; el.state.dataset.html = html }
  }

  const render = () => {
    for (const k of ['window', 'screen'] as const) {
      const n = tiles.filter(t => t.kind === k).length
      document.getElementById(`count-${k}`)!.textContent = loaded ? String(n) : ''
    }

    if (!loaded) {
      el.state.hidden = true
      el.grid.hidden = false
      if (!el.grid.querySelector('.skeleton')) {
        el.grid.innerHTML = '<div class="skeleton" aria-hidden="true"><span class="well"></span><span class="bar"></span></div>'.repeat(6)
      }
      return
    }
    if (failed) {
      showState(`${WARN}<strong>Couldn’t list your screens and windows</strong><p>Windows didn’t answer in time. Try again.</p><button class="btn" type="button" data-act="retry">Try again</button>`)
      return
    }

    const list = tiles.filter(t => t.kind === tab)
    if (!list.length) {
      showState(tab === 'window'
        ? `${WINDOW}<strong>No windows to share</strong><p>Open the app you want to share, or share your entire screen.</p><button class="btn" type="button" data-act="screens">Share entire screen</button>`
        : `${SCREEN}<strong>No screens found</strong><p>Windows reported no displays to capture.</p>`)
      return
    }

    el.state.hidden = true
    el.grid.hidden = false
    el.grid.querySelectorAll('.skeleton').forEach(s => s.remove())
    const keep = new Set(list.map(t => t.id))
    for (const [id, b] of shown) if (!keep.has(id)) { b.remove(); shown.delete(id) }
    list.forEach((t, i) => {
      let b = shown.get(t.id)
      if (!b) { b = makeTile(t.id); shown.set(t.id, b) }
      paint(b, t)
      if (el.grid.children[i] !== b) el.grid.insertBefore(b, el.grid.children[i] ?? null)
    })
  }

  const share = (sourceId: string) => {
    if (sharing) return
    sharing = true
    const q = quality()
    void api.choose({ sourceId, resolution: q.resolution, frameRate: q.frameRate, audio: tab === 'screen' && audioOn.checked })
      .finally(() => { sharing = false })
  }

  // ── sources, refreshed while open so previews stay live ──
  let first = true
  const refresh = async () => {
    try {
      tiles = await api.sources()
      failed = false
    } catch {
      if (!loaded) failed = true
    }
    loaded = true
    if (first) {
      first = false
      if (!tiles.some(t => t.kind === 'window') && tiles.some(t => t.kind === 'screen')) { selectTab('screen'); return }
    }
    render()
  }
  const loop = async () => { await refresh(); setTimeout(loop, REFRESH_MS) }

  const start = async () => {
    el = {
      grid: document.getElementById('grid')!, state: document.getElementById('state')!,
      slider: document.getElementById('slider')!, footer: document.getElementById('footer')!,
      quality: document.getElementById('quality')!, audio: document.getElementById('audio')!,
      echo: document.getElementById('echo')!,
    }
    preset = document.getElementById('preset') as HTMLSelectElement
    res = document.getElementById('res') as HTMLSelectElement
    fps = document.getElementById('fps') as HTMLSelectElement
    audioOn = document.getElementById('audio-on') as HTMLInputElement

    document.getElementById('close')!.addEventListener('click', () => void api.cancel())
    document.addEventListener('keydown', e => { if (e.key === 'Escape') void api.cancel() })
    for (const k of ['window', 'screen'] as const) tabButton(k).addEventListener('click', () => selectTab(k))
    document.querySelector('.tabs')!.addEventListener('keydown', e => {
      const key = (e as KeyboardEvent).key
      if (key === 'ArrowLeft' || key === 'ArrowRight') { e.preventDefault(); selectTab(tab === 'window' ? 'screen' : 'window', true) }
    })
    el.state.addEventListener('click', e => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act
      if (act === 'retry') { loaded = false; failed = false; render(); void refresh() }
      if (act === 'screens') selectTab('screen', true)
    })
    audioOn.addEventListener('change', syncFooter)
    window.addEventListener('resize', placeSlider)

    selectTab('window')
    const init = await api.init()
    if (init) settings = init
    audioOn.checked = settings.last.audio
    if (settings.quality) setupQuality()
    syncFooter()
    // The slider animates only once it has a place to move from.
    requestAnimationFrame(() => el.slider.classList.add('moving'))
    void loop()
  }

  document.addEventListener('DOMContentLoaded', () => void start())
})()
