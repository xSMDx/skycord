/**
 * The server picker page, in two modes:
 *
 *   - full: the window's page when no server is open — first run, a server
 *     that didn't answer, or Switch server with nothing on screen;
 *   - manage (?mode=manage): the Servers window, over a server that is open.
 *
 * A plain script, loaded blocking in the head so mode and theme are set before
 * the first paint; the rest waits for the DOM. It reaches the main process only
 * through `skycordPicker`, and the main process checks every call.
 */
(() => {
  const params = new URLSearchParams(location.search)
  const manage = params.get('mode') === 'manage'
  document.documentElement.dataset.mode = manage ? 'manage' : 'full'
  document.documentElement.dataset.theme = params.get('theme') === 'light' ? 'light' : 'dark'

  interface Profile { name: string; nameIsAddress: boolean; icon: string | null; operator: string | null; version: string }
  type Lookup = { ok: true; origin: string; profile: Profile } | { ok: false; reason: string }
  interface Saved { origin: string; name: string; icon: string | null }
  interface PickerApi {
    lookup(address: string): Promise<Lookup>
    choose(origin: string, meta?: { name?: string; icon?: string | null }): Promise<{ restarting: boolean } | undefined>
    list(): Promise<{ servers: Saved[]; current: string | null } | null>
    save(entry: Saved): Promise<Saved[] | null>
    rename(origin: string, name: string): Promise<Saved[] | null>
    readdress(origin: string, next: Saved): Promise<Saved[] | null>
    remove(origin: string): Promise<Saved[] | null>
    close(): Promise<void>
  }

  const api = (window as unknown as { skycordPicker: PickerApi }).skycordPicker
  const HOSTED = 'https://app.skycord.xyz'
  const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
  const PENCIL = svg('<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>')
  const TRASH = svg('<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>')

  let servers: Saved[] = []
  let current: string | null = null
  let editing: string | null = null
  let confirming: string | null = null
  let found: { origin: string; profile: Profile } | null = null

  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const hostOf = (o: string) => { try { return new URL(o).host } catch { return o } }
  /** What the page can tell of an address's origin; the main process decides for real. */
  const originOf = (address: string) => {
    try { return new URL(/^[a-z]+:\/\//i.test(address) ? address : `https://${address}`).origin } catch { return '' }
  }
  const iconOf = (p: Profile, origin: string) => { try { return p.icon ? new URL(p.icon, origin).href : null } catch { return null } }
  const nameOf = (p: Profile) => (p.nameIsAddress ? '' : p.name)

  const say = (el: HTMLElement, text: string, error = false) => {
    el.textContent = text
    el.classList.toggle('err', error)
  }

  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
    const el = document.createElement(tag)
    if (className) el.className = className
    if (text) el.textContent = text
    return el
  }
  const button = (className: string, label: string, onClick: () => void, html = '') => {
    const b = node('button', className)
    b.type = 'button'
    if (html) { b.innerHTML = html; b.setAttribute('aria-label', label); b.title = label } else b.textContent = label
    b.addEventListener('click', onClick)
    return b
  }

  /** A server's icon, or its initial when it has none or it fails to load. */
  const markFor = (s: { name: string; icon: string | null }, el = node('span', 'mark')) => {
    const letter = (s.name.trim()[0] ?? '?').toUpperCase()
    el.replaceChildren()
    if (s.icon) {
      const img = node('img')
      img.alt = ''
      img.src = s.icon
      img.addEventListener('error', () => { el.textContent = letter })
      el.append(img)
    } else el.textContent = letter
    return el
  }

  // ── the list ──
  const connect = async (origin: string) => {
    const r = await api.choose(origin)
    if (r?.restarting) say($('list-msg'), 'Restarting once to finish connecting to this server…')
  }

  const saveCurrent = async (origin: string) => {
    const r = await api.lookup(origin)
    const list = await api.save(r.ok
      ? { origin, name: nameOf(r.profile), icon: iconOf(r.profile, r.origin) }
      : { origin, name: '', icon: null })
    if (list) { servers = list; render() }
  }

  const editForm = (s: Saved) => {
    const form = node('form', 'edit')
    form.innerHTML = '<label>Name<input name="name" maxlength="64" autocomplete="off" spellcheck="false"></label>'
      + '<label>Address<input name="address" inputmode="url" autocomplete="off" spellcheck="false"></label>'
      + '<p class="msg" role="status" aria-live="polite"></p>'
      + '<div class="row"><button class="btn small" type="submit">Save</button><button class="btn quiet small" type="button" data-act="cancel">Cancel</button></div>'
    const name = form.querySelector<HTMLInputElement>('[name="name"]')!
    const address = form.querySelector<HTMLInputElement>('[name="address"]')!
    const msg = form.querySelector<HTMLElement>('.msg')!
    name.value = s.name
    address.value = s.origin
    form.querySelector('[data-act="cancel"]')!.addEventListener('click', () => { editing = null; render() })
    form.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); editing = null; render() } })
    form.addEventListener('submit', async e => {
      e.preventDefault()
      let list: Saved[] | null
      if (originOf(address.value.trim()) === s.origin) {
        list = await api.rename(s.origin, name.value)
      } else {
        // A new address has to be a Skycord server before it is saved.
        say(msg, 'Checking…')
        const r = await api.lookup(address.value)
        if (!r.ok) { say(msg, r.reason, true); return }
        list = await api.readdress(s.origin, { origin: r.origin, name: name.value.trim() || nameOf(r.profile), icon: iconOf(r.profile, r.origin) })
      }
      if (list) servers = list
      editing = null
      render()
    })
    return form
  }

  const confirmBox = (s: Saved) => {
    const box = node('div', 'confirm')
    const p = node('p')
    p.append('Remove ', node('strong', '', s.name), ' from this app? The server itself isn’t affected.')
    const row = node('div', 'row')
    row.append(
      button('btn small danger', 'Remove', async () => {
        const list = await api.remove(s.origin)
        if (list) servers = list
        confirming = null
        render()
      }),
      button('btn quiet small', 'Cancel', () => { confirming = null; render() }),
    )
    box.append(p, row)
    return box
  }

  const row = (s: Saved, saved: boolean) => {
    const li = node('li', 'server')
    if (editing === s.origin) {
      li.classList.add('editing')
      li.append(editForm(s))
      return li
    }
    if (confirming === s.origin) {
      li.classList.add('confirming')
      li.append(confirmBox(s))
      return li
    }
    const who = node('span', 'who')
    who.append(node('strong', '', s.name), node('span', '', hostOf(s.origin)))
    li.append(markFor(s), who)
    if (s.origin === current) {
      const badge = node('span', 'badge', 'Connected')
      badge.prepend(node('i'))
      li.append(badge)
    } else {
      li.append(button('btn small', manage ? 'Switch' : 'Connect', () => void connect(s.origin)))
    }
    if (!saved) {
      li.append(button('btn quiet small', 'Save', () => void saveCurrent(s.origin)))
    } else {
      li.append(
        button('icon-btn', `Edit ${s.name}`, () => { editing = s.origin; confirming = null; render(); document.querySelector<HTMLInputElement>('.edit [name="name"]')?.focus() }, PENCIL),
        button('icon-btn danger', `Remove ${s.name}`, () => { confirming = s.origin; editing = null; render(); document.querySelector<HTMLButtonElement>('.confirm .danger')?.focus() }, TRASH),
      )
    }
    return li
  }

  const render = () => {
    const list = $('servers')
    list.replaceChildren()
    // The server on screen always shows, saved or not, so it can be saved again.
    const unsaved = current && !servers.some(s => s.origin === current) ? current : null
    if (unsaved) list.append(row({ origin: unsaved, name: hostOf(unsaved), icon: null }, false))
    for (const s of servers) list.append(row(s, true))
    $('saved').hidden = !list.children.length
    $('hosted').hidden = servers.some(s => s.origin === HOSTED) || current === HOSTED
  }

  // ── adding one ──
  const resetFound = () => {
    $('found').classList.remove('on')
    found = null
    $<HTMLInputElement>('address').focus()
  }

  const start = async () => {
    if (manage) {
      $('lede').textContent = 'The servers saved in this app. Switch between them, or add another.'
      $('add-label').textContent = 'Add a server'
      $('go').textContent = 'Save and switch'
      $('save').hidden = false
      $('back').textContent = 'Cancel'
      $('close').addEventListener('click', () => void api.close())
      document.addEventListener('keydown', e => { if (e.key === 'Escape') void api.close() })
    }

    $('hosted').addEventListener('click', async () => {
      const r = await api.choose(HOSTED)
      if (r?.restarting) say($('msg'), 'Restarting once to finish connecting to this server…')
    })

    $('form').addEventListener('submit', async e => {
      e.preventDefault()
      const check = $<HTMLButtonElement>('check')
      check.disabled = true
      say($('msg'), 'Checking…')
      const r = await api.lookup($<HTMLInputElement>('address').value)
      check.disabled = false
      if (!r.ok) { say($('msg'), r.reason, true); $('found').classList.remove('on'); return }
      say($('msg'), '')
      found = { origin: r.origin, profile: r.profile }
      $('name').textContent = r.profile.name
      $('meta').textContent = [r.profile.operator ? `Run by ${r.profile.operator}` : null, r.profile.nameIsAddress ? null : hostOf(r.origin), r.profile.version]
        .filter(Boolean).join(' · ')
      markFor({ name: r.profile.name, icon: iconOf(r.profile, r.origin) }, $('mark'))
      $('found').classList.add('on')
      $<HTMLButtonElement>('go').focus()
    })

    $('go').addEventListener('click', async () => {
      if (!found) return
      const r = await api.choose(found.origin, { name: nameOf(found.profile), icon: iconOf(found.profile, found.origin) })
      if (r?.restarting) say($('msg'), 'Restarting once to finish connecting to this server…')
    })
    $('save').addEventListener('click', async () => {
      if (!found) return
      const list = await api.save({ origin: found.origin, name: nameOf(found.profile), icon: iconOf(found.profile, found.origin) })
      if (list) { servers = list; render() }
      say($('msg'), `Saved ${found.profile.name}.`)
      $<HTMLInputElement>('address').value = ''
      resetFound()
    })
    $('back').addEventListener('click', resetFound)

    const data = await api.list()
    servers = data?.servers ?? []
    current = data?.current ?? null
    render()

    // Sent back here because the saved server didn't answer: say so, and leave
    // its address in the box so trying again is one press.
    const unreachable = params.get('unreachable')
    if (unreachable) {
      $<HTMLInputElement>('address').value = unreachable
      say($('msg'), `Couldn’t reach ${hostOf(unreachable)}. Press Check to try again, or choose a different server.`, true)
    }
    if (!manage) $<HTMLInputElement>('address').focus()
  }

  document.addEventListener('DOMContentLoaded', () => void start())
})()
