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
    last: Quality & { audio: boolean; hidePreview: boolean }
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
  const PRESET_DESCS: Record<string, string> = { gaming: 'Smoother video', text: 'Clearer text' }

  const ICON = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
  const WINDOW = ICON('<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3 9h18"/>')
  const SCREEN = ICON('<rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>')
  const WARN = ICON('<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4M12 17h.01"/>')
  const CHEV = '<svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>'
  const CHECK = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.2 5 8.5l4.5-5"/></svg>'

  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

  let settings: Init = {
    quality: false, audio: false,
    last: { resolution: 720, frameRate: 60, audio: false, hidePreview: false },
    presets: {}, resolutions: [], frameRates: [],
  }
  let tab: Kind = 'window'
  let tiles: Tile[] = []
  let loaded = false
  let failed = false
  let sharing = false
  const shown = new Map<string, HTMLButtonElement>()

  // What the stream will be. `custom` is set by choosing Custom or changing a
  // value by hand, so the summary says Custom even when the numbers happen to
  // match a preset.
  let q: Quality = { resolution: 720, frameRate: 60 }
  let custom = false
  let audio = false
  let hidePreview = false

  const resLabel = (r: Res) => (r === 'source' ? 'Source' : `${r}p`)
  const fpsLabel = (f: number) => `${f}fps`
  const presetOf = (x: Quality) =>
    Object.keys(settings.presets).find(k => settings.presets[k].resolution === x.resolution && settings.presets[k].frameRate === x.frameRate) ?? null
  const mode = () => (custom ? 'custom' : presetOf(q) ?? 'custom')

  // ── the summary, the SD/HD toggle and the menu, kept in step ──
  const setChecked = (id: string, on: boolean) => document.getElementById(id)?.setAttribute('aria-checked', String(on))

  const sync = () => {
    const m = mode()
    $('sum-mode').textContent = m === 'custom' ? 'Custom' : PRESET_NAMES[m] ?? m
    $('sum-detail').textContent = `${resLabel(q.resolution)} · ${fpsLabel(q.frameRate)}`
    $('sd').setAttribute('aria-pressed', String(q.resolution === 720))
    $('hd').setAttribute('aria-pressed', String(q.resolution === 1080))

    for (const k of [...Object.keys(settings.presets), 'custom']) setChecked(`mode-${k}`, k === m)
    for (const r of settings.resolutions) setChecked(`res-${r}`, r === q.resolution)
    for (const f of settings.frameRates) setChecked(`fps-${f}`, f === q.frameRate)
    const resValue = document.getElementById('res-value')
    if (resValue) resValue.textContent = resLabel(q.resolution)
    const fpsValue = document.getElementById('fps-value')
    if (fpsValue) fpsValue.textContent = fpsLabel(q.frameRate)
    setChecked('hide-preview', hidePreview)

    // Audio is the whole PC's sound, so it only makes sense with a whole screen.
    const audioItem = document.getElementById('audio-item')
    if (audioItem) {
      const off = tab === 'window'
      audioItem.setAttribute('aria-disabled', String(off))
      audioItem.setAttribute('aria-checked', String(!off && audio))
      const desc = $('audio-desc')
      desc.textContent = off ? 'Entire screen only'
        : audio ? 'Includes this call, so others may hear an echo'
        : 'Everything your PC plays'
      desc.classList.toggle('warn', !off && audio)
    }
  }

  // ── the menu ──
  let menu: HTMLElement
  let gear: HTMLButtonElement

  const item = (role: string, id: string, inner: string, extra = '') =>
    `<button type="button" class="item" role="${role}" id="${id}" tabindex="-1"${extra}>${inner}</button>`
  const radio = (role: string, id: string, label: string, desc = '') =>
    item(role, id, `<span class="text">${label}${desc ? `<span class="desc">${desc}</span>` : ''}</span><span class="radio"></span>`)
  const opener = (id: string, sub: string, label: string, valueId = '') =>
    item('menuitem', id, `<span class="text">${label}</span>${valueId ? `<span class="value" id="${valueId}"></span>` : ''}${CHEV}`,
      ` aria-haspopup="menu" aria-expanded="false" data-sub="${sub}"`)

  const buildMenu = () => {
    const parts: string[] = []
    if (settings.quality) {
      parts.push('<div class="menu-label" id="mode-label">Stream mode</div><div role="group" aria-labelledby="mode-label">')
      for (const [k, p] of Object.entries(settings.presets)) {
        parts.push(radio('menuitemradio', `mode-${k}`, PRESET_NAMES[k] ?? k, `${PRESET_DESCS[k] ?? ''} (${resLabel(p.resolution)}, ${fpsLabel(p.frameRate)})`))
      }
      parts.push(radio('menuitemradio', 'mode-custom', 'Custom'), '</div><div class="sep" role="separator"></div>')
      parts.push(opener('open-res', 'menu-res', 'Screen resolution', 'res-value'), opener('open-fps', 'menu-fps', 'Frame rate', 'fps-value'))
    }
    if (settings.audio) {
      if (parts.length) parts.push('<div class="sep" role="separator"></div>')
      parts.push(item('menuitemcheckbox', 'audio-item',
        `<span class="text">Share stream audio<span class="desc" id="audio-desc"></span></span><span class="box">${CHECK}</span>`))
    }
    if (settings.quality) {
      parts.push(opener('open-adv', 'menu-adv', 'Advanced'))
      parts.push(`<div class="submenu" id="menu-res" role="menu" aria-label="Screen resolution" hidden>${
        settings.resolutions.map(r => radio('menuitemradio', `res-${r}`, resLabel(r))).join('')}</div>`)
      parts.push(`<div class="submenu" id="menu-fps" role="menu" aria-label="Frame rate" hidden>${
        settings.frameRates.map(f => radio('menuitemradio', `fps-${f}`, fpsLabel(f))).join('')}</div>`)
      parts.push(`<div class="submenu" id="menu-adv" role="menu" aria-label="Advanced" hidden>${
        item('menuitemcheckbox', 'hide-preview', `<span class="text">Hide stream preview<span class="desc">Others still see it</span></span><span class="box">${CHECK}</span>`)}</div>`)
    }
    menu.innerHTML = parts.join('')
  }

  const menuOpen = () => !menu.hidden
  const submenus = () => [...menu.querySelectorAll<HTMLElement>('.submenu')]
  const openers = () => [...menu.querySelectorAll<HTMLElement>('[data-sub]')]
  /** The items a key press moves between: the open submenu's, or the menu's own. */
  const itemsIn = (box: HTMLElement) =>
    [...box.querySelectorAll<HTMLElement>(':scope > .item, :scope > [role="group"] > .item')]

  const closeSubs = () => {
    submenus().forEach(s => { s.hidden = true })
    openers().forEach(o => o.setAttribute('aria-expanded', 'false'))
  }

  const openSub = (trigger: HTMLElement, focus: boolean) => {
    closeSubs()
    const sub = $(trigger.dataset.sub!)
    sub.hidden = false
    trigger.setAttribute('aria-expanded', 'true')
    // Level with its opener, but never hanging below the menu's own bottom.
    const top = Math.min(trigger.offsetTop - 7, menu.clientHeight - sub.offsetHeight)
    sub.style.top = `${Math.max(0, top)}px`
    if (focus) (sub.querySelector<HTMLElement>('[aria-checked="true"]') ?? itemsIn(sub)[0])?.focus()
  }

  const openMenu = (focus: boolean) => {
    menu.hidden = false
    gear.setAttribute('aria-expanded', 'true')
    sync()
    if (focus) itemsIn(menu)[0]?.focus()
  }

  const closeMenu = (refocus: boolean) => {
    closeSubs()
    menu.hidden = true
    gear.setAttribute('aria-expanded', 'false')
    if (refocus) gear.focus()
  }

  const activate = (el: HTMLElement) => {
    const id = el.id
    if (el.dataset.sub) { openSub(el, false); return }
    if (el.getAttribute('aria-disabled') === 'true') return
    if (id.startsWith('mode-')) {
      const k = id.slice(5)
      if (k === 'custom') custom = true
      else { q = { ...settings.presets[k] }; custom = false }
    } else if (id.startsWith('res-')) {
      const v = id.slice(4)
      q = { ...q, resolution: v === 'source' ? 'source' : Number(v) }
      custom = true
    } else if (id.startsWith('fps-')) {
      q = { ...q, frameRate: Number(id.slice(4)) }
      custom = true
    } else if (id === 'audio-item') audio = !audio
    else if (id === 'hide-preview') hidePreview = !hidePreview
    sync()
  }

  const setupMenu = () => {
    menu = $('menu')
    gear = $<HTMLButtonElement>('gear')
    buildMenu()

    // A keyboard press arrives as a click with no pointer detail: then the
    // first item takes focus, as a menu opened from the keyboard should.
    gear.addEventListener('click', e => { if (menuOpen()) closeMenu(false); else openMenu(e.detail === 0) })
    menu.addEventListener('click', e => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.item')
      if (el) activate(el)
    })
    // Hovering an opener opens its submenu; hovering any other item of the
    // menu itself closes it. Crossing the gap to a submenu touches neither.
    menu.addEventListener('pointerover', e => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.item')
      if (!el || el.closest('.submenu')) return
      if (el.dataset.sub) { if (el.getAttribute('aria-expanded') !== 'true') openSub(el, false) }
      else closeSubs()
    })
    menu.addEventListener('keydown', e => {
      const current = document.activeElement as HTMLElement
      const inSub = current.closest<HTMLElement>('.submenu')
      const list = itemsIn(inSub ?? menu)
      const at = list.indexOf(current)
      const move = (to: number) => { e.preventDefault(); list[(to + list.length) % list.length]?.focus() }
      const back = () => { const t = menu.querySelector<HTMLElement>(`[data-sub="${inSub!.id}"]`); closeSubs(); t?.focus() }
      switch (e.key) {
        case 'ArrowDown': move(at + 1); break
        case 'ArrowUp': move(at - 1); break
        case 'Home': move(0); break
        case 'End': move(list.length - 1); break
        case 'ArrowRight':
        case 'Enter':
        case ' ':
          if (current.dataset.sub) { e.preventDefault(); openSub(current, true) }
          break
        case 'ArrowLeft':
          if (inSub) { e.preventDefault(); back() }
          break
        case 'Escape':
          // The picker closes on Escape; with a menu open, only the menu does.
          e.stopPropagation()
          if (inSub) back()
          else closeMenu(true)
          break
        case 'Tab':
          closeMenu(false)
          break
      }
    })
    document.addEventListener('pointerdown', e => {
      const t = e.target as Node
      if (menuOpen() && !menu.contains(t) && !gear.contains(t)) closeMenu(false)
    })

    $('sd').addEventListener('click', () => { q = { ...q, resolution: 720 }; custom = true; sync() })
    $('hd').addEventListener('click', () => { q = { ...q, resolution: 1080 }; custom = true; sync() })
  }

  // ── footer: shows only what applies ──
  const syncFooter = () => {
    $('summary').hidden = !settings.quality
    $('sdhd').hidden = !settings.quality
    gear.hidden = !(settings.quality || settings.audio)
    $('footer').hidden = gear.hidden
  }

  // ── tabs ──
  const tabButton = (kind: Kind) => $<HTMLButtonElement>(`tab-${kind}`)

  const placeSlider = () => {
    const b = tabButton(tab)
    const slider = $('slider')
    slider.style.width = `${b.offsetWidth}px`
    slider.style.transform = `translateX(${b.offsetLeft}px)`
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
    sync()
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
    $('grid').hidden = true
    const state = $('state')
    state.hidden = false
    if (state.dataset.html !== html) { state.innerHTML = html; state.dataset.html = html }
  }

  const render = () => {
    for (const k of ['window', 'screen'] as const) {
      $(`count-${k}`).textContent = loaded ? String(tiles.filter(t => t.kind === k).length) : ''
    }
    // The counts change the tabs' widths, so the highlight is measured again.
    placeSlider()

    const grid = $('grid')
    if (!loaded) {
      $('state').hidden = true
      grid.hidden = false
      if (!grid.querySelector('.skeleton')) {
        grid.innerHTML = '<div class="skeleton" aria-hidden="true"><span class="well"></span><span class="bar"></span></div>'.repeat(6)
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

    $('state').hidden = true
    grid.hidden = false
    grid.querySelectorAll('.skeleton').forEach(s => s.remove())
    const keep = new Set(list.map(t => t.id))
    for (const [id, b] of shown) if (!keep.has(id)) { b.remove(); shown.delete(id) }
    list.forEach((t, i) => {
      let b = shown.get(t.id)
      if (!b) { b = makeTile(t.id); shown.set(t.id, b) }
      paint(b, t)
      if (grid.children[i] !== b) grid.insertBefore(b, grid.children[i] ?? null)
    })
  }

  const share = (sourceId: string) => {
    if (sharing) return
    sharing = true
    void api.choose({ sourceId, resolution: q.resolution, frameRate: q.frameRate, audio: tab === 'screen' && audio, hidePreview })
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
    $('close').addEventListener('click', () => void api.cancel())
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return
      if (menuOpen()) closeMenu(true)
      else void api.cancel()
    })
    for (const k of ['window', 'screen'] as const) tabButton(k).addEventListener('click', () => selectTab(k))
    document.querySelector('.tabs')!.addEventListener('keydown', e => {
      const key = (e as KeyboardEvent).key
      if (key === 'ArrowLeft' || key === 'ArrowRight') { e.preventDefault(); selectTab(tab === 'window' ? 'screen' : 'window', true) }
    })
    $('state').addEventListener('click', e => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act
      if (act === 'retry') { loaded = false; failed = false; render(); void refresh() }
      if (act === 'screens') selectTab('screen', true)
    })
    window.addEventListener('resize', placeSlider)

    const init = await api.init()
    if (init) settings = init
    q = { resolution: settings.last.resolution, frameRate: settings.last.frameRate }
    custom = !presetOf(q)
    audio = settings.last.audio
    hidePreview = settings.last.hidePreview
    setupMenu()
    syncFooter()
    selectTab('window')
    // The slider animates only once it has a place to move from.
    requestAnimationFrame(() => $('slider').classList.add('moving'))
    void loop()
  }

  document.addEventListener('DOMContentLoaded', () => void start())
})()
